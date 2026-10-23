// Activity categories: study, work and anything the owner adds. Used by the timer and the study log.

import { ApiError, bad } from './http.ts';

export interface Category {
  id: number;
  title: string;
  icon: string;
  color: string;
  sort: number;
  is_active: number;
  is_builtin: number;
  daily_goal_minutes: number | null;
  weekly_goal_minutes: number | null;
  share_with_partner: number;
  focus_minutes: number | null;
  break_minutes: number | null;
}

const COLS = 'id, title, icon, color, sort, is_active, is_builtin, daily_goal_minutes, weekly_goal_minutes, share_with_partner, focus_minutes, break_minutes';
const COLOR = /^#[0-9a-fA-F]{6}$/;
const MAX_ACTIVE = 12;

export async function listCategories(db: D1Database, includeArchived = false): Promise<Category[]> {
  const where = includeArchived ? '' : 'WHERE is_active = 1';
  return (await db.prepare(`SELECT ${COLS} FROM categories ${where} ORDER BY sort, id`).all<Category>()).results;
}

export async function getCategory(db: D1Database, id: number): Promise<Category | null> {
  return await db.prepare(`SELECT ${COLS} FROM categories WHERE id = ?1`).bind(id).first<Category>();
}

function cleanTitle(v: unknown): string {
  const t = String(v ?? '').trim();
  if (!t) bad('اسم دسته لازمه');
  if (Array.from(t).length > 24) bad('اسم دسته نباید از ۲۴ حرف بیشتر باشه');
  return t;
}
function cleanIcon(v: unknown): string {
  const t = String(v ?? '').trim();
  if (!t) return '📌';
  if (Array.from(t).length > 4) bad('آیکون باید یه ایموجی باشه');
  return t;
}
function cleanColor(v: unknown): string {
  const t = String(v ?? '').trim();
  if (!COLOR.test(t)) bad('رنگ درست نیست');
  return t;
}

/** A goal in minutes; empty / 0 / null removes it. */
function cleanGoal(v: unknown, max: number, label: string): number | null {
  if (v === undefined || v === null || v === '' || Number(v) === 0) return null;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 10 || n > max) bad(`${label} باید بین ۱۰ دقیقه و ${Math.round(max / 60)} ساعت باشه`);
  return n;
}
/** Focus / break length in minutes; empty removes it (the general setting is used then). */
function cleanMin(v: unknown, min: number, max: number, label: string): number | null {
  if (v === undefined || v === null || v === '' || Number(v) === 0) return null;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < min || n > max) bad(`${label} باید بین ${min} و ${max} دقیقه باشه`);
  return n;
}
function flag01(v: unknown): number {
  return v === true || v === 1 || v === '1' ? 1 : 0;
}

export async function createCategory(db: D1Database, now: number, b: Record<string, unknown>): Promise<Category> {
  const active = await db.prepare(`SELECT COUNT(*) AS n FROM categories WHERE is_active = 1`).first<{ n: number }>();
  if (Number(active?.n ?? 0) >= MAX_ACTIVE) bad(`بیشتر از ${MAX_ACTIVE} دسته‌ی فعال نمی‌شه داشت. یکی رو بایگانی کن.`);
  const title = cleanTitle(b.title);
  const icon = cleanIcon(b.icon);
  const color = b.color === undefined || b.color === '' ? '#4F8CFF' : cleanColor(b.color);
  const dup = await db.prepare(`SELECT id FROM categories WHERE title = ?1 AND is_active = 1`).bind(title).first();
  if (dup) bad('یه دسته با همین اسم از قبل هست');
  const next = await db.prepare(`SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM categories`).first<{ n: number }>();
  const row = await db
    .prepare(
      `INSERT INTO categories (title, icon, color, sort, created_at, daily_goal_minutes, weekly_goal_minutes, share_with_partner, focus_minutes, break_minutes) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10) RETURNING ${COLS}`,
    )
    .bind(
      title, icon, color, Number(next?.n ?? 1), now,
      cleanGoal(b.daily_goal_minutes, 1440, 'هدف روزانه'),
      cleanGoal(b.weekly_goal_minutes, 10080, 'هدف هفتگی'),
      b.share_with_partner === undefined ? 1 : flag01(b.share_with_partner),
      cleanMin(b.focus_minutes, 5, 180, 'مدت تمرکز'),
      cleanMin(b.break_minutes, 1, 60, 'مدت استراحت'),
    )
    .first<Category>();
  if (!row) throw new ApiError(500, 'ساخته نشد');
  return row;
}

