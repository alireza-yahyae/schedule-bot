// Phase 2: habits (daily check-ins with streaks) and grades (GPA data).

import { ApiError, bad } from './http.ts';
import { addDays, daysBetween } from './time.ts';
import { dailyMinutes } from './activity.ts';

// ------------------------------------------------------------------ habits
const WINDOW_DAYS = 14; // days shown in the app
const EDIT_DAYS = 60; // how far back a check-in may be changed
const STREAK_LOOKBACK = 400;

interface HabitRow {
  id: number;
  title: string;
  icon: string;
  category_id: number | null; // follow this category ...
  auto_minutes: number | null; // ... and tick every day it reached this many minutes
}

export interface HabitView extends HabitRow {
  logs: Record<string, true>;
  auto: Record<string, true>; // days that are done only because of the timer (not ticked by hand)
  streak: number;
  best: number;
  done_today: boolean;
}

function streakOf(done: Set<string>, today: string): number {
  // If today is not checked yet, the streak is still alive when yesterday was.
  let day = done.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (done.has(day)) {
    n++;
    day = addDays(day, -1);
  }
  return n;
}

function bestStreak(days: string[]): number {
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

export async function listHabits(db: D1Database, today: string): Promise<{ dates: string[]; habits: HabitView[] }> {
  const dates = Array.from({ length: WINDOW_DAYS }, (_, i) => addDays(today, -i)); // today first
  const habits = (await db.prepare(`SELECT id, title, icon, category_id, auto_minutes FROM habits ORDER BY id`).all<HabitRow>()).results;
  if (habits.length === 0) return { dates, habits: [] };
  const logs = (
    await db
      .prepare(`SELECT habit_id, date FROM habit_logs WHERE date >= ?1`)
      .bind(addDays(today, -STREAK_LOOKBACK))
      .all<{ habit_id: number; date: string }>()
  ).results;
  const byHabit = new Map<number, string[]>();
  for (const l of logs) {
    const arr = byHabit.get(l.habit_id) ?? [];
    arr.push(l.date);
    byHabit.set(l.habit_id, arr);
  }
  const daily = habits.some((h) => h.category_id && h.auto_minutes) ? await dailyMinutes(db, addDays(today, -STREAK_LOOKBACK)) : null;
  return {
    dates,
    habits: habits.map((h) => {
      const manual = new Set(byHabit.get(h.id) ?? []);
      // days the timer ticked for us
      const autoDays = new Set<string>();
      if (daily && h.category_id && h.auto_minutes) {
        for (const [date, m] of daily.get(h.category_id) ?? []) if (m >= h.auto_minutes) autoDays.add(date);
      }
      const set = new Set<string>([...manual, ...autoDays]);
      const windowLogs: Record<string, true> = {};
      const windowAuto: Record<string, true> = {};
      for (const d of dates) {
        if (set.has(d)) windowLogs[d] = true;
        if (autoDays.has(d) && !manual.has(d)) windowAuto[d] = true;
      }
      return { ...h, logs: windowLogs, auto: windowAuto, streak: streakOf(set, today), best: bestStreak([...set]), done_today: set.has(today) };
    }),
  };
}

export async function createHabit(db: D1Database, b: Record<string, unknown>, now: number): Promise<number> {
  const title = String(b.title ?? '').trim();
  if (!title) bad('عنوان عادت لازمه');
  if (title.length > 80) bad('عنوان عادت خیلی طولانیه');
  const icon = String(b.icon ?? '').trim().slice(0, 8) || '✅';
  let categoryId: number | null = null;
  let autoMinutes: number | null = null;
  if (b.category_id !== undefined && b.category_id !== null && b.category_id !== '') {
    categoryId = Number(b.category_id);
    if (!Number.isInteger(categoryId) || !(await db.prepare(`SELECT id FROM categories WHERE id = ?1`).bind(categoryId).first())) bad('این دسته وجود نداره');
    autoMinutes = Math.round(Number(b.auto_minutes));
    if (!Number.isFinite(autoMinutes) || autoMinutes < 5 || autoMinutes > 1440) bad('حداقل زمان برای تیک خودکار باید بین ۵ دقیقه و ۲۴ ساعت باشه');
  }
  const count = await db.prepare(`SELECT COUNT(*) AS n FROM habits`).first<{ n: number }>();
  if ((count?.n ?? 0) >= 40) bad('حداکثر ۴۰ عادت می‌تونی داشته باشی');
  const r = await db
    .prepare(`INSERT INTO habits (title, icon, created_at, category_id, auto_minutes) VALUES (?1, ?2, ?3, ?4, ?5) RETURNING id`)
    .bind(title, icon, now, categoryId, autoMinutes)
    .first<{ id: number }>();
  return r ? r.id : 0;
}

export async function deleteHabit(db: D1Database, id: number): Promise<void> {
  await db.prepare(`DELETE FROM habit_logs WHERE habit_id = ?1`).bind(id).run();
  const r = await db.prepare(`DELETE FROM habits WHERE id = ?1`).bind(id).run();
  if ((r.meta.changes ?? 0) === 0) throw new ApiError(404, 'این عادت پیدا نشد');
}

export async function toggleHabit(db: D1Database, id: number, dateRaw: unknown, today: string): Promise<boolean> {
  const date = typeof dateRaw === 'string' ? dateRaw : today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) bad('تاریخ درست نیست');
  const back = daysBetween(date, today);
  if (back < 0) bad('برای آینده نمی‌شه ثبت کرد');
  if (back > EDIT_DAYS) bad('این تاریخ خیلی قدیمیه');
  const habit = await db.prepare(`SELECT id, category_id, auto_minutes FROM habits WHERE id = ?1`).bind(id).first<{ id: number; category_id: number | null; auto_minutes: number | null }>();
  if (!habit) throw new ApiError(404, 'این عادت پیدا نشد');
  const del = await db.prepare(`DELETE FROM habit_logs WHERE habit_id = ?1 AND date = ?2`).bind(id, date).run();
  if ((del.meta.changes ?? 0) > 0) return false;
  if (habit.category_id && habit.auto_minutes) {
    // Already done by the timer: there is nothing to tick by hand.
    const m = (await dailyMinutes(db, date)).get(habit.category_id)?.get(date) ?? 0;
    if (m >= habit.auto_minutes) bad('این روز خودکار از روی تایمر ثبت شده؛ لازم نیست تیکش بزنی.');
  }
  await db.prepare(`INSERT OR IGNORE INTO habit_logs (habit_id, date) VALUES (?1, ?2)`).bind(id, date).run();
  return true;
}

