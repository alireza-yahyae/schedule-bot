// Daily challenge written by the partner: a reward for studying enough, a punishment for studying too little.

import type { Env, Settings } from './types.ts';
import type { Telegram } from './telegram.ts';
import { ApiError, bad } from './http.ts';
import { cycleOfDay, currentCycle } from './overrides.ts';
import { escapeHtml } from './messages.ts';
import { getPartner, studyBetween, studySnapshot } from './partner.ts';
import { getCategory } from './categories.ts';
import { addDays, localDate, makeDigits } from './time.ts';

export interface ChallengeRow {
  id: number;
  day: string;
  target_hours: number | null;
  reward_text: string | null;
  min_hours: number | null;
  punishment_text: string | null;
  settled_at: number | null;
  result_minutes: number | null;
  reward_earned: number | null;
  punishment_due: number | null;
  category_id: number | null; // NULL = every category counts
}
const COLS = 'id, day, target_hours, reward_text, min_hours, punishment_text, settled_at, result_minutes, reward_earned, punishment_due, category_id';

export interface ChallengeView extends ChallengeRow {
  label: string; // امروز / فردا / date
  progress_minutes: number | null; // only for the current day
  scope_label: string; // what counts: "⏱ همه‌ی فعالیت‌ها" or "💼 کار"
  state: 'upcoming' | 'running' | 'reward_earned' | 'at_risk' | 'settled';
}

function hoursField(v: unknown, label: string): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0.5 || n > 16) bad(`${label} باید بین ۰٫۵ و ۱۶ ساعت باشه`);
  return Math.round(n * 2) / 2;
}
function textField(v: unknown, label: string): string | null {
  const t = String(v ?? '').trim();
  if (!t) return null;
  if (t.length > 200) bad(`${label} حداکثر ۲۰۰ حرف می‌تونه باشه`);
  return t;
}

interface Scope {
  id: number | null;
  title: string;
  icon: string;
}
const ALL_SCOPE: Scope = { id: null, title: 'همه‌ی فعالیت‌ها', icon: '⏱' };

async function scopeOf(db: D1Database, categoryId: number | null): Promise<Scope> {
  if (!categoryId) return ALL_SCOPE;
  const c = await getCategory(db, categoryId);
  return c ? { id: c.id, title: c.title, icon: c.icon } : ALL_SCOPE;
}

/** How the hours are worded: "درس بخونی", "«کار» ثبت کنی" or just "فعالیت کنی" for everything. */
function doing(sc: Scope): string {
  if (sc.id === null) return 'فعالیت کنی';
  if (sc.id === 1) return 'درس بخونی';
  return `«${sc.title}» ثبت کنی`;
}

export function describe(
  c: Pick<ChallengeRow, 'target_hours' | 'reward_text' | 'min_hours' | 'punishment_text'>,
  d: (v: string | number) => string,
  sc: Scope = ALL_SCOPE,
): string[] {
  const hrs = (n: number) => d(String(n).replace('.', '٫'));
  const lines: string[] = [];
  if (c.reward_text && c.target_hours) lines.push(`🎁 اگه ${hrs(c.target_hours)} ساعت یا بیشتر ${doing(sc)}: ${c.reward_text}`);
  if (c.punishment_text && c.min_hours) lines.push(`😈 اگه کمتر از ${hrs(c.min_hours)} ساعت ${doing(sc)}: ${c.punishment_text}`);
  return lines;
}

export async function listChallenges(db: D1Database, fromDay: string): Promise<ChallengeRow[]> {
  return (await db.prepare(`SELECT ${COLS} FROM challenges WHERE day >= ?1 ORDER BY day DESC LIMIT 40`).bind(addDays(fromDay, -14)).all<ChallengeRow>()).results;
}

/** Challenges for the current day and the next one, with live progress. */
export async function challengeViews(db: D1Database, s: Settings, now: number): Promise<{ today: ChallengeView | null; tomorrow: ChallengeView | null; history: ChallengeView[] }> {
  const snap = await studySnapshot(db, s, now);
  const day = snap.cycle.day;
  const rows = await listChallenges(db, day);
  const view = async (c: ChallengeRow): Promise<ChallengeView> => {
    const isToday = c.day === day;
    const sc = await scopeOf(db, c.category_id);
    const progress = !isToday ? null : sc.id === null ? snap.todayMinutes : (await studyBetween(db, snap.cycle.startTs, now + 1, now, { categoryId: sc.id })).minutes;
    let state: ChallengeView['state'] = c.settled_at ? 'settled' : isToday ? 'running' : 'upcoming';
    if (!c.settled_at && isToday && progress !== null) {
      if (c.target_hours && progress >= c.target_hours * 60) state = 'reward_earned';
      else if (c.min_hours && progress < c.min_hours * 60) state = 'at_risk';
    }
    return { ...c, label: c.day === day ? 'امروز' : c.day === addDays(day, 1) ? 'فردا' : c.day, progress_minutes: progress, scope_label: `${sc.icon} ${sc.title}`, state };
  };
  const all: ChallengeView[] = [];
  for (const r of rows) all.push(await view(r));
  return { today: all.find((c) => c.day === day) ?? null, tomorrow: all.find((c) => c.day === addDays(day, 1)) ?? null, history: all.filter((c) => c.settled_at).slice(0, 10) };
}

