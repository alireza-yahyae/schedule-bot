// Phase 2: the partner (pairing, templates, study log) and the automatic messages sent to her.

import type { Env, MessageTemplate, PartnerSettings, Role, Settings, TemplateCategory, TgUpdate, TimeCondition } from './types.ts';
import type { Telegram, TgRes } from './telegram.ts';
import { claim, loadSettings, loadTexts, markFailed, markSent } from './db.ts';
import { currentCycle, sleepMinutes, toMinutes } from './overrides.ts';
import type { Cycle } from './overrides.ts';
import { ApiError, bad } from './http.ts';
import { escapeHtml, render, renderPlain } from './messages.ts';
import { localDate, makeDigits } from './time.ts';
import { linkPartner, partnerOwner, unlinkPartner } from './registry.ts';

export const CATEGORIES: TemplateCategory[] = ['partner_not_studying', 'user_slacking', 'user_studied_hard', 'custom_scheduled'];
export const CONDITIONS: TimeCondition[] = ['manual', 'any', 'morning', 'night', 'after_2_hours_idle', 'after_4_hours_study'];

const DEFAULT_PARTNER_NAME = 'پارتنر';
const MAX_TEMPLATE_LEN = 500;

// ------------------------------------------------------------------ partner row
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

export function makePairingCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

export async function getPartner(db: D1Database): Promise<PartnerSettings> {
  const row = await db.prepare(`SELECT * FROM partner_settings WHERE id = 1`).first<PartnerSettings>();
  if (!row) throw new ApiError(500, 'جدول‌های مرحله‌ی ۲ ساخته نشدن. دستور db:migrate رو اجرا کن.');
  if (!row.chat_id && !row.pairing_code) {
    const code = makePairingCode();
    await db.prepare(`UPDATE partner_settings SET pairing_code = ?1 WHERE id = 1`).bind(code).run();
    row.pairing_code = code;
  }
  return row;
}

export interface PartnerPatch {
  name?: unknown;
  auto_notify_enabled?: unknown;
  allow_partner_edit_templates?: unknown;
  idle_threshold_hours?: unknown;
  hard_study_threshold_hours?: unknown;
  allow_partner_send?: unknown;
  share_study?: unknown;
  share_schedule?: unknown;
}

function flag(v: unknown): number {
  return v === true || v === 1 || v === '1' ? 1 : 0;
}

export async function updatePartner(db: D1Database, patch: PartnerPatch): Promise<PartnerSettings> {
  const cur = await getPartner(db);
  let name = cur.name;
  if (patch.name !== undefined) {
    name = String(patch.name ?? '').trim().slice(0, 40);
    if (!name) name = DEFAULT_PARTNER_NAME;
  }
  const hours = (v: unknown, fallback: number, label: string): number => {
    if (v === undefined) return fallback;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1 || n > 16) bad(`${label} باید عددی بین ۱ و ۱۶ باشه`);
    return n;
  };
  await db
    .prepare(
      `UPDATE partner_settings
          SET name = ?1, auto_notify_enabled = ?2, allow_partner_edit_templates = ?3,
              idle_threshold_hours = ?4, hard_study_threshold_hours = ?5,
              allow_partner_send = ?6, share_study = ?7, share_schedule = ?8
        WHERE id = 1`,
    )
    .bind(
      name,
      patch.auto_notify_enabled === undefined ? cur.auto_notify_enabled : flag(patch.auto_notify_enabled),
      patch.allow_partner_edit_templates === undefined ? cur.allow_partner_edit_templates : flag(patch.allow_partner_edit_templates),
      hours(patch.idle_threshold_hours, cur.idle_threshold_hours, 'حساسیت بیکاری'),
      hours(patch.hard_study_threshold_hours, cur.hard_study_threshold_hours, 'حد نصاب خرخونی'),
      patch.allow_partner_send === undefined ? cur.allow_partner_send : flag(patch.allow_partner_send),
      patch.share_study === undefined ? cur.share_study : flag(patch.share_study),
      patch.share_schedule === undefined ? cur.share_schedule : flag(patch.share_schedule),
    )
    .run();
  return getPartner(db);
}

