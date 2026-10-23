// Lunch / dinner: tick them off, or say "later" (after dinner / after I wake up).

import { bad } from './http.ts';
import { localDate, zonedToEpoch } from './time.ts';

export type Meal = 'lunch' | 'dinner';
export interface MealState {
  status: 'done' | 'later';
  after: 'dinner' | 'wake' | null;
  at_ts: number | null;
}

export async function listMeals(db: D1Database, day: string): Promise<Record<string, MealState>> {
  const rows = (await db.prepare(`SELECT meal, status, after, at_ts FROM meal_log WHERE day = ?1`).bind(day).all<{ meal: string } & MealState>()).results;
  const out: Record<string, MealState> = {};
  for (const r of rows) out[r.meal] = { status: r.status, after: r.after, at_ts: r.at_ts };
  return out;
}

export async function setMeal(db: D1Database, day: string, tz: string, now: number, b: Record<string, unknown>): Promise<void> {
  const meal = b.meal as Meal;
  if (meal !== 'lunch' && meal !== 'dinner') bad('وعده‌ی غذایی درست نیست');
  const status = b.status;
  if (status === 'clear') {
    await db.prepare(`DELETE FROM meal_log WHERE day = ?1 AND meal = ?2`).bind(day, meal).run();
    return;
  }
  if (status === 'done') {
    let at = now;
    if (typeof b.at === 'string' && b.at !== '') {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.at)) bad('ساعت درست نیست');
      at = zonedToEpoch(localDate(now, tz), b.at, tz);
      if (at > now + 300) at -= 86400; // a time later than now means yesterday (e.g. eaten at 23:30, it is 01:00)
    }
    await db
      .prepare(`INSERT INTO meal_log (day, meal, status, after, at_ts) VALUES (?1, ?2, 'done', NULL, ?3) ON CONFLICT(day, meal) DO UPDATE SET status = 'done', after = NULL, at_ts = ?3`)
      .bind(day, meal, at)
      .run();
    return;
  }
  if (status === 'later') {
    const after = b.after;
    if (after !== 'dinner' && after !== 'wake') bad('«بعداً» یعنی بعد از شام یا بعد از بیدار شدن');
    if (meal === 'dinner' && after === 'dinner') bad('شام رو نمی‌شه بعد از خودش گذاشت');
    await db
      .prepare(`INSERT INTO meal_log (day, meal, status, after, at_ts) VALUES (?1, ?2, 'later', ?3, NULL) ON CONFLICT(day, meal) DO UPDATE SET status = 'later', after = ?3, at_ts = NULL`)
      .bind(day, meal, after)
      .run();
    return;
  }
  bad('وضعیت درست نیست');
}
