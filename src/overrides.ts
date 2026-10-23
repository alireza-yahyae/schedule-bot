// Special days: a different sleep / wake time and/or a quiet period ("خاموشی") for one date or every week.

import { ApiError, bad } from './http.ts';
import { loadRawSettings } from './db.ts';
import { addDays, iranWeekday, localDate, localHM, zonedToEpoch } from './time.ts';

export type QuietMode = 'none' | 'all_day' | 'window';

export interface DayOverride {
  id: number;
  scope: 'date' | 'weekday';
  date: string | null;
  weekday: number | null;
  sleep_time: string | null;
  wake_time: string | null;
  quiet_mode: QuietMode;
  quiet_from: string | null;
  quiet_to: string | null;
}

export interface DayPlan {
  date: string;
  sleep: string;
  wake: string;
  quiet_mode: QuietMode;
  quiet_from: string | null;
  quiet_to: string | null;
  /** Which rule gave the sleep/wake and quiet values (for the app to explain). */
  source: 'default' | 'weekday' | 'date';
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const COLS = 'id, scope, date, weekday, sleep_time, wake_time, quiet_mode, quiet_from, quiet_to';

export const toMinutes = (hm: string): number => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));

export async function listOverrides(db: D1Database, today: string): Promise<DayOverride[]> {
  // One-off rules for days that are long gone are of no use any more.
  await db.prepare(`DELETE FROM day_overrides WHERE scope = 'date' AND date < ?1`).bind(addDays(today, -7)).run();
  return (await db.prepare(`SELECT ${COLS} FROM day_overrides ORDER BY scope DESC, date, weekday`).all<DayOverride>()).results;
}

/** What actually applies on `date`: a rule for that exact date beats the weekly rule, which beats the normal settings. */
export function planFor(date: string, rows: DayOverride[], raw: Record<string, string>): DayPlan {
  const byDate = rows.find((r) => r.scope === 'date' && r.date === date);
  const byDay = rows.find((r) => r.scope === 'weekday' && r.weekday === iranWeekday(date));
  const ok = (v: string | undefined) => (v && HHMM.test(v) ? v : null);
  const sleep = byDate?.sleep_time ?? byDay?.sleep_time ?? ok(raw.sleep_time) ?? '23:30';
  const wake = byDate?.wake_time ?? byDay?.wake_time ?? ok(raw.wake_time) ?? '07:00';
  const q = byDate && byDate.quiet_mode !== 'none' ? byDate : byDay && byDay.quiet_mode !== 'none' ? byDay : null;
  const source: DayPlan['source'] = byDate && (byDate.sleep_time || byDate.wake_time || byDate.quiet_mode !== 'none') ? 'date' : byDay ? 'weekday' : 'default';
  return { date, sleep, wake, quiet_mode: q ? q.quiet_mode : 'none', quiet_from: q ? q.quiet_from : null, quiet_to: q ? q.quiet_to : null, source };
}

export async function planForDate(db: D1Database, date: string): Promise<DayPlan> {
  const [rows, raw] = await Promise.all([
    db.prepare(`SELECT ${COLS} FROM day_overrides WHERE (scope = 'date' AND date = ?1) OR (scope = 'weekday' AND weekday = ?2)`).bind(date, iranWeekday(date)).all<DayOverride>(),
    loadRawSettings(db),
  ]);
  return planFor(date, rows.results, raw);
}

/** Is `nowMin` (minutes since local midnight) inside the quiet period of this plan? */
export function isQuietAt(plan: DayPlan, nowMin: number): boolean {
  if (plan.quiet_mode === 'all_day') return true;
  if (plan.quiet_mode !== 'window' || !plan.quiet_from || !plan.quiet_to) return false;
  const from = toMinutes(plan.quiet_from);
  const to = toMinutes(plan.quiet_to);
  // A window that crosses midnight (e.g. 23:00-06:00) covers only the evening part of ITS OWN day; the morning part belongs to the next day (see carriesOver).
  return from <= to ? nowMin >= from && nowMin < to : nowMin >= from;
}
/** The after-midnight part of YESTERDAY's window (e.g. 00:00-06:00 of a 23:00-06:00 window). */
export function carriesOver(prevPlan: DayPlan, nowMin: number): boolean {
  if (prevPlan.quiet_mode !== 'window' || !prevPlan.quiet_from || !prevPlan.quiet_to) return false;
  const from = toMinutes(prevPlan.quiet_from);
  const to = toMinutes(prevPlan.quiet_to);
  return from > to && nowMin < to;
}
export async function quietNow(db: D1Database, tz: string, now: number): Promise<{ quiet: boolean; plan: DayPlan }> {
  const today = localDate(now, tz);
  const [plan, prev] = await Promise.all([planForDate(db, today), planForDate(db, addDays(today, -1))]);
  const nowMin = toMinutes(localHM(now, tz));
  return { quiet: isQuietAt(plan, nowMin) || carriesOver(prev, nowMin), plan };
}

/** Minutes of the sleep time; a sleep time that is not later than the wake time means "after midnight". */
export function sleepMinutes(plan: DayPlan): number {
  const s = toMinutes(plan.sleep);
  return s <= toMinutes(plan.wake) ? s + 1440 : s;
}

// ------------------------------------------------------------------ the owner's "day" (cycle)
/**
 * The owner's day starts when he wakes up and ends when he goes to sleep, which may be after midnight
 * (wake 12:00, sleep 07:00 next morning). A cycle is identified by the calendar date of its wake-up.
 * Everything that is "today" for him (study hours, challenge, meals) belongs to the cycle, not to the calendar date.
 */
