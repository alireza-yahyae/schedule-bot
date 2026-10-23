// Handles everything Telegram sends us: commands, typed text and button presses.
// Only the owner (OWNER_ID) is served. Everyone else is silently ignored, except the partner
// pairing / /stop / /app messages (see handleOutsiderUpdate in partner.ts).

import type { Env, InlineKeyboard, Occ, Settings, TgCallbackQuery, TgMessage, TgUpdate } from './types.ts';
import { Telegram } from './telegram.ts';
import { emit, getOcc, loadSettings, loadTexts, setSetting } from './db.ts';
import { decimalLabel, handleOutsiderUpdate, logStudy, studySnapshot, triggerNow } from './partner.ts';
import { jalaliSlash, jalaliText } from './jalali.ts';
import { STATUS_EMOJI, STATUS_LABEL, escapeHtml, render, renderPlain } from './messages.ts';
import { ensureOccurrences } from './occurrences.ts';
import { classVars, retireMessage } from './scheduler.ts';
import { WEEKDAY_FA, addDays, daysBetween, enDigits, iranWeekday, localDate, localHM, makeDigits } from './time.ts';

const OPEN_STATUSES = `('upcoming','awaiting_reason','no_response','unmarked')`;

const COMMANDS = [
  { command: 'app', description: 'باز کردن برنامه (Mini App)' },
  { command: 'today', description: 'برنامه امروز' },
  { command: 'tomorrow', description: 'برنامه فردا' },
  { command: 'week', description: 'برنامه هفته' },
  { command: 'courses', description: 'درس‌ها و امتحان‌ها' },
  { command: 'study', description: 'ثبت مطالعه (مثلاً /study 90)' },
  { command: 'work', description: 'ثبت کار (مثلاً /work 90)' },
  { command: 'slacking', description: 'به پارتنر بگو درس نخوندی' },
  { command: 'studied', description: 'به پارتنر بگو کلی درس خوندی' },
  { command: 'remind_partner', description: 'یادآوری درس خوندن برای پارتنر' },
  { command: 'pause', description: 'توقف موقت یادآوری‌ها' },
  { command: 'resume', description: 'شروع دوباره یادآوری‌ها' },
  { command: 'test', description: 'ساخت کلاس تستی' },
  { command: 'help', description: 'راهنما' },
];

export function isOwner(env: Env, id: number | undefined): boolean {
  return id !== undefined && String(id) === String(env.OWNER_ID).trim();
}

export async function handleUpdate(env: Env, tg: Telegram, update: TgUpdate, now: number): Promise<void> {
  if (update.callback_query) {
    const cb = update.callback_query;
    if (!isOwner(env, cb.from.id)) return; // ignore strangers
    await handleCallback(env, tg, cb, now);
    return;
  }
  const msg = update.message;
  if (!msg || !msg.from) return;
  if (!isOwner(env, msg.from.id)) {
    await handleOutsiderUpdate(env, tg, update, now); // pairing, /stop and /app for the partner
    return;
  }
  if (msg.chat.type !== 'private' || !msg.text) return;
  await handleText(env, tg, msg, now);
}

