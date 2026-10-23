// Minutes per category per day (finished sessions + finished focus sessions), and what is built on top of it:
// streaks per category and the numbers of the weekly report.

import { addDays, daysBetween } from './time.ts';
import type { Category } from './categories.ts';

const STREAK_LOOKBACK = 400;
/** A day counts for a streak when the category got at least its daily goal, or this many minutes if it has no goal. */
export const DEFAULT_STREAK_MIN = 20;

/** category id -> (local date -> minutes) since `from`. */
export async function dailyMinutes(db: D1Database, from: string): Promise<Map<number, Map<string, number>>> {
  const out = new Map<number, Map<string, number>>();
  const add = (cat: number, date: string, m: number) => {
    let days = out.get(cat);
    if (!days) out.set(cat, (days = new Map()));
    days.set(date, (days.get(date) ?? 0) + m);
  };
  const a = await db
    .prepare(`SELECT category_id, date, SUM(minutes) AS m FROM study_sessions WHERE date >= ?1 GROUP BY category_id, date`)
    .bind(from)
    .all<{ category_id: number; date: string; m: number }>();
  for (const r of a.results) add(r.category_id, r.date, Number(r.m));
  const b = await db
    .prepare(`SELECT category_id, date, SUM(minutes) AS m FROM focus_sessions WHERE date >= ?1 GROUP BY category_id, date`)
    .bind(from)
    .all<{ category_id: number; date: string; m: number }>();
  for (const r of b.results) add(r.category_id, r.date, Number(r.m));
  return out;
}

/** Days in a row up to today. If today is not done yet, the streak is still alive when yesterday was. */
export function currentStreak(done: Set<string>, today: string): number {
  let day = done.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (done.has(day)) {
    n++;
    day = addDays(day, -1);
  }
  return n;
}

export function bestStreak(days: Iterable<string>): number {
  let best = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of [...days].sort()) {
    run = prev !== null && daysBetween(prev, d) === 1 ? run + 1 : 1;
    if (run > best) best = run;
    prev = d;
  }
  return best;
}

export interface CategoryStreak {
  category_id: number;
  streak: number;
  best: number;
  threshold: number;
}

export function streaksFrom(daily: Map<number, Map<string, number>>, cats: Category[], today: string): CategoryStreak[] {
  const out: CategoryStreak[] = [];
  for (const c of cats) {
    const threshold = c.daily_goal_minutes ?? DEFAULT_STREAK_MIN;
    const days = new Set<string>();
    for (const [date, m] of daily.get(c.id) ?? []) if (m >= threshold) days.add(date);
    const streak = currentStreak(days, today);
    const best = bestStreak(days);
    if (streak > 0 || best > 0) out.push({ category_id: c.id, streak, best, threshold });
  }
  return out;
}

export async function categoryStreaks(db: D1Database, cats: Category[], today: string): Promise<CategoryStreak[]> {
  return streaksFrom(await dailyMinutes(db, addDays(today, -STREAK_LOOKBACK)), cats, today);
}