/** Connect `chatId` as the partner. Works only with the current one-time code. */
export async function pairByCode(db: D1Database, code: string, chatId: number, firstName: string, now: number): Promise<boolean> {
  const clean = code.trim().toUpperCase();
  if (!/^[A-Z0-9]{4,16}$/.test(clean)) return false;
  const r = await db
    .prepare(
      `UPDATE partner_settings
          SET chat_id = ?1,
              name = CASE WHEN name = ?2 AND ?3 != '' THEN ?3 ELSE name END,
              pairing_code = NULL, paired_at = ?4
        WHERE id = 1 AND chat_id IS NULL AND pairing_code IS NOT NULL AND pairing_code = ?5`,
    )
    .bind(String(chatId), DEFAULT_PARTNER_NAME, firstName.trim().slice(0, 40), now, clean)
    .run();
  return (r.meta.changes ?? 0) > 0;
}

/** Disconnect the partner and create a fresh code. */
export async function unpair(db: D1Database): Promise<PartnerSettings> {
  await db
    .prepare(`UPDATE partner_settings SET chat_id = NULL, paired_at = NULL, pairing_code = ?1 WHERE id = 1`)
    .bind(makePairingCode())
    .run();
  return getPartner(db);
}

export async function newPairingCode(db: D1Database): Promise<PartnerSettings> {
  await db.prepare(`UPDATE partner_settings SET pairing_code = ?1 WHERE id = 1 AND chat_id IS NULL`).bind(makePairingCode()).run();
  return getPartner(db);
}

// ------------------------------------------------------------------ templates
export function listTemplates(db: D1Database): Promise<MessageTemplate[]> {
  return db
    .prepare(`SELECT * FROM message_templates ORDER BY id DESC`)
    .all<MessageTemplate>()
    .then((r) => r.results);
}

interface TemplateInput {
  category: TemplateCategory;
  time_condition: TimeCondition;
  message_text: string;
  is_active: number;
}

function parseTemplate(b: Record<string, unknown>, cur: MessageTemplate | null): TemplateInput {
  const category = (b.category ?? cur?.category) as TemplateCategory | undefined;
  if (!category || !CATEGORIES.includes(category)) bad('دسته‌بندی پیام درست نیست');
  const cond = (b.time_condition ?? cur?.time_condition ?? 'manual') as TimeCondition;
  if (!CONDITIONS.includes(cond)) bad('شرط زمانی درست نیست');
  const text = String(b.message_text ?? cur?.message_text ?? '').trim();
  if (!text) bad('متن پیام نمی‌تونه خالی باشه');
  if (text.length > MAX_TEMPLATE_LEN) bad(`متن پیام حداکثر ${MAX_TEMPLATE_LEN} حرف می‌تونه باشه`);
  return {
    category,
    time_condition: cond,
    message_text: text,
    is_active: b.is_active === undefined ? (cur ? cur.is_active : 1) : flag(b.is_active),
  };
}

export async function createTemplate(db: D1Database, role: Role, b: Record<string, unknown>, now: number): Promise<MessageTemplate> {
  const t = parseTemplate(b, null);
  const row = await db
    .prepare(
      `INSERT INTO message_templates (category, time_condition, message_text, created_by, is_active, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6) RETURNING *`,
    )
    .bind(t.category, t.time_condition, t.message_text, role === 'partner' ? 'partner' : 'user', t.is_active, now)
    .first<MessageTemplate>();
  if (!row) throw new ApiError(500, 'ذخیره نشد');
  return row;
}

export async function updateTemplate(db: D1Database, id: number, b: Record<string, unknown>): Promise<MessageTemplate> {
  const cur = await db.prepare(`SELECT * FROM message_templates WHERE id = ?1`).bind(id).first<MessageTemplate>();
  if (!cur) throw new ApiError(404, 'این پیام پیدا نشد');
  const t = parseTemplate(b, cur);
  const row = await db
    .prepare(`UPDATE message_templates SET category = ?1, time_condition = ?2, message_text = ?3, is_active = ?4 WHERE id = ?5 RETURNING *`)
    .bind(t.category, t.time_condition, t.message_text, t.is_active, id)
    .first<MessageTemplate>();
  if (!row) throw new ApiError(500, 'ذخیره نشد');
  return row;
}