export async function updateCategory(db: D1Database, id: number, b: Record<string, unknown>): Promise<Category> {
  const cur = await getCategory(db, id);
  if (!cur) throw new ApiError(404, 'این دسته پیدا نشد');
  const title = b.title === undefined ? cur.title : cleanTitle(b.title);
  const icon = b.icon === undefined ? cur.icon : cleanIcon(b.icon);
  const color = b.color === undefined ? cur.color : cleanColor(b.color);
  let isActive = cur.is_active;
  if (b.is_active !== undefined) {
    isActive = b.is_active ? 1 : 0;
    if (!isActive && cur.is_builtin) bad('دسته‌ی «درس» رو نمی‌شه بایگانی کرد');
    if (isActive && !cur.is_active) {
      const active = await db.prepare(`SELECT COUNT(*) AS n FROM categories WHERE is_active = 1`).first<{ n: number }>();
      if (Number(active?.n ?? 0) >= MAX_ACTIVE) bad(`بیشتر از ${MAX_ACTIVE} دسته‌ی فعال نمی‌شه داشت.`);
    }
  }
  if (title !== cur.title) {
    const dup = await db.prepare(`SELECT id FROM categories WHERE title = ?1 AND is_active = 1 AND id != ?2`).bind(title, id).first();
    if (dup) bad('یه دسته با همین اسم از قبل هست');
  }
  const daily = b.daily_goal_minutes === undefined ? cur.daily_goal_minutes : cleanGoal(b.daily_goal_minutes, 1440, 'هدف روزانه');
  const weekly = b.weekly_goal_minutes === undefined ? cur.weekly_goal_minutes : cleanGoal(b.weekly_goal_minutes, 10080, 'هدف هفتگی');
  const share = b.share_with_partner === undefined ? cur.share_with_partner : flag01(b.share_with_partner);
  const focus = b.focus_minutes === undefined ? cur.focus_minutes : cleanMin(b.focus_minutes, 5, 180, 'مدت تمرکز');
  const brk = b.break_minutes === undefined ? cur.break_minutes : cleanMin(b.break_minutes, 1, 60, 'مدت استراحت');
  await db
    .prepare(`UPDATE categories SET title = ?1, icon = ?2, color = ?3, is_active = ?4, daily_goal_minutes = ?5, weekly_goal_minutes = ?6, share_with_partner = ?7, focus_minutes = ?8, break_minutes = ?9 WHERE id = ?10`)
    .bind(title, icon, color, isActive, daily, weekly, share, focus, brk, id)
    .run();
  return (await getCategory(db, id)) as Category;
}

/** A category that has sessions is archived (so the old numbers stay); an unused one is really deleted. */
export async function deleteCategory(db: D1Database, id: number): Promise<{ archived: boolean }> {
  const cur = await getCategory(db, id);
  if (!cur) throw new ApiError(404, 'این دسته پیدا نشد');
  if (cur.is_builtin) bad('دسته‌ی «درس» رو نمی‌شه حذف کرد');
  const timer = await db.prepare(`SELECT started_at FROM study_timer WHERE id = 1 AND category_id = ?1`).bind(id).first<{ started_at: number | null }>();
  if (timer && timer.started_at !== null) bad('الان تایمر روی این دسته روشنه. اول تموم یا لغوش کن.');
  // In use anywhere (study log, pomodoro, tasks, habits, challenges)? Then archive it instead of deleting, so nothing is left pointing at a missing category.
  const used = await db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM study_sessions WHERE category_id = ?1)
            + (SELECT COUNT(*) FROM focus_sessions WHERE category_id = ?1)
            + (SELECT COUNT(*) FROM tasks WHERE category_id = ?1)
            + (SELECT COUNT(*) FROM habits WHERE category_id = ?1)
            + (SELECT COUNT(*) FROM challenges WHERE category_id = ?1) AS n`,
    )
    .bind(id)
    .first<{ n: number }>();
  if (Number(used?.n ?? 0) > 0) {
    await db.prepare(`UPDATE categories SET is_active = 0 WHERE id = ?1`).bind(id).run();
    return { archived: true };
  }
  await db.prepare(`DELETE FROM categories WHERE id = ?1`).bind(id).run();
  return { archived: false };
}

/** The category to use for a new session: the one asked for, else the one used last, else study. */
export async function resolveCategoryId(db: D1Database, raw: unknown): Promise<number> {
  if (raw !== undefined && raw !== null && raw !== '') {
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0) bad('دسته درست نیست');
    const c = await getCategory(db, id);
    if (!c || !c.is_active) bad('این دسته وجود نداره یا بایگانی شده');
    return id;
  }
  return await lastCategoryId(db);
}

export async function lastCategoryId(db: D1Database): Promise<number> {
  const r = await db
    .prepare(`SELECT s.category_id AS id FROM study_sessions s JOIN categories c ON c.id = s.category_id WHERE c.is_active = 1 ORDER BY s.created_at DESC LIMIT 1`)
    .first<{ id: number }>();
  return r ? r.id : 1;
}