// ================================================================ typed text and commands
async function handleText(env: Env, tg: Telegram, msg: TgMessage, now: number): Promise<void> {
  const db = env.DB;
  const chatId = msg.chat.id;
  const text = (msg.text ?? '').trim();
  const [s, texts] = await Promise.all([loadSettings(db), loadTexts(db)]);
  const d = makeDigits(s.digits);
  const send = (t: string) => tg.sendMessage(chatId, t);

  if (text.startsWith('/')) {
    const parts = text.split(/\s+/);
    const cmd = parts[0].slice(1).split('@')[0].toLowerCase();
    const args = parts.slice(1);

    switch (cmd) {
      case 'start': {
        // people with their own database can also delete everything they stored (handled in gateway.ts)
        await tg.setMyCommands(chatId, env.TENANT_ID ? [...COMMANDS, { command: 'delete_me', description: 'پاک کردن همه‌ی اطلاعات من' }] : COMMANDS);
        if (env.APP_URL) await tg.setChatMenuButton(chatId, 'برنامه', env.APP_URL);
        await send(render(texts, 'welcome', { name: msg.from?.first_name ?? '' }));
        if (env.APP_URL) await sendAppButton(env, tg, chatId, texts);
        return;
      }
      case 'app': {
        await sendAppButton(env, tg, chatId, texts);
        return;
      }
      case 'help': {
        await send(render(texts, 'help'));
        return;
      }
      case 'today': {
        await send(await dayText(db, s, texts, 'today_title', localDate(now, s.timezone), now));
        return;
      }
      case 'tomorrow': {
        await send(await dayText(db, s, texts, 'tomorrow_title', addDays(localDate(now, s.timezone), 1), now));
        return;
      }
      case 'week': {
        await send(await weekText(db, s, texts));
        return;
      }
      case 'courses': {
        await send(await coursesText(db, s, texts, now));
        return;
      }
      case 'pause': {
        let hours = 1;
        const arg = enDigits((args[0] ?? '').toLowerCase());
        if (arg === 'day' || arg === 'روز') {
          hours = 24;
        } else if (arg !== '') {
          const n = Number(arg);
          if (!Number.isFinite(n) || n <= 0) {
            await send(render(texts, 'pause_bad_arg'));
            return;
          }
          hours = Math.min(n, 24 * 14);
        }
        const until = now + Math.round(hours * 3600);
        await setSetting(db, 'paused_until', String(until), now);
        const untilText = `${jalaliText(localDate(until, s.timezone), d)} ساعت ${d(localHM(until, s.timezone))}`;
        await send(render(texts, 'paused', { until: untilText }));
        return;
      }
      case 'resume': {
        await setSetting(db, 'paused_until', '0', now);
        await send(render(texts, 'resumed'));
        return;
      }
      case 'study': {
        const arg = Number(enDigits(args[0] ?? ''));
        const minutes = args.length === 0 ? 60 : arg;
        if (!Number.isInteger(minutes) || minutes < 1 || minutes > 720) {
          await send('عدد دقیقه درست نیست. مثال: <code>/study 90</code>');
          return;
        }
        await logStudy(db, s, minutes, null, now);
        const snap = await studySnapshot(db, s, now);
        await send(render(texts, 'study_logged', { minutes: d(minutes), hours: decimalLabel(snap.todayHours, s.digits) }));
        return;
      }
      case 'work': {
        const arg = Number(enDigits(args[0] ?? ''));
        const minutes = args.length === 0 ? 60 : arg;
        if (!Number.isInteger(minutes) || minutes < 1 || minutes > 720) {
          await send('عدد دقیقه درست نیست. مثال: <code>/work 90</code>');
          return;
        }
        const cat = await db.prepare(`SELECT id FROM categories WHERE title = 'کار' AND is_active = 1 ORDER BY id LIMIT 1`).first<{ id: number }>();
        if (!cat) {
          await send('دسته‌ی «کار» پیدا نشد. از برنامه (/app) یه دسته با اسم «کار» بساز.');
          return;
        }
        await logStudy(db, s, minutes, null, now, cat.id);
        const snap = await studySnapshot(db, s, now);
        await send(`✅ ${d(minutes)} دقیقه کار ثبت شد. مجموع امروز: ${decimalLabel(snap.todayHours, s.digits)} ساعت.`);
        return;
      }
      case 'slacking':
      case 'studied':
      case 'remind_partner': {
        const category = cmd === 'slacking' ? 'user_slacking' : cmd === 'studied' ? 'user_studied_hard' : 'partner_not_studying';
        const r = await triggerNow(env, tg, category, now);
        if (r.ok) await send(render(texts, 'partner_sent', { name: r.name, text: r.text }));
        else await send(render(texts, r.reason === 'not_paired' ? 'partner_not_paired' : 'partner_send_failed', { name: r.name }));
        return;
      }
      case 'test': {
        const full = (args[0] ?? '').toLowerCase() === 'full';
        const minutes = full ? 16 : 2;
        const start = Math.ceil(now / 60) * 60 + minutes * 60;
        const end = start + 40 * 60;
        await db
          .prepare(
            `INSERT INTO occurrences (session_id, course_id, date, title, location, start_ts, end_ts, is_test)
             VALUES (NULL, NULL, ?1, ?2, ?3, ?4, ?5, 1)`,
          )
          .bind(
            localDate(now, s.timezone),
            texts.get('test_title') ?? 'Test class',
            texts.get('test_location') ?? null,
            start,
            end,
          )
          .run();
        await send(render(texts, 'test_created', { minutes: d(minutes) }));
        return;
      }
      default: {
        await send(render(texts, 'unknown_text'));
        return;
      }
    }
  }

  // Plain text: maybe it is the reason for skipping a class.
  const pending = await db
    .prepare(`SELECT ref_id FROM pending_input WHERE chat_id = ?1 AND kind = 'skip_reason'`)
    .bind(chatId)
    .first<{ ref_id: number }>();
  if (pending) {
    const o = await getOcc(db, pending.ref_id);
    await db.prepare(`DELETE FROM pending_input WHERE chat_id = ?1`).bind(chatId).run();
    if (o && o.status === 'awaiting_reason') {
      const reason = text.slice(0, 300);
      const r = await db
        .prepare(
          `UPDATE occurrences
              SET status = 'skipped', skip_reason = ?1, resolved_at = ?2, awaiting_since = NULL,
                  last_msg_id = NULL, last_msg_kind = NULL
            WHERE id = ?3 AND status = 'awaiting_reason'`,
        )
        .bind(reason, now, o.id)
        .run();
      if ((r.meta.changes ?? 0) > 0) {
        if (o.last_msg_id) await tg.stripKeyboard(chatId, o.last_msg_id);
        await emit(
          db,
          'class_skipped_with_reason',
          o.id,
          { title: o.title, reason, start_ts: o.start_ts, is_test: o.is_test },
          now,
        );
        await send(render(texts, 'marked_skipped', { class_name: o.title, reason }));
        return;
      }
    }
  }
  await send(render(texts, 'unknown_text'));
}