export async function deleteTemplate(db: D1Database, id: number): Promise<void> {
  const r = await db.prepare(`DELETE FROM message_templates WHERE id = ?1`).bind(id).run();
  if ((r.meta.changes ?? 0) === 0) throw new ApiError(404, 'این پیام پیدا نشد');
}

// ------------------------------------------------------------------ study time
export interface StudySnapshot {
  todayMinutes: number;
  todayHours: number;
  /** Hours since the owner last studied (counted from waking up; 0 while he is asleep). */
  idleHours: number;
  lastStudyTs: number | null;
  /** When the owner's current day started (wake-up). */
  dayStart: number;
  /** Seconds timestamp the "I am studying" timer was started, or null. */
  running: number | null;
  cycle: Cycle;
}

export interface StudyFilter {
  /** Only this category (the "focus" pomodoro sessions count as study = category 1). */
  categoryId?: number | null;
  /** Only categories the owner shares with the partner. */
  sharedOnly?: boolean;
}

/**
 * Minutes and the last activity time inside [from, to): manual entries, finished focus sessions and the running timer.
 * `running` is always the raw timer start; `runningCategory` says what it is for. The filter only changes what is counted.
 */
export async function studyBetween(
  db: D1Database,
  from: number,
  to: number,
  now: number,
  filter: StudyFilter = {},
): Promise<{ minutes: number; last: number | null; running: number | null; runningCategory: number | null }> {
  let extra = '';
  const binds: unknown[] = [from, to];
  if (filter.categoryId) {
    extra = ' AND category_id = ?3';
    binds.push(filter.categoryId);
  } else if (filter.sharedOnly) {
    extra = ' AND category_id IN (SELECT id FROM categories WHERE share_with_partner = 1)';
  }
  const manual = await db
    .prepare(`SELECT COALESCE(SUM(minutes), 0) AS m, MAX(created_at) AS last FROM study_sessions WHERE created_at >= ?1 AND created_at < ?2${extra}`)
    .bind(...binds)
    .first<{ m: number; last: number | null }>();
  const focus = await db
    .prepare(`SELECT COALESCE(SUM(minutes), 0) AS m, MAX(started_at + minutes * 60) AS last FROM focus_sessions WHERE started_at >= ?1 AND started_at < ?2${extra}`)
    .bind(...binds)
    .first<{ m: number; last: number | null }>();
  const timer = await db.prepare(`SELECT started_at, category_id FROM study_timer WHERE id = 1`).first<{ started_at: number | null; category_id: number }>();
  const running = timer && timer.started_at !== null ? timer.started_at : null;
  const runningCategory = running !== null ? timer?.category_id ?? 1 : null;

  let timerCounts = running !== null;
  if (timerCounts && filter.categoryId) timerCounts = runningCategory === filter.categoryId;
  else if (timerCounts && filter.sharedOnly) {
    const shared = await db.prepare(`SELECT share_with_partner AS v FROM categories WHERE id = ?1`).bind(runningCategory).first<{ v: number }>();
    timerCounts = !!shared && shared.v === 1;
  }

  let minutes = Number(manual?.m ?? 0) + Number(focus?.m ?? 0);
  const lasts = [manual?.last, focus?.last].filter((x): x is number => typeof x === 'number');
  let last = lasts.length ? Math.max(...lasts) : null;
  if (running !== null && timerCounts && running < to) {
    const end = Math.min(now, to);
    const begin = Math.max(running, from);
    // A forgotten timer must not count forever: same 16 h cap as when the timer is stopped (study.ts MAX_SESSION_MIN).
    if (end > begin) minutes += Math.min(Math.floor((end - begin) / 60), 16 * 60);
    if (now < to) last = now; // busy right now
  }
  return { minutes, last, running, runningCategory };
}

