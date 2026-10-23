// Levels (XP = minutes of activity) and badges. The badge rules live here; only the unlock time is stored.

import { dailyMinutes, streaksFrom } from './activity.ts';
import { listCategories } from './categories.ts';
import { listHabits } from './growth.ts';
import { addDays, iranWeekday, localDate } from './time.ts';
import type { Settings } from './types.ts';

/** Minutes needed to reach level n: 300 (5 h) for level 2, 900 (15 h) for 3, 1800 (30 h) for 4, ... */
export function xpForLevel(n: number): number {
  return 150 * n * (n - 1);
}

export interface LevelInfo {
  level: number;
  xp: number;
  from_xp: number; // xp at the start of this level
  to_xp: number; // xp needed for the next one
}

export function levelOf(xp: number): LevelInfo {
  let n = 1;
  while (xpForLevel(n + 1) <= xp) n++;
  return { level: n, xp, from_xp: xpForLevel(n), to_xp: xpForLevel(n + 1) };
}

interface Ctx {
  totalMinutes: number;
  sessions: number;
  focusSessions: number;
  tasksDone: number;
  bestStreak: number;
  bestHabitStreak: number;
  weeklyGoalReached: boolean;
  categoriesThisWeek: number;
  goodSleepDays: number;
  waterDays: number;
}

interface BadgeDef {
  key: string;
  icon: string;
  title: string;
  desc: string;
  need: number;
  have: (c: Ctx) => number;
}

const BADGES: BadgeDef[] = [
  { key: 'first_hour', icon: '🌱', title: 'اولین ساعت', desc: 'یک ساعت فعالیت ثبت کن', need: 60, have: (c) => c.totalMinutes },
  { key: 'hours_10', icon: '⏱', title: '۱۰ ساعت', desc: 'جمعاً ۱۰ ساعت فعالیت', need: 600, have: (c) => c.totalMinutes },
  { key: 'hours_50', icon: '🔥', title: '۵۰ ساعت', desc: 'جمعاً ۵۰ ساعت فعالیت', need: 3000, have: (c) => c.totalMinutes },
  { key: 'hours_100', icon: '💯', title: '۱۰۰ ساعت', desc: 'جمعاً ۱۰۰ ساعت فعالیت', need: 6000, have: (c) => c.totalMinutes },
  { key: 'hours_500', icon: '🏔', title: '۵۰۰ ساعت', desc: 'جمعاً ۵۰۰ ساعت فعالیت', need: 30000, have: (c) => c.totalMinutes },
  { key: 'sessions_50', icon: '📚', title: '۵۰ جلسه', desc: '۵۰ جلسه‌ی ثبت‌شده', need: 50, have: (c) => c.sessions },
  { key: 'focus_10', icon: '🎯', title: 'ده دوره تمرکز', desc: '۱۰ دوره‌ی پومودورو کامل', need: 10, have: (c) => c.focusSessions },
  { key: 'streak_7', icon: '📅', title: 'یک هفته پشت‌سرهم', desc: '۷ روز پشت‌سرهم تو یه دسته به هدف برس', need: 7, have: (c) => c.bestStreak },
  { key: 'streak_30', icon: '🗓', title: 'یک ماه پشت‌سرهم', desc: '۳۰ روز پشت‌سرهم تو یه دسته', need: 30, have: (c) => c.bestStreak },
  { key: 'week_goal', icon: '🏁', title: 'هدف هفته', desc: 'به هدف هفتگی یه دسته برس', need: 1, have: (c) => (c.weeklyGoalReached ? 1 : 0) },
  { key: 'allrounder', icon: '🎛', title: 'همه‌فن‌حریف', desc: 'تو یه هفته توی ۳ دسته‌ی مختلف فعالیت کن', need: 3, have: (c) => c.categoriesThisWeek },
  { key: 'tasks_10', icon: '✅', title: 'ده کار انجام‌شده', desc: '۱۰ کار رو تیک بزن', need: 10, have: (c) => c.tasksDone },
  { key: 'habit_7', icon: '🔁', title: 'عادت هفت‌روزه', desc: 'یه عادت رو ۷ روز پشت‌سرهم نگه دار', need: 7, have: (c) => c.bestHabitStreak },
  { key: 'sleep_7', icon: '😴', title: 'خواب خوب', desc: '۷ روز با حداقل ۷ ساعت خواب ثبت کن', need: 7, have: (c) => c.goodSleepDays },
  { key: 'water_7', icon: '💧', title: 'آب‌خور', desc: '۷ روز آب خوردنت رو ثبت کن', need: 7, have: (c) => c.waterDays },
];