// ------------------------------------------------------------------ grades
export interface GradeRow {
  id: number;
  course_name: string;
  units: number;
  midterm_score: number;
  final_score: number;
  project_score: number;
  total_score: number;
  semester: string;
}

function score(v: unknown, label: string): number {
  if (v === undefined || v === null || v === '') return 0;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 20) bad(`${label} باید عددی بین ۰ و ۲۰ باشه`);
  return Math.round(n * 100) / 100;
}

/** The three parts are points of the final mark out of 20. If any is filled, their sum is the total. */
export function totalOf(mid: number, fin: number, proj: number, explicit: number): number {
  const sum = mid + fin + proj;
  return Math.min(20, Math.round((sum > 0 ? sum : explicit) * 100) / 100);
}

function parseGrade(b: Record<string, unknown>): Omit<GradeRow, 'id'> {
  const name = String(b.course_name ?? '').trim();
  if (!name) bad('نام درس لازمه');
  if (name.length > 100) bad('نام درس خیلی طولانیه');
  const semester = String(b.semester ?? '').trim();
  if (!semester) bad('نیمسال لازمه');
  if (semester.length > 20) bad('نیمسال خیلی طولانیه');
  const units = Number(b.units ?? 3);
  if (!Number.isFinite(units) || units < 0.5 || units > 30) bad('تعداد واحد باید بین ۰٫۵ و ۳۰ باشه');
  const mid = score(b.midterm_score, 'نمره‌ی میانترم');
  const fin = score(b.final_score, 'نمره‌ی پایان‌ترم');
  const proj = score(b.project_score, 'نمره‌ی پروژه');
  const total = totalOf(mid, fin, proj, score(b.total_score, 'نمره‌ی کل'));
  return { course_name: name, units, midterm_score: mid, final_score: fin, project_score: proj, total_score: total, semester };
}

export async function listGrades(db: D1Database): Promise<GradeRow[]> {
  return (await db.prepare(`SELECT id, course_name, units, midterm_score, final_score, project_score, total_score, semester FROM grades ORDER BY semester DESC, id`).all<GradeRow>()).results;
}

export async function createGrade(db: D1Database, b: Record<string, unknown>, now: number): Promise<GradeRow> {
  const g = parseGrade(b);
  const row = await db
    .prepare(
      `INSERT INTO grades (course_name, units, midterm_score, final_score, project_score, total_score, semester, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
       RETURNING id, course_name, units, midterm_score, final_score, project_score, total_score, semester`,
    )
    .bind(g.course_name, g.units, g.midterm_score, g.final_score, g.project_score, g.total_score, g.semester, now)
    .first<GradeRow>();
  if (!row) throw new ApiError(500, 'ذخیره نشد');
  return row;
}

export async function updateGrade(db: D1Database, id: number, b: Record<string, unknown>): Promise<GradeRow> {
  const g = parseGrade(b);
  const row = await db
    .prepare(
      `UPDATE grades SET course_name = ?1, units = ?2, midterm_score = ?3, final_score = ?4, project_score = ?5, total_score = ?6, semester = ?7
        WHERE id = ?8
       RETURNING id, course_name, units, midterm_score, final_score, project_score, total_score, semester`,
    )
    .bind(g.course_name, g.units, g.midterm_score, g.final_score, g.project_score, g.total_score, g.semester, id)
    .first<GradeRow>();
  if (!row) throw new ApiError(404, 'این نمره پیدا نشد');
  return row;
}

export async function deleteGrade(db: D1Database, id: number): Promise<void> {
  const r = await db.prepare(`DELETE FROM grades WHERE id = ?1`).bind(id).run();
  if ((r.meta.changes ?? 0) === 0) throw new ApiError(404, 'این نمره پیدا نشد');
}