export interface Cycle {
  day: string; // calendar date on which this cycle's wake-up happens
  plan: DayPlan;
  startTs: number; // end of the previous cycle (previous bedtime); things after this count for this day
  wakeTs: number;
  sleepTs: number; // end of this cycle
  awake: boolean; // now >= wakeTs
  /** Minutes since local midnight of `day`; can be above 1440 after midnight. */
  minutes: number;
}

export function cycleFor(day: string, rows: DayOverride[], raw: Record<string, string>, tz: string): Omit<Cycle, 'awake' | 'minutes'> {
  const plan = planFor(day, rows, raw);
  const wakeTs = zonedToEpoch(day, plan.wake, tz);
  const sleepTs = wakeTs + (sleepMinutes(plan) - toMinutes(plan.wake)) * 60;
  const prev = planFor(addDays(day, -1), rows, raw);
  const prevWake = zonedToEpoch(addDays(day, -1), prev.wake, tz);
  const startTs = prevWake + (sleepMinutes(prev) - toMinutes(prev.wake)) * 60;
  return { day, plan, startTs, wakeTs, sleepTs };
}

export function cycleAt(now: number, rows: DayOverride[], raw: Record<string, string>, tz: string): Cycle {
  const today = localDate(now, tz);
  let found = cycleFor(today, rows, raw, tz);
  for (const d of [addDays(today, -1), today, addDays(today, 1)]) {
    const c = cycleFor(d, rows, raw, tz);
    if (c.startTs <= now && now < c.sleepTs) {
      found = c;
      break;
    }
  }
  const midnight = zonedToEpoch(found.day, '00:00', tz);
  return { ...found, awake: now >= found.wakeTs, minutes: Math.floor((now - midnight) / 60) };
}

export async function currentCycle(db: D1Database, tz: string, now: number): Promise<Cycle> {
  const [rows, raw] = await Promise.all([db.prepare(`SELECT ${COLS} FROM day_overrides`).all<DayOverride>(), loadRawSettings(db)]);
  return cycleAt(now, rows.results, raw, tz);
}

export async function cycleOfDay(db: D1Database, day: string, tz: string): Promise<Omit<Cycle, 'awake' | 'minutes'>> {
  const [rows, raw] = await Promise.all([db.prepare(`SELECT ${COLS} FROM day_overrides`).all<DayOverride>(), loadRawSettings(db)]);
  return cycleFor(day, rows.results, raw, tz);
}

// ------------------------------------------------------------------ writing
function time(v: unknown, label: string): string | null {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v).trim();
  if (!HHMM.test(s)) bad(`${label} درست نیست (مثلاً 23:30)`);
  return s;
}

/** Create the rule for this date / weekday, or replace the one that is already there. */
export async function saveOverride(db: D1Database, b: Record<string, unknown>, today: string, now: number): Promise<DayOverride> {
  const scope = b.scope;
  let date: string | null = null;
  let weekday: number | null = null;
  if (scope === 'date') {
    date = String(b.date ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) bad('تاریخ درست نیست');
    if (date < today) bad('برای روزهای گذشته نمی‌شه تنظیم کرد');
    if (date > addDays(today, 365)) bad('این تاریخ خیلی دوره');
  } else if (scope === 'weekday') {
    weekday = Number(b.weekday);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) bad('روز هفته درست نیست');
  } else {
    bad('نوع تنظیم درست نیست');
  }

  const sleep = time(b.sleep_time, 'ساعت خواب');
  const wake = time(b.wake_time, 'ساعت بیدار شدن');
  const mode = (b.quiet_mode ?? 'none') as QuietMode;
  if (!['none', 'all_day', 'window'].includes(mode)) bad('نوع خاموشی درست نیست');
  let from: string | null = null;
  let to: string | null = null;
  if (mode === 'window') {
    from = time(b.quiet_from, 'شروع خاموشی');
    to = time(b.quiet_to, 'پایان خاموشی');
    if (!from || !to) bad('برای خاموشی بازه‌ای، شروع و پایان لازمه');
    if (from === to) bad('شروع و پایان خاموشی نباید یکی باشه');
  }
  if (!sleep && !wake && mode === 'none') bad('حداقل یک چیز رو تغییر بده (خواب، بیداری یا خاموشی)');

  const key = scope === 'date' ? `scope = 'date' AND date = ?1` : `scope = 'weekday' AND weekday = ?1`;
  await db.prepare(`DELETE FROM day_overrides WHERE ${key}`).bind(scope === 'date' ? date : weekday).run();
  const row = await db
    .prepare(
      `INSERT INTO day_overrides (scope, date, weekday, sleep_time, wake_time, quiet_mode, quiet_from, quiet_to, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) RETURNING ${COLS}`,
    )
    .bind(scope, date, weekday, sleep, wake, mode, from, to, now)
    .first<DayOverride>();
  if (!row) throw new ApiError(500, 'ذخیره نشد');
  return row;
}

export async function deleteOverride(db: D1Database, id: number): Promise<void> {
  const r = await db.prepare(`DELETE FROM day_overrides WHERE id = ?1`).bind(id).run();
  if ((r.meta.changes ?? 0) === 0) throw new ApiError(404, 'این تنظیم پیدا نشد');
}
