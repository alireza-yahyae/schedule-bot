// "I am studying" timer, manual study entries (with a start and an end), and the day summary.

import type { Settings } from './types.ts';
import { ApiError, bad } from './http.ts';
import { addDays, iranWeekday, localDate, zonedToEpoch } from './time.ts';
import { studySnapshot } from './partner.ts';
import { lastCategoryId, listCategories, resolveCategoryId } from './categories.ts';
import { categoryStreaks } from './activity.ts';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_SESSION_MIN = 16 * 60;

/** A short note about what was done in a session (optional). */
function cleanNote(v: unknown): string | null {
  const t = String(v ?? '').trim();
  if (!t) return null;
  if (Array.from(t).length > 200) bad('یادداشت حداکثر ۲۰۰ حرف می‌تونه باشه');
  return t;
}

export async function startTimer(db: D1Database, now: number, minutesAgo: unknown, categoryRaw?: unknown, taskRaw?: unknown): Promise<number> {
  const ago = minutesAgo === undefined || minutesAgo === null || minutesAgo === '' ? 0 : Number(minutesAgo);
  if (!Number.isFinite(ago) || ago < 0 || ago > 12 * 60) bad('«چند دقیقه پیش شروع کردی» باید بین ۰ تا ۷۲۰ باشه');
  const cur = await db.prepare(`SELECT started_at FROM study_timer WHERE id = 1`).first<{ started_at: number | null }>();
  if (cur && cur.started_at !== null) bad('تایمر درس خوندن از قبل روشنه.');
  // Started from a task: the task's own category is used unless one was chosen on purpose.
  let taskId: number | null = null;
  let taskCategory: number | null = null;
  if (taskRaw !== undefined && taskRaw !== null && taskRaw !== '') {
    const id = Number(taskRaw);
    const task = Number.isInteger(id) ? await db.prepare(`SELECT id, category_id FROM tasks WHERE id = ?1 AND deleted_at IS NULL`).bind(id).first<{ id: number; category_id: number | null }>() : null;
    if (!task) bad('این کار پیدا نشد');
    taskId = task.id;
    taskCategory = task.category_id;
  }
  const wanted = categoryRaw === undefined || categoryRaw === null || categoryRaw === '' ? taskCategory ?? undefined : categoryRaw;
  const categoryId = await resolveCategoryId(db, wanted);
  const startedAt = now - Math.round(ago) * 60;
  await db.prepare(`UPDATE study_timer SET started_at = ?1, category_id = ?2, task_id = ?3 WHERE id = 1`).bind(startedAt, categoryId, taskId).run();
  return startedAt;
}

export async function stopTimer(db: D1Database, s: Settings, now: number, breakMinutes: unknown, noteRaw?: unknown): Promise<{ id: number; minutes: number }> {
  const cur = await db.prepare(`SELECT started_at, category_id, task_id FROM study_timer WHERE id = 1`).first<{ started_at: number | null; category_id: number; task_id: number | null }>();
  if (!cur || cur.started_at === null) bad('تایمر روشن نیست.');
  const started = cur.started_at as number;
  const elapsed = Math.round((now - started) / 60);
  const brk = breakMinutes === undefined || breakMinutes === null || breakMinutes === '' ? 0 : Number(breakMinutes);
  if (!Number.isFinite(brk) || brk < 0) bad('زمان استراحت درست نیست');
  const minutes = elapsed - Math.round(brk);
  if (elapsed > MAX_SESSION_MIN) bad('این جلسه خیلی طولانی شده (بیشتر از ۱۶ ساعت). لغوش کن و ساعت درست رو دستی ثبت کن.');
  if (minutes < 1) bad('کمتر از یک دقیقه شد. اگه اشتباهی روشن کردی «لغو» رو بزن.');
  const row = await db
    .prepare(`INSERT INTO study_sessions (minutes, note, date, created_at, started_at, category_id, task_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) RETURNING id`)
    .bind(minutes, cleanNote(noteRaw), localDate(started, s.timezone), now, started, cur.category_id || 1, cur.task_id)
    .first<{ id: number }>();
  await db.prepare(`UPDATE study_timer SET started_at = NULL, task_id = NULL WHERE id = 1`).run();
  return { id: row ? row.id : 0, minutes };
}