export async function studySnapshot(db: D1Database, s: Settings, now: number): Promise<StudySnapshot> {
  const cycle = await currentCycle(db, s.timezone, now);
  const { minutes, last, running } = await studyBetween(db, cycle.startTs, now + 1, now);
  const base = Math.max(cycle.wakeTs, last ?? 0);
  const idleHours = cycle.awake ? Math.max(0, Math.round(((now - base) / 3600) * 10) / 10) : 0;
  return { todayMinutes: minutes, todayHours: Math.round((minutes / 60) * 10) / 10, idleHours, lastStudyTs: last, dayStart: cycle.wakeTs, running, cycle };
}

/** The name that goes into {activity} (it is sent to the partner, so hidden categories never appear): the one with most minutes today, else the one used last, else study. */
export async function activityLabel(db: D1Database, startTs: number, now: number): Promise<string> {
  const top = await db
    .prepare(
      `SELECT c.title AS title FROM study_sessions s JOIN categories c ON c.id = s.category_id
        WHERE s.created_at >= ?1 AND s.created_at <= ?2 AND c.share_with_partner = 1 GROUP BY s.category_id ORDER BY SUM(s.minutes) DESC LIMIT 1`,
    )
    .bind(startTs, now)
    .first<{ title: string }>();
  if (top) return top.title;
  const last = await db
    .prepare(`SELECT c.title AS title FROM study_sessions s JOIN categories c ON c.id = s.category_id WHERE c.share_with_partner = 1 ORDER BY s.created_at DESC LIMIT 1`)
    .first<{ title: string }>();
  return last ? last.title : 'درس';
}

export interface PartnerStudyView {
  today_minutes: number; // only categories the owner shares
  running: number | null;
  running_label: string | null; // null when the running category is hidden from the partner
  busy_hidden: boolean; // a hidden category is running: show a neutral "busy"
  idle_hours: number; // counts every category, so she is not told he is idle while he works
  activities: string[]; // shared categories with minutes today
}

export async function partnerStudy(db: D1Database, s: Settings, now: number): Promise<PartnerStudyView> {
  const snap = await studySnapshot(db, s, now);
  const shared = await studyBetween(db, snap.cycle.startTs, now + 1, now, { sharedOnly: true });
  let label: string | null = null;
  let hidden = false;
  if (snap.running !== null) {
    const timer = await db.prepare(`SELECT category_id FROM study_timer WHERE id = 1`).first<{ category_id: number }>();
    const c = await db.prepare(`SELECT icon, title, share_with_partner AS v FROM categories WHERE id = ?1`).bind(timer?.category_id ?? 1).first<{ icon: string; title: string; v: number }>();
    if (c && c.v === 1) label = `${c.icon} ${c.title}`;
    else hidden = true;
  }
  const acts = (
    await db
      .prepare(
        `SELECT c.title AS title FROM study_sessions s JOIN categories c ON c.id = s.category_id
          WHERE s.created_at >= ?1 AND s.created_at <= ?2 AND c.share_with_partner = 1 GROUP BY s.category_id HAVING SUM(s.minutes) > 0 ORDER BY SUM(s.minutes) DESC`,
      )
      .bind(snap.cycle.startTs, now)
      .all<{ title: string }>()
  ).results;
  return { today_minutes: shared.minutes, running: snap.running, running_label: label, busy_hidden: hidden, idle_hours: snap.idleHours, activities: acts.map((a) => a.title) };
}

export async function logStudy(db: D1Database, s: Settings, minutes: number, note: string | null, now: number, categoryId = 1): Promise<number> {
  const r = await db
    .prepare(`INSERT INTO study_sessions (minutes, note, date, created_at, category_id) VALUES (?1, ?2, ?3, ?4, ?5) RETURNING id`)
    .bind(minutes, note, localDate(now, s.timezone), now, categoryId)
    .first<{ id: number }>();
  return r ? r.id : 0;
}

