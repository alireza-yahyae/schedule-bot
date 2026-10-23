// Water, exercise, sleep and energy: small daily logs, plus what they say about the days you got things done.

import { ApiError, bad } from './http.ts';
import { dailyMinutes } from './activity.ts';
import { addDays, localDate } from './time.ts';
import type { Settings } from './types.ts';

export type Slot = 'morning' | 'afternoon' | 'evening';

export function slotOf(ts: number, tz: string): Slot {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(new Date(ts * 1000)));
  return h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
}

export interface BodyToday {
  date: string;
  water: number;
  exercise_min: number;
  sleep_hours: number | null;
  energy: Record<Slot, number | null>;
  slot: Slot;
}

export async function bodyToday(db: D1Database, s: Settings, now: number): Promise<BodyToday> {
  const date = localDate(now, s.timezone);
  const row = await db.prepare(`SELECT water, exercise_min, sleep_hours FROM day_logs WHERE date = ?1`).bind(date).first<{ water: number; exercise_min: number; sleep_hours: number | null }>();
  const moods = (await db.prepare(`SELECT slot, energy FROM mood_logs WHERE date = ?1`).bind(date).all<{ slot: Slot; energy: number }>()).results;
  const energy: Record<Slot, number | null> = { morning: null, afternoon: null, evening: null };
  for (const m of moods) energy[m.slot] = m.energy;
  return { date, water: row?.water ?? 0, exercise_min: row?.exercise_min ?? 0, sleep_hours: row?.sleep_hours ?? null, energy, slot: slotOf(now, s.timezone) };
}

/** Change today's water / exercise / sleep. Only the fields that are sent are changed. */
export async function saveDayLog(db: D1Database, s: Settings, now: number, b: Record<string, unknown>): Promise<void> {
  const date = localDate(now, s.timezone);
  const cur = await db.prepare(`SELECT water, exercise_min, sleep_hours FROM day_logs WHERE date = ?1`).bind(date).first<{ water: number; exercise_min: number; sleep_hours: number | null }>();
  let water = cur?.water ?? 0;
  let exercise = cur?.exercise_min ?? 0;
  let sleep = cur?.sleep_hours ?? null;
  if (b.water !== undefined) {
    water = Number(b.water);
    if (!Number.isInteger(water) || water < 0 || water > 30) bad('تعداد لیوان آب باید بین ۰ و ۳۰ باشه');
  }
  if (b.exercise_min !== undefined) {
    exercise = Number(b.exercise_min);
    if (!Number.isInteger(exercise) || exercise < 0 || exercise > 600) bad('مدت ورزش باید بین ۰ و ۶۰۰ دقیقه باشه');
  }
  if (b.sleep_hours !== undefined) {
    if (b.sleep_hours === null || b.sleep_hours === '') sleep = null;
    else {
      sleep = Number(b.sleep_hours);
      if (!Number.isFinite(sleep) || sleep < 0 || sleep > 16) bad('ساعت خواب باید بین ۰ و ۱۶ باشه');
      sleep = Math.round(sleep * 2) / 2;
    }
  }
  await db
    .prepare(
      `INSERT INTO day_logs (date, water, exercise_min, sleep_hours, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(date) DO UPDATE SET water = ?2, exercise_min = ?3, sleep_hours = ?4, updated_at = ?5`,
    )
    .bind(date, water, exercise, sleep, now)
    .run();
}

export async function saveEnergy(db: D1Database, s: Settings, now: number, b: Record<string, unknown>): Promise<void> {
  const energy = Number(b.energy);
  if (!Number.isInteger(energy) || energy < 1 || energy > 5) throw new ApiError(400, 'انرژی باید بین ۱ و ۵ باشه');
  const slot = slotOf(now, s.timezone);
  await db
    .prepare(`INSERT INTO mood_logs (date, slot, energy, created_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(date, slot) DO UPDATE SET energy = ?3, created_at = ?4`)
    .bind(localDate(now, s.timezone), slot, energy, now)
    .run();
}

export interface BodyStats {
  days: number; // window
  avg_water: number | null;
  exercise_days: number;
  avg_sleep: number | null;
  sleep_days: number;
  energy: Record<Slot, { avg: number; n: number } | null>;
  /** Minutes of activity on days with enough sleep vs. short sleep (needs 3 days of each). */
  sleep_effect: { good_days: number; good_avg: number; short_days: number; short_avg: number } | null;
}

const WINDOW = 30;
const GOOD_SLEEP = 7;

export async function bodyStats(db: D1Database, today: string): Promise<BodyStats> {
  const from = addDays(today, -(WINDOW - 1));
  const logs = (await db.prepare(`SELECT date, water, exercise_min, sleep_hours FROM day_logs WHERE date >= ?1`).bind(from).all<{ date: string; water: number; exercise_min: number; sleep_hours: number | null }>()).results;
  const waterDays = logs.filter((l) => l.water > 0);
  const sleepLogs = logs.filter((l) => l.sleep_hours !== null);
  const moods = (await db.prepare(`SELECT slot, AVG(energy) AS a, COUNT(*) AS n FROM mood_logs WHERE date >= ?1 GROUP BY slot`).bind(from).all<{ slot: Slot; a: number; n: number }>()).results;
  const energy: BodyStats['energy'] = { morning: null, afternoon: null, evening: null };
  for (const m of moods) energy[m.slot] = { avg: Math.round(Number(m.a) * 10) / 10, n: Number(m.n) };

  // activity per day (all categories) on days where sleep was entered
  const daily = await dailyMinutes(db, from);
  const total = (date: string) => {
    let t = 0;
    for (const days of daily.values()) t += days.get(date) ?? 0;
    return t;
  };
  const good = sleepLogs.filter((l) => (l.sleep_hours as number) >= GOOD_SLEEP).map((l) => total(l.date));
  const short = sleepLogs.filter((l) => (l.sleep_hours as number) < GOOD_SLEEP).map((l) => total(l.date));
  const avg = (a: number[]) => Math.round(a.reduce((x, y) => x + y, 0) / a.length);
  return {
    days: WINDOW,
    avg_water: waterDays.length ? Math.round((waterDays.reduce((a, l) => a + l.water, 0) / waterDays.length) * 10) / 10 : null,
    exercise_days: logs.filter((l) => l.exercise_min > 0).length,
    avg_sleep: sleepLogs.length ? Math.round((sleepLogs.reduce((a, l) => a + (l.sleep_hours as number), 0) / sleepLogs.length) * 10) / 10 : null,
    sleep_days: sleepLogs.length,
    energy,
    sleep_effect: good.length >= 3 && short.length >= 3 ? { good_days: good.length, good_avg: avg(good), short_days: short.length, short_avg: avg(short) } : null,
  };
}