export async function cancelTimer(db: D1Database): Promise<void> {
  await db.prepare(`UPDATE study_timer SET started_at = NULL, task_id = NULL WHERE id = 1`).run();
}

/** A study session typed in afterwards: "from 14:00 to 17:30, with a 20 minute break". */
export async function addManual(db: D1Database, s: Settings, now: number, b: Record<string, unknown>): Promise<{ id: number; minutes: number }> {
  const start = String(b.start ?? '');
  const end = String(b.end ?? '');
  if (!HHMM.test(start) || !HHMM.test(end)) bad('ساعت شروع و پایان لازمه (مثلاً 14:30)');
  const today = localDate(now, s.timezone);
  const date = b.date === undefined || b.date === 'today' ? today : b.date === 'yesterday' ? addDays(today, -1) : String(b.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today || date < addDays(today, -2)) bad('تاریخ فقط می‌تونه امروز یا دیروز باشه');
  const startTs = zonedToEpoch(date, start, s.timezone);
  let endTs = zonedToEpoch(date, end, s.timezone);
  if (endTs <= startTs) endTs = zonedToEpoch(addDays(date, 1), end, s.timezone); // it ran past midnight
  if (endTs > now + 120) bad('ساعت پایان توی آینده‌ست.');
  const brk = b.break_minutes === undefined || b.break_minutes === null || b.break_minutes === '' ? 0 : Number(b.break_minutes);
  if (!Number.isFinite(brk) || brk < 0) bad('زمان استراحت درست نیست');
  const categoryId = await resolveCategoryId(db, b.category_id);
  const minutes = Math.round((endTs - startTs) / 60) - Math.round(brk);
  if (minutes < 1) bad('مدت درس خوندن باید حداقل یک دقیقه باشه');
  if (minutes > MAX_SESSION_MIN) bad('بیشتر از ۱۶ ساعت نمی‌شه ثبت کرد');
  const row = await db
    .prepare(`INSERT INTO study_sessions (minutes, note, date, created_at, started_at, category_id) VALUES (?1, NULL, ?2, ?3, ?4, ?5) RETURNING id`)
    .bind(minutes, date, endTs, startTs, categoryId)
    .first<{ id: number }>();
  return { id: row ? row.id : 0, minutes };
}

export interface SessionView {
  id: number;
  minutes: number;
  started_at: number | null;
  ended_at: number;
  category_id: number;
  note: string | null;
  task_id: number | null;
}