export async function deleteStudy(db: D1Database, id: number): Promise<void> {
  await db.prepare(`DELETE FROM study_sessions WHERE id = ?1`).bind(id).run();
}

// ------------------------------------------------------------------ composing a message
/** 2 -> "2", 2.5 -> "2.5" (then converted to the chosen digits). */
function hoursLabel(h: number, d: (v: string | number) => string): string {
  const r = Math.round(h * 2) / 2;
  return d(Number.isInteger(r) ? String(r) : String(r).replace('.', '٫'));
}

/** 1.5 -> "۱٫۵" (Persian digits) or "1.5". */
export function decimalLabel(n: number, mode: 'fa' | 'en'): string {
  return mode === 'fa' ? makeDigits('fa')(String(n).replace('.', '٫')) : String(n);
}

export function formatTemplate(text: string, vars: { hours: number; partner: string; activity?: string }, d: (v: string | number) => string): string {
  return text
    // replacer functions: a name or title that contains "$&" must stay exactly as written
    .replace(/\{hours\}/g, () => hoursLabel(vars.hours, d))
    .replace(/\{partner\}/g, () => vars.partner)
    .replace(/\{activity\}/g, () => vars.activity ?? 'درس');
}

function fallbackText(category: TemplateCategory): string {
  switch (category) {
    case 'partner_not_studying':
      return 'وقت درس خوندنه! گوشی رو بذار کنار و برگرد سر کتابات 📚';
    case 'user_slacking':
      return 'گزارش: امروز درس نخوندم و کمک لازم دارم. بیا یه تلنگر بزن 😅';
    case 'user_studied_hard':
      return 'گزارش: امروز کلی درس خوندم و نیاز به روحیه دارم! 💪';
    default:
      return 'یادآور برنامه‌ی روزانه!';
  }
}

/**
 * Pick a random active template. `conds` are tried first; then any active template of the category.
 * If the real number of hours is below 1, templates that talk about "{hours} ساعت" are avoided.
 */
export async function pickTemplate(db: D1Database, category: TemplateCategory, conds: TimeCondition[], hours: number): Promise<MessageTemplate | null> {
  const noHours = hours < 1 ? ` AND message_text NOT LIKE '%{hours}%'` : '';
  const marks = conds.map((_, i) => `?${i + 2}`).join(', ');
  const first = await db
    .prepare(`SELECT * FROM message_templates WHERE category = ?1 AND is_active = 1 AND time_condition IN (${marks})${noHours} ORDER BY RANDOM() LIMIT 1`)
    .bind(category, ...conds)
    .first<MessageTemplate>();
  if (first) return first;
  const any = await db
    .prepare(`SELECT * FROM message_templates WHERE category = ?1 AND is_active = 1${noHours} ORDER BY RANDOM() LIMIT 1`)
    .bind(category)
    .first<MessageTemplate>();
  if (any) return any;
  return db
    .prepare(`SELECT * FROM message_templates WHERE category = ?1 AND is_active = 1 ORDER BY RANDOM() LIMIT 1`)
    .bind(category)
    .first<MessageTemplate>();
}

/**
 * The number of hours that goes into a message of this category.
 * For "partner_not_studying" we do not know how long SHE has been idle, so we use 0 and
 * templates that mention {hours} are not picked.
 */
function hoursFor(category: TemplateCategory, snap: StudySnapshot): number {
  if (category === 'partner_not_studying') return 0;
  if (category === 'user_slacking') return snap.idleHours;
  return snap.todayHours;
}

const MANUAL_CONDS: Record<TemplateCategory, TimeCondition[]> = {
  partner_not_studying: ['manual', 'any', 'after_2_hours_idle'],
  user_slacking: ['manual', 'any', 'after_2_hours_idle'],
  user_studied_hard: ['manual', 'any', 'after_4_hours_study'],
  custom_scheduled: ['manual', 'any'],
};

export interface Composed {
  text: string;
  template_id: number | null;
}