// ================================================================ button presses
async function handleCallback(env: Env, tg: Telegram, cb: TgCallbackQuery, now: number): Promise<void> {
  const db = env.DB;
  const m = /^c:(\w+):(\d+)$/.exec(cb.data ?? '');
  if (!m) {
    await tg.answerCallbackQuery(cb.id);
    return;
  }
  const action = m[1];
  const id = Number(m[2]);
  const chatId = cb.message?.chat.id ?? Number(env.OWNER_ID);
  const msgId = cb.message?.message_id;
  const [s, texts] = await Promise.all([loadSettings(db), loadTexts(db)]);
  const toast = (text: string, alert = false) => tg.answerCallbackQuery(cb.id, text, alert);

  const occ = await getOcc(db, id);
  if (!occ) {
    await toast(renderPlain(texts, 'old_button'), true);
    if (msgId) await tg.stripKeyboard(chatId, msgId);
    return;
  }
  const vars = classVars(occ, s);

  /** Replace the pressed message with new text; if that is impossible, send a new message. */
  const showResult = async (text: string, kb?: InlineKeyboard) => {
    if (msgId) {
      const r = await tg.editMessageText(chatId, msgId, text, kb);
      if (r.ok || r.description.includes('not modified')) return;
    }
    await tg.sendMessage(chatId, text, kb);
  };
  /** If the pressed message is not the newest message of this class, clean up the newest one too. */
  const retireOther = async () => {
    if (occ.last_msg_id && occ.last_msg_id !== msgId) await retireMessage({ db, tg, chatId }, occ);
  };

  if (action === 'ack') {
    // «باشه» = "I will go": from now on no more reminders and no questions about this class.
    await db.prepare(`UPDATE occurrences SET acked_at = ?1 WHERE id = ?2 AND status = 'upcoming' AND acked_at IS NULL`).bind(now, id).run();
    await tg.answerCallbackQuery(cb.id, renderPlain(texts, 'ack_toast'));
    if (msgId) await tg.stripKeyboard(chatId, msgId);
    return;
  }

  // Already decided earlier: old buttons must not change history.
  if (occ.status === 'attended' || occ.status === 'cancelled' || occ.status === 'skipped') {
    const same =
      (action === 'went' && occ.status === 'attended') ||
      (action === 'cancel' && occ.status === 'cancelled') ||
      ((action === 'skip' || action === 'noreason') && occ.status === 'skipped');
    await toast(
      same
        ? renderPlain(texts, 'already_same')
        : renderPlain(texts, 'already_other', { status: STATUS_LABEL[occ.status] ?? occ.status }),
    );
    if (msgId) await tg.stripKeyboard(chatId, msgId);
    return;
  }

  switch (action) {
    case 'went':
    case 'cancel': {
      const status = action === 'went' ? 'attended' : 'cancelled';
      const r = await db
        .prepare(
          `UPDATE occurrences
              SET status = ?1, resolved_at = ?2, awaiting_since = NULL, snooze_until = NULL,
                  last_msg_id = NULL, last_msg_kind = NULL
            WHERE id = ?3 AND status IN ${OPEN_STATUSES}`,
        )
        .bind(status, now, id)
        .run();
      if ((r.meta.changes ?? 0) === 0) {
        await toast(renderPlain(texts, 'old_button'), true);
        return;
      }
      await tg.answerCallbackQuery(cb.id);
      await db.prepare(`DELETE FROM pending_input WHERE chat_id = ?1 AND ref_id = ?2`).bind(chatId, id).run();
      await retireOther();
      if (action === 'cancel') {
        await emit(db, 'class_cancelled', id, { title: occ.title, start_ts: occ.start_ts, is_test: occ.is_test }, now);
      }
      await showResult(render(texts, action === 'went' ? 'marked_went' : 'marked_cancelled', vars));
      return;
    }

    case 'snooze': {
      if (occ.status !== 'upcoming' || now >= occ.end_ts) {
        await toast(renderPlain(texts, 'old_button'), true);
        if (msgId) await tg.stripKeyboard(chatId, msgId);
        return;
      }
      const r = await db
        .prepare(
          `UPDATE occurrences
              SET snooze_until = ?1, snooze_count = snooze_count + 1, nag_count = 0,
                  last_msg_id = NULL, last_msg_kind = NULL
            WHERE id = ?2 AND status = 'upcoming'`,
        )
        .bind(now + s.snoozeMin * 60, id)
        .run();
      if ((r.meta.changes ?? 0) === 0) {
        await toast(renderPlain(texts, 'old_button'), true);
        return;
      }
      await tg.answerCallbackQuery(cb.id);
      await retireOther();
      await showResult(render(texts, 'snoozed', { ...vars, minutes: makeDigits(s.digits)(s.snoozeMin) }));
      return;
    }

    case 'skip': {
      const r = await db
        .prepare(
          `UPDATE occurrences
              SET status = 'awaiting_reason', awaiting_since = ?1, last_msg_id = ?2, last_msg_kind = 'ask_reason'
            WHERE id = ?3 AND status IN ${OPEN_STATUSES}`,
        )
        .bind(now, msgId ?? null, id)
        .run();
      if ((r.meta.changes ?? 0) === 0) {
        await toast(renderPlain(texts, 'old_button'), true);
        return;
      }
      await db
        .prepare(`INSERT OR REPLACE INTO pending_input (chat_id, kind, ref_id, created_at) VALUES (?1, 'skip_reason', ?2, ?3)`)
        .bind(chatId, id, now)
        .run();
      await tg.answerCallbackQuery(cb.id);
      await retireOther();
      await showResult(render(texts, 'ask_reason', vars), noreasonKeyboard(texts, id));
      return;
    }

    case 'noreason': {
      const r = await db
        .prepare(
          `UPDATE occurrences
              SET status = 'skipped', skip_reason = NULL, resolved_at = ?1, awaiting_since = NULL,
                  last_msg_id = NULL, last_msg_kind = NULL
            WHERE id = ?2 AND status IN ${OPEN_STATUSES}`,
        )
        .bind(now, id)
        .run();
      if ((r.meta.changes ?? 0) === 0) {
        await toast(renderPlain(texts, 'old_button'), true);
        return;
      }
      await tg.answerCallbackQuery(cb.id);
      await db.prepare(`DELETE FROM pending_input WHERE chat_id = ?1 AND ref_id = ?2`).bind(chatId, id).run();
      await emit(db, 'class_skipped_no_reason', id, { title: occ.title, start_ts: occ.start_ts, is_test: occ.is_test }, now);
      await showResult(render(texts, 'marked_skipped_noreason', vars));
      return;
    }

    default: {
      await tg.answerCallbackQuery(cb.id);
    }
  }
}