/** What the Today screen needs: totals for the current day, the running timer and the latest sessions. */
export async function studySummary(db: D1Database, s: Settings, now: number) {
  const snap = await studySnapshot(db, s, now);
  const sessions = (
    await db
      .prepare(`SELECT id, minutes, started_at, created_at AS ended_at, category_id, note, task_id FROM study_sessions WHERE created_at >= ?1 AND created_at <= ?2 ORDER BY created_at DESC LIMIT 12`)
      .bind(snap.cycle.startTs, now)
      .all<SessionView>()
  ).results;
  const cls = await db
    .prepare(`SELECT COALESCE(SUM((end_ts - start_ts) / 60), 0) AS m FROM occurrences WHERE status = 'attended' AND is_test = 0 AND start_ts >= ?1 AND start_ts <= ?2`)
    .bind(snap.cycle.startTs, now)
    .first<{ m: number }>();
  // Minutes of the current day per category (finished sessions + the running timer).
  const perCat = new Map<number, number>();
  const rows = (
    await db
      .prepare(`SELECT category_id, COALESCE(SUM(minutes), 0) AS m FROM study_sessions WHERE created_at >= ?1 AND created_at <= ?2 GROUP BY category_id`)
      .bind(snap.cycle.startTs, now)
      .all<{ category_id: number; m: number }>()
  ).results;
  for (const r of rows) perCat.set(r.category_id, Number(r.m));
  const focusRows = (
    await db
      .prepare(`SELECT category_id, COALESCE(SUM(minutes), 0) AS m FROM focus_sessions WHERE started_at >= ?1 AND started_at <= ?2 GROUP BY category_id`)
      .bind(snap.cycle.startTs, now)
      .all<{ category_id: number; m: number }>()
  ).results;
  for (const r of focusRows) perCat.set(r.category_id, (perCat.get(r.category_id) ?? 0) + Number(r.m));
  const timer = await db.prepare(`SELECT category_id, task_id FROM study_timer WHERE id = 1`).first<{ category_id: number; task_id: number | null }>();
  const runningCategory = snap.running !== null ? timer?.category_id ?? 1 : null;
  const runningTask =
    snap.running !== null && timer && timer.task_id !== null
      ? await db.prepare(`SELECT id, title FROM tasks WHERE id = ?1`).bind(timer.task_id).first<{ id: number; title: string }>()
      : null;
  let runMin = 0;
  if (snap.running !== null && runningCategory !== null) {
    const begin = Math.max(snap.running, snap.cycle.startTs);
    if (now > begin) {
      runMin = Math.floor((now - begin) / 60);
      perCat.set(runningCategory, (perCat.get(runningCategory) ?? 0) + runMin);
    }
  }
  const by_category = [...perCat.entries()].filter(([, m]) => m > 0).map(([category_id, minutes]) => ({ category_id, minutes }));

  // This week (Saturday to now) per category, for the weekly goals.
  const weekStart = addDays(snap.cycle.day, -iranWeekday(snap.cycle.day));
  const weekRows = (
    await db
      .prepare(`SELECT category_id, COALESCE(SUM(minutes), 0) AS m FROM study_sessions WHERE date >= ?1 GROUP BY category_id`)
      .bind(weekStart)
      .all<{ category_id: number; m: number }>()
  ).results;
  const perWeek = new Map<number, number>(weekRows.map((r) => [r.category_id, Number(r.m)]));
  const focusWeek = (
    await db
      .prepare(`SELECT category_id, COALESCE(SUM(minutes), 0) AS m FROM focus_sessions WHERE date >= ?1 GROUP BY category_id`)
      .bind(weekStart)
      .all<{ category_id: number; m: number }>()
  ).results;
  for (const r of focusWeek) perWeek.set(r.category_id, (perWeek.get(r.category_id) ?? 0) + Number(r.m));
  if (runningCategory !== null && runMin > 0) perWeek.set(runningCategory, (perWeek.get(runningCategory) ?? 0) + runMin);
  const week_by_category = [...perWeek.entries()].filter(([, m]) => m > 0).map(([category_id, minutes]) => ({ category_id, minutes }));
  return {
    categories: await listCategories(db),
    last_category_id: await lastCategoryId(db),
    running_category_id: runningCategory,
    running_task: runningTask,
    by_category,
    week_by_category,
    streaks: await categoryStreaks(db, await listCategories(db), snap.cycle.day),
    today_minutes: snap.todayMinutes,
    idle_hours: snap.idleHours,
    running: snap.running,
    class_minutes: Math.round(Number(cls?.m ?? 0)),
    sessions,
    cycle: { day: snap.cycle.day, awake: snap.cycle.awake, wake_ts: snap.cycle.wakeTs, sleep_ts: snap.cycle.sleepTs, start_ts: snap.cycle.startTs },
  };
}

export async function deleteSession(db: D1Database, id: number): Promise<void> {
  const r = await db.prepare(`DELETE FROM study_sessions WHERE id = ?1`).bind(id).run();
  if ((r.meta.changes ?? 0) === 0) throw new ApiError(404, 'این جلسه پیدا نشد');
}