export async function composeMessage(db: D1Database, category: TemplateCategory, now: number, conds?: TimeCondition[]): Promise<Composed> {
  const [s, p] = await Promise.all([loadSettings(db), getPartner(db)]);
  const snap = await studySnapshot(db, s, now);
  const hours = hoursFor(category, snap);
  const tpl = await pickTemplate(db, category, conds ?? MANUAL_CONDS[category], hours);
  const raw = tpl ? tpl.message_text : fallbackText(category);
  const activity = await activityLabel(db, snap.cycle.startTs, now);
  return { text: formatTemplate(raw, { hours, partner: p.name, activity }, makeDigits(s.digits)), template_id: tpl ? tpl.id : null };
}

// ------------------------------------------------------------------ sending
export async function sendToPartner(tg: Telegram, p: PartnerSettings, text: string): Promise<TgRes<{ message_id: number }>> {
  if (!p.chat_id) return { ok: false, code: 0, description: 'no partner' };
  return tg.sendMessage(Number(p.chat_id), escapeHtml(text));
}

export type TriggerResult = { ok: true; text: string; name: string } | { ok: false; reason: 'not_paired' | 'failed'; name: string };

/** Compose + send one message of `category` right now (used by the bot commands). */
export async function triggerNow(env: Env, tg: Telegram, category: TemplateCategory, now: number): Promise<TriggerResult> {
  const p = await getPartner(env.DB);
  if (!p.chat_id) return { ok: false, reason: 'not_paired', name: p.name };
  const msg = await composeMessage(env.DB, category, now);
  const r = await sendToPartner(tg, p, msg.text);
  if (!r.ok) return { ok: false, reason: 'failed', name: p.name };
  await env.DB.prepare(`UPDATE partner_settings SET last_notified_at = ?1 WHERE id = 1`).bind(now).run();
  return { ok: true, text: msg.text, name: p.name };
}

// ------------------------------------------------------------------ automatic messages (called every minute)
const SLACK_SLOT_SEC = 2 * 3600;

export async function runPartnerAuto(env: Env, tg: Telegram, s: Settings, now: number): Promise<void> {
  const db = env.DB;
  const p = await db.prepare(`SELECT * FROM partner_settings WHERE id = 1`).first<PartnerSettings>();
  if (!p || !p.chat_id || !p.auto_notify_enabled) return;

  const snap = await studySnapshot(db, s, now);
  const { plan, day: today, minutes: nowMin } = snap.cycle;
  const wakeMin = toMinutes(plan.wake);
  const sleepMin = sleepMinutes(plan);

  // Possible messages right now, most important first. Each has a key, so it goes out once per day / per slot.
  interface Candidate {
    category: TemplateCategory;
    cond: TimeCondition;
    key: string;
  }
  const candidates: Candidate[] = [];

  if (snap.todayHours >= p.hard_study_threshold_hours) {
    candidates.push({ category: 'user_studied_hard', cond: 'after_4_hours_study', key: `partner:hard:${today}` });
  } else if (nowMin >= wakeMin + 120 && nowMin <= sleepMin - 60 && snap.idleHours >= p.idle_threshold_hours) {
    // Being in class counts as "not idle".
    const inClass = await db
      .prepare(`SELECT 1 AS x FROM occurrences WHERE start_ts <= ?1 AND end_ts > ?1 AND is_test = 0 AND status NOT IN ('cancelled', 'skipped') LIMIT 1`)
      .bind(now)
      .first();
    if (!inClass) {
      candidates.push({ category: 'user_slacking', cond: 'after_2_hours_idle', key: `partner:slack:${today}:${Math.floor((now - snap.dayStart) / SLACK_SLOT_SEC)}` });
    }
  }
  if (nowMin >= wakeMin + 60 && nowMin < wakeMin + 90) candidates.push({ category: 'custom_scheduled', cond: 'morning', key: `partner:morning:${today}` });
  if (nowMin >= sleepMin - 30 && nowMin < sleepMin) candidates.push({ category: 'custom_scheduled', cond: 'night', key: `partner:night:${today}` });

  for (const c of candidates) {
    // Exactly once per key, even if two cron runs overlap. Already sent? Then look at the next candidate.
    if (!(await claim(db, c.key, now))) continue;

    const hours = hoursFor(c.category, snap);
    const tpl = await pickTemplate(db, c.category, [c.cond, 'any'], hours);
    const activity = await activityLabel(db, snap.cycle.startTs, now);
    const text = formatTemplate(tpl ? tpl.message_text : fallbackText(c.category), { hours, partner: p.name, activity }, makeDigits(s.digits));
    const r = await sendToPartner(tg, p, text);
    if (r.ok) {
      await markSent(db, c.key, r.result.message_id);
      await db.prepare(`UPDATE partner_settings SET last_notified_at = ?1 WHERE id = 1`).bind(now).run();
    } else {
      await markFailed(db, c.key);
    }
    return; // at most one message per minute
  }
}