async function context(db: D1Database, s: Settings, now: number): Promise<{ ctx: Ctx; perCategory: Map<number, number> }> {
  const today = localDate(now, s.timezone);
  const cats = await listCategories(db, true);
  const perCategory = new Map<number, number>();
  const add = (rows: { category_id: number; m: number }[]) => {
    for (const r of rows) perCategory.set(r.category_id, (perCategory.get(r.category_id) ?? 0) + Number(r.m));
  };
  add((await db.prepare(`SELECT category_id, COALESCE(SUM(minutes), 0) AS m FROM study_sessions GROUP BY category_id`).all<{ category_id: number; m: number }>()).results);
  add((await db.prepare(`SELECT category_id, COALESCE(SUM(minutes), 0) AS m FROM focus_sessions GROUP BY category_id`).all<{ category_id: number; m: number }>()).results);
  const totalMinutes = [...perCategory.values()].reduce((a, b) => a + b, 0);
  const n = async (sql: string) => Number((await db.prepare(sql).first<{ n: number }>())?.n ?? 0);

  const daily = await dailyMinutes(db, addDays(today, -400));
  const active = cats.filter((c) => c.is_active);
  const streaks = streaksFrom(daily, active, today);
  const weekStart = addDays(today, -iranWeekday(today));
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const weekOf = (id: number) => weekDays.reduce((a, d) => a + (daily.get(id)?.get(d) ?? 0), 0);
  const habits = (await listHabits(db, today)).habits;

  return {
    perCategory,
    ctx: {
      totalMinutes,
      sessions: await n(`SELECT COUNT(*) AS n FROM study_sessions`),
      focusSessions: await n(`SELECT COUNT(*) AS n FROM focus_sessions`),
      tasksDone: await n(`SELECT COUNT(*) AS n FROM tasks WHERE done = 1 AND deleted_at IS NULL`),
      bestStreak: Math.max(0, ...streaks.map((x) => x.best)),
      bestHabitStreak: Math.max(0, ...habits.map((h) => h.best)),
      weeklyGoalReached: active.some((c) => c.weekly_goal_minutes !== null && weekOf(c.id) >= c.weekly_goal_minutes),
      categoriesThisWeek: active.filter((c) => weekOf(c.id) > 0).length,
      goodSleepDays: await n(`SELECT COUNT(*) AS n FROM day_logs WHERE sleep_hours >= 7`),
      waterDays: await n(`SELECT COUNT(*) AS n FROM day_logs WHERE water > 0`),
    },
  };
}

export interface BadgeView {
  key: string;
  icon: string;
  title: string;
  desc: string;
  have: number;
  need: number;
  unlocked_at: number | null;
}

export interface ProgressView {
  overall: LevelInfo;
  categories: { id: number; title: string; icon: string; color: string; is_active: number; level: LevelInfo }[];
  badges: BadgeView[];
}

export async function progressView(db: D1Database, s: Settings, now: number): Promise<ProgressView> {
  const { ctx, perCategory } = await context(db, s, now);
  const cats = await listCategories(db, true);
  const unlocked = new Map((await db.prepare(`SELECT key, unlocked_at FROM achievements`).all<{ key: string; unlocked_at: number }>()).results.map((r) => [r.key, r.unlocked_at]));
  return {
    overall: levelOf(ctx.totalMinutes),
    categories: cats.filter((c) => perCategory.has(c.id) || c.is_active).map((c) => ({ id: c.id, title: c.title, icon: c.icon, color: c.color, is_active: c.is_active, level: levelOf(perCategory.get(c.id) ?? 0) })),
    badges: BADGES.map((b) => ({ key: b.key, icon: b.icon, title: b.title, desc: b.desc, have: Math.min(b.have(ctx), b.need), need: b.need, unlocked_at: unlocked.get(b.key) ?? null })),
  };
}

/** Unlock every badge whose goal is reached. Returns the ones unlocked just now. */
export async function evaluateAchievements(db: D1Database, s: Settings, now: number): Promise<{ key: string; icon: string; title: string }[]> {
  const { ctx } = await context(db, s, now);
  const have = new Set((await db.prepare(`SELECT key FROM achievements`).all<{ key: string }>()).results.map((r) => r.key));
  const fresh: { key: string; icon: string; title: string }[] = [];
  for (const b of BADGES) {
    if (have.has(b.key) || b.have(ctx) < b.need) continue;
    const r = await db.prepare(`INSERT OR IGNORE INTO achievements (key, unlocked_at) VALUES (?1, ?2)`).bind(b.key, now).run();
    if ((r.meta.changes ?? 0) > 0) fresh.push({ key: b.key, icon: b.icon, title: b.title });
  }
  return fresh;
}