export async function saveChallenge(env: Env, tg: Telegram, s: Settings, now: number, b: Record<string, unknown>): Promise<ChallengeRow> {
  const db = env.DB;
  const cyc = await currentCycle(db, s.timezone, now);
  const which = b.day;
  const day = which === undefined || which === 'today' ? cyc.day : which === 'tomorrow' ? addDays(cyc.day, 1) : String(which);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < cyc.day || day > addDays(cyc.day, 6)) bad('تاریخ چالش باید از امروز تا هفت روز آینده باشه');

  const target = hoursField(b.target_hours, 'هدف جایزه');
  const reward = textField(b.reward_text, 'متن جایزه');
  const min = hoursField(b.min_hours, 'حداقل ساعت');
  const punishment = textField(b.punishment_text, 'متن تنبیه');
  if ((reward === null) !== (target === null)) bad('برای جایزه هم متن لازمه هم ساعت');
  if ((punishment === null) !== (min === null)) bad('برای تنبیه هم متن لازمه هم ساعت');
  if (reward === null && punishment === null) bad('حداقل یکی از جایزه یا تنبیه رو بنویس');
  if (target !== null && min !== null && min > target) bad('حداقل ساعتِ تنبیه نباید از هدف جایزه بیشتر باشه');

  // What counts: one category, or everything (empty / "all").
  let categoryId: number | null = null;
  if (b.category_id !== undefined && b.category_id !== null && b.category_id !== '' && b.category_id !== 'all') {
    const cat = await getCategory(db, Number(b.category_id));
    if (!cat || !cat.is_active || !cat.share_with_partner) bad('این دسته برای چالش قابل انتخاب نیست');
    categoryId = cat.id;
  }

  const old = await db.prepare(`SELECT id, settled_at FROM challenges WHERE day = ?1`).bind(day).first<{ id: number; settled_at: number | null }>();
  if (old && old.settled_at) bad('این چالش تموم شده و دیگه قابل تغییر نیست.');
  const row = await db
    .prepare(
      `INSERT INTO challenges (day, target_hours, reward_text, min_hours, punishment_text, created_at, category_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
       ON CONFLICT(day) DO UPDATE SET target_hours = ?2, reward_text = ?3, min_hours = ?4, punishment_text = ?5, category_id = ?7
       RETURNING ${COLS}`,
    )
    .bind(day, target, reward, min, punishment, now, categoryId)
    .first<ChallengeRow>();
  if (!row) throw new ApiError(500, 'ذخیره نشد');

  // Tell the owner: "we have a challenge from your partner".
  const p = await getPartner(db);
  const lines = describe(row, makeDigits(s.digits), await scopeOf(db, row.category_id));
  const when = day === cyc.day ? 'امروز' : day === addDays(cyc.day, 1) ? 'فردا' : day;
  const silent = !cyc.awake;
  await tg.sendMessage(Number(env.OWNER_ID), `🏆 <b>چالش از طرف ${escapeHtml(p.name)}</b> برای ${when}:\n\n${lines.map(escapeHtml).join('\n')}`, undefined, silent);
  return row;
}

export async function deleteChallenge(db: D1Database, id: number): Promise<void> {
  const row = await db.prepare(`SELECT settled_at FROM challenges WHERE id = ?1`).bind(id).first<{ settled_at: number | null }>();
  if (!row) throw new ApiError(404, 'این چالش پیدا نشد');
  if (row.settled_at) bad('چالش تموم‌شده رو نمی‌شه حذف کرد.');
  await db.prepare(`DELETE FROM challenges WHERE id = ?1`).bind(id).run();
}

/** After the owner's bedtime the day is over: count the study hours and tell both of them who won. */
export async function settleChallenges(env: Env, tg: Telegram, s: Settings, now: number): Promise<void> {
  const db = env.DB;
  const open = (await db.prepare(`SELECT ${COLS} FROM challenges WHERE settled_at IS NULL AND day <= ?1`).bind(addDays(localDate(now, s.timezone), 1)).all<ChallengeRow>()).results;
  for (const c of open) {
    const cyc = await cycleOfDay(db, c.day, s.timezone);
    if (now < cyc.sleepTs) continue;
    const sc = await scopeOf(db, c.category_id);
    const { minutes } = await studyBetween(db, cyc.startTs, cyc.sleepTs, now, sc.id === null ? {} : { categoryId: sc.id });
    const earned = c.reward_text && c.target_hours && minutes >= c.target_hours * 60 ? 1 : 0;
    const due = c.punishment_text && c.min_hours && minutes < c.min_hours * 60 ? 1 : 0;
    const r = await db
      .prepare(`UPDATE challenges SET settled_at = ?1, result_minutes = ?2, reward_earned = ?3, punishment_due = ?4 WHERE id = ?5 AND settled_at IS NULL`)
      .bind(now, minutes, earned, due, c.id)
      .run();
    if ((r.meta.changes ?? 0) === 0) continue; // another cron run got it first

    const d = makeDigits(s.digits);
    const p = await getPartner(db);
    const hrs = d(String(Math.round((minutes / 60) * 10) / 10).replace('.', '٫'));
    const verdict = earned ? `🎉 جایزه‌ی برنده: ${c.reward_text}` : due ? `😅 تنبیه: ${c.punishment_text}` : '😐 نه جایزه نه تنبیه؛ وسط‌بازی بود.';
    const text = `🏁 <b>نتیجه‌ی چالش ${escapeHtml(c.day === localDate(now, s.timezone) ? 'امروز' : c.day)}</b>\n\n${escapeHtml(sc.icon)} ${escapeHtml(sc.id === null ? 'کل فعالیت' : sc.title)}: ${hrs} ساعت\n${escapeHtml(verdict)}`;
    await tg.sendMessage(Number(env.OWNER_ID), text, undefined, true);
    if (p.chat_id) await tg.sendMessage(Number(p.chat_id), text);
  }
}