// ------------------------------------------------------------------ messages from people who are not the owner
/** Strangers are ignored, except: pairing with a valid code, and the connected partner's /app and /stop. */
export async function handleOutsiderUpdate(env: Env, tg: Telegram, update: TgUpdate, now: number): Promise<void> {
  const msg = update.message;
  if (!msg || !msg.from || msg.chat.type !== 'private' || !msg.text) return;
  const text = msg.text.trim();
  if (!text.startsWith('/')) return;

  const db = env.DB;
  const chatId = msg.chat.id;
  const parts = text.split(/\s+/);
  const cmd = parts[0].slice(1).split('@')[0].toLowerCase();
  const arg = parts[1] ?? '';
  const code = cmd === 'pair' ? arg : cmd === 'start' && arg.startsWith('pair_') ? arg.slice(5) : null;

  const [texts, p] = await Promise.all([loadTexts(db), getPartner(db)]);
  const isPartner = p.chat_id !== null && p.chat_id === String(chatId);

  if (code !== null) {
    if (isPartner) {
      // Already connected (possibly to this very owner): say so instead of staying silent.
      await tg.sendMessage(chatId, 'تو الان به یه نفر وصلی. اگه می‌خوای به کس دیگه وصل بشی، اول /stop رو بزن.');
      return;
    }
    // One person can be the partner of only one owner: never silently replace an existing link.
    const other = await partnerOwner(env, chatId);
    if (other !== null && other !== Number(env.OWNER_ID)) {
      await tg.sendMessage(chatId, 'تو الان پارتنر یه نفر دیگه‌ای هستی. اول باید از اون ارتباط خارج بشی: /stop');
      return;
    }
    const ok = await pairByCode(db, code, chatId, msg.from.first_name ?? '', now);
    if (!ok) {
      await tg.sendMessage(chatId, render(texts, 'partner_bad_code'));
      return;
    }
    await linkPartner(env, chatId);
    const fresh = await getPartner(db);
    await tg.sendMessage(chatId, render(texts, 'partner_paired_partner'));
    await tg.sendMessage(Number(env.OWNER_ID), render(texts, 'partner_paired_owner', { name: fresh.name }));
    if (env.APP_URL) {
      await tg.setChatMenuButton(chatId, 'برنامه', env.APP_URL);
      await sendPartnerAppButton(env, tg, chatId, texts);
    }
    return;
  }

  if (!isPartner) return; // everybody else: silence

  if (cmd === 'stop') {
    await unpair(db);
    await unlinkPartner(env, chatId);
    await tg.sendMessage(chatId, render(texts, 'partner_unpaired_partner'));
    await tg.sendMessage(Number(env.OWNER_ID), render(texts, 'partner_unpaired_owner', { name: p.name }));
    return;
  }
  if (cmd === 'app' || cmd === 'start') {
    await sendPartnerAppButton(env, tg, chatId, texts);
  }
}

async function sendPartnerAppButton(env: Env, tg: Telegram, chatId: number, texts: Map<string, string>): Promise<void> {
  if (!env.APP_URL) return;
  await tg.sendMessage(chatId, render(texts, 'partner_open_app'), [[{ text: renderPlain(texts, 'btn_open_app'), web_app: { url: env.APP_URL } }]]);
}