async function sendAppButton(env: Env, tg: Telegram, chatId: number, texts: Map<string, string>): Promise<void> {
  if (!env.APP_URL) {
    await tg.sendMessage(chatId, 'APP_URL تنظیم نشده. فایل wrangler.toml رو چک کن.');
    return;
  }
  await tg.sendMessage(chatId, render(texts, 'open_app'), [
    [{ text: renderPlain(texts, 'btn_open_app'), web_app: { url: env.APP_URL } }],
  ]);
}

function noreasonKeyboard(texts: Map<string, string>, occId: number): InlineKeyboard {
  return [[{ text: renderPlain(texts, 'btn_noreason'), callback_data: `c:noreason:${occId}` }]];
}

// ================================================================ text views
async function dayText(
  db: D1Database,
  s: Settings,
  texts: Map<string, string>,
  titleKey: string,
  date: string,
  now: number,
): Promise<string> {
  const d = makeDigits(s.digits);
  await ensureOccurrences(db, date, s.timezone);
  const rows = await db
    .prepare(`SELECT * FROM occurrences WHERE date = ?1 ORDER BY start_ts`)
    .bind(date)
    .all<Occ>();
  const day = `${WEEKDAY_FA[iranWeekday(date)]} ${jalaliText(date, d)}`;
  const lines = [render(texts, titleKey, { day }), ''];
  if (rows.results.length === 0) lines.push(render(texts, 'no_classes'));
  for (const o of rows.results) {
    let emoji = STATUS_EMOJI[o.status] ?? '▫️';
    if (o.status === 'upcoming' && now >= o.start_ts && now < o.end_ts) emoji = '🔔';
    const loc = o.location ? ` — ${escapeHtml(o.location)}` : '';
    const range = `${d(localHM(o.start_ts, s.timezone))}–${d(localHM(o.end_ts, s.timezone))}`;
    lines.push(`${emoji} ${range}  <b>${escapeHtml(o.title)}</b>${loc}`);
  }
  return lines.join('\n');
}

