// A copy of your data as one JSON file, sent to you in Telegram (Friday evening, or when you ask for it).

import { claim, loadRawSettings, markFailed, markSent } from './db.ts';
import { addDays, iranWeekday, localDate, localHM } from './time.ts';
import type { Env, Settings } from './types.ts';
import type { Telegram } from './telegram.ts';

/** Everything that is yours. Left out: the partner's chat and pairing data, the outbox, today's reminders and logs (they are rebuilt). */
const TABLES = [
  'settings', 'bot_texts', 'message_templates', 'semesters', 'courses', 'course_sessions', 'day_overrides',
  'categories', 'study_sessions', 'focus_sessions', 'tasks', 'habits', 'habit_logs', 'grades', 'challenges',
  'meal_log', 'partner_library', 'day_logs', 'mood_logs', 'achievements',
  'occurrences', 'study_timer', 'partner_settings',
] as const;

/** Columns that tie the backup to one partner's Telegram chat: never exported. */
const PRIVATE_COLUMNS: Record<string, string[]> = { partner_settings: ['pairing_code', 'chat_id'] };

const SKIP_SETTINGS = new Set(['last_tick']);

export async function buildBackup(db: D1Database, now: number): Promise<string> {
  const data: Record<string, unknown[]> = {};
  for (const t of TABLES) {
    const rows = (await db.prepare(`SELECT * FROM ${t}`).all<Record<string, unknown>>()).results;
    const hidden = PRIVATE_COLUMNS[t] ?? [];
    const clean = hidden.length ? rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !hidden.includes(k)))) : rows;
    data[t] = t === 'settings' ? clean.filter((r) => !SKIP_SETTINGS.has(String(r.key))) : clean;
  }
  return JSON.stringify({ app: 'schedule-bot', version: 1, created_at: now, tables: data }, null, 1);
}

export async function sendBackup(env: Env, tg: Telegram, s: Settings, now: number): Promise<{ ok: boolean; bytes: number }> {
  const json = await buildBackup(env.DB, now);
  const name = `schedule-bot-backup-${localDate(now, s.timezone)}.json`;
  const r = await tg.sendDocument(Number(env.OWNER_ID), name, json, '💾 <b>بکاپ داده‌ها</b>\nاین فایل رو یه جای امن نگه دار.');
  return { ok: r.ok, bytes: json.length };
}

/** Friday evening, right after the weekly report. Exactly once per week. */
export async function sendWeeklyBackup(env: Env, tg: Telegram, s: Settings, now: number): Promise<void> {
  const db = env.DB;
  const raw = await loadRawSettings(db);
  if (raw.weekly_backup === '0') return;
  const today = localDate(now, s.timezone);
  if (iranWeekday(today) !== 6 || localHM(now, s.timezone) < '20:30') return;
  const key = `backup:${addDays(today, -6)}`;
  if (!(await claim(db, key, now))) return;
  try {
    const r = await sendBackup(env, tg, s, now);
    if (r.ok) await markSent(db, key, null);
    else await markFailed(db, key);
  } catch (e) {
    await markFailed(db, key);
    console.error('weekly backup failed', e instanceof Error ? e.message : String(e));
  }
}