export interface SessionRow extends SessionView {
  date: string;
}

/** Recent sessions (default: the last 30 days) so old ones can be corrected. */
export async function listSessions(db: D1Database, s: Settings, now: number, days = 30): Promise<SessionRow[]> {
  const from = addDays(localDate(now, s.timezone), -days);
  return (
    await db
      .prepare(`SELECT id, minutes, date, started_at, created_at AS ended_at, category_id, note, task_id FROM study_sessions WHERE date >= ?1 ORDER BY created_at DESC LIMIT 300`)
      .bind(from)
      .all<SessionRow>()
  ).results;
}

const EDIT_DAYS = 60;

/**
 * Change a finished session: its category, and either its start / end / break or (for sessions typed with /study,
 * which have no start time) just the minutes.
 */
export async function updateSession(db: D1Database, s: Settings, now: number, id: number, b: Record<string, unknown>): Promise<{ id: number; minutes: number }> {
  const row = await db
    .prepare(`SELECT id, minutes, date, started_at, created_at, category_id FROM study_sessions WHERE id = ?1`)
    .bind(id)
    .first<{ id: number; minutes: number; date: string; started_at: number | null; created_at: number; category_id: number }>();
  if (!row) throw new ApiError(404, 'این جلسه پیدا نشد');

  let categoryId = row.category_id;
  if (b.category_id !== undefined && b.category_id !== null && b.category_id !== '' && Number(b.category_id) !== row.category_id) {
    categoryId = await resolveCategoryId(db, b.category_id);
  }

  let minutes = row.minutes;
  let startedAt = row.started_at;
  let endedAt = row.created_at;
  if (b.start !== undefined || b.end !== undefined) {
    const start = String(b.start ?? '');
    const end = String(b.end ?? '');
    if (!HHMM.test(start) || !HHMM.test(end)) bad('ساعت شروع و پایان لازمه (مثلاً 14:30)');
    const today = localDate(now, s.timezone);
    if (row.date < addDays(today, -EDIT_DAYS)) bad('زمان جلسه‌های خیلی قدیمی رو نمی‌شه عوض کرد');
    const startTs = zonedToEpoch(row.date, start, s.timezone);
    let endTs = zonedToEpoch(row.date, end, s.timezone);
    if (endTs <= startTs) endTs = zonedToEpoch(addDays(row.date, 1), end, s.timezone); // it ran past midnight
    if (endTs > now + 120) bad('ساعت پایان توی آینده‌ست.');
    const brk = b.break_minutes === undefined || b.break_minutes === null || b.break_minutes === '' ? 0 : Number(b.break_minutes);
    if (!Number.isFinite(brk) || brk < 0) bad('زمان استراحت درست نیست');
    minutes = Math.round((endTs - startTs) / 60) - Math.round(brk);
    if (minutes < 1) bad('مدت جلسه باید حداقل یک دقیقه باشه');
    if (minutes > MAX_SESSION_MIN) bad('بیشتر از ۱۶ ساعت نمی‌شه ثبت کرد');
    startedAt = startTs;
    endedAt = endTs;
  } else if (b.minutes !== undefined) {
    const m = Number(b.minutes);
    if (!Number.isInteger(m) || m < 1 || m > 720) bad('مدت باید بین ۱ تا ۷۲۰ دقیقه باشه');
    minutes = m;
  }

  const cur = await db.prepare(`SELECT note FROM study_sessions WHERE id = ?1`).bind(id).first<{ note: string | null }>();
  const note = b.note === undefined ? cur?.note ?? null : cleanNote(b.note);
  await db
    .prepare(`UPDATE study_sessions SET minutes = ?1, started_at = ?2, created_at = ?3, category_id = ?4, note = ?5 WHERE id = ?6`)
    .bind(minutes, startedAt, endedAt, categoryId, note, id)
    .run();
  return { id, minutes };
}