async function weekText(
  db: D1Database,
  s: Settings,
  texts: Map<string, string>,
): Promise<string> {
  const d = makeDigits(s.digits);
  const rows = await db
    .prepare(
      `SELECT s.weekday, s.start_time, s.end_time, c.name, COALESCE(s.location, c.location) AS loc
         FROM course_sessions s
         JOIN courses c   ON c.id = s.course_id
         JOIN semesters m ON m.id = c.semester_id
        WHERE s.active = 1 AND c.active = 1 AND m.is_active = 1 AND m.archived_at IS NULL
        ORDER BY s.weekday, s.start_time`,
    )
    .all<{ weekday: number; start_time: string; end_time: string; name: string; loc: string | null }>();
  const lines = [render(texts, 'week_title'), ''];
  for (let wd = 0; wd < 7; wd++) {
    lines.push(`<b>${WEEKDAY_FA[wd]}</b>`);
    const day = rows.results.filter((r) => r.weekday === wd);
    if (day.length === 0) lines.push(`   ${render(texts, 'day_free')}`);
    for (const r of day) {
      const loc = r.loc ? ` — ${escapeHtml(r.loc)}` : '';
      lines.push(`   ${d(r.start_time)}–${d(r.end_time)}  ${escapeHtml(r.name)}${loc}`);
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

async function coursesText(
  db: D1Database,
  s: Settings,
  texts: Map<string, string>,
  now: number,
): Promise<string> {
  const d = makeDigits(s.digits);
  const today = localDate(now, s.timezone);
  const rows = await db
    .prepare(
      `SELECT c.name, c.group_no, c.exam_date, c.exam_start, c.exam_end, c.exam_location
         FROM courses c
         JOIN semesters m ON m.id = c.semester_id
        WHERE c.active = 1 AND m.is_active = 1 AND m.archived_at IS NULL
        ORDER BY c.exam_date IS NULL, c.exam_date, c.name`,
    )
    .all<{
      name: string;
      group_no: string | null;
      exam_date: string | null;
      exam_start: string | null;
      exam_end: string | null;
      exam_location: string | null;
    }>();
  const lines = [render(texts, 'courses_title'), ''];
  for (const c of rows.results) {
    const grp = c.group_no ? ` (گروه ${d(c.group_no)})` : '';
    lines.push(`📚 <b>${escapeHtml(c.name)}</b>${grp}`);
    if (c.exam_date && /^\d{4}-\d{2}-\d{2}$/.test(c.exam_date)) {
      const left = daysBetween(today, c.exam_date);
      const leftText = left > 0 ? `${d(left)} روز مانده` : left === 0 ? 'امروزه!' : 'گذشته';
      const time = c.exam_start && c.exam_end ? ` — ساعت ${d(c.exam_start)} تا ${d(c.exam_end)}` : '';
      const where = c.exam_location ? ` — ${escapeHtml(c.exam_location)}` : '';
      lines.push(`   🗓 امتحان: ${jalaliSlash(c.exam_date, d)}${time}${where} — ${leftText}`);
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}
