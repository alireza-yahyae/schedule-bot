// Friday evening: a short summary of the week in Telegram.

import { dailyMinutes, streaksFrom } from './activity.ts';
import { listCategories } from './categories.ts';
import { claim, loadRawSettings, markFailed, markSent } from './db.ts';
import { listHabits } from './growth.ts';
import { escapeHtml } from './messages.ts';
import { addDays, iranWeekday, localDate, localHM, makeDigits, WEEKDAY_FA } from './time.ts';
import type { Env, Settings } from './types.ts';
import type { Telegram } from './telegram.ts';

const FRIDAY = 6;
const SEND_FROM = '20:00';

export async function sendWeeklyReport(env: Env, tg: Telegram, s: Settings, now: number): Promise<void> {
  const db = env.DB;
  const raw = await loadRawSettings(db);
  if (raw.weekly_report === '0') return;
  const today = localDate(now, s.timezone);
  if (iranWeekday(today) !== FRIDAY || localHM(now, s.timezone) < SEND_FROM) return;

  const weekStart = addDays(today, -6); // Saturday
  const key = `weekly:${weekStart}`;
  if (!(await claim(db, key, now))) return;
  try {
    const text = await buildReport(db, s, today, weekStart);
    if (text === null) {
      await markSent(db, key, null); // nothing happened this week and last week; stay quiet
      return;
    }
    const sent = await tg.sendMessage(Number(env.OWNER_ID), text, undefined, true);
    if (sent.ok) await markSent(db, key, sent.result.message_id);
    else await markFailed(db, key);
  } catch (e) {
    await markFailed(db, key);
    console.error('weekly report failed', e instanceof Error ? e.message : String(e));
  }
}

function pct(now: number, before: number, d: (v: string | number) => string): string {
  if (before <= 0) return '';
  const p = Math.round(((now - before) / before) * 100);
  if (p === 0) return ' (مثل هفته‌ی قبل)';
  return ` (${p > 0 ? '▲' : '▼'} ${d(Math.abs(p))}٪)`;
}

export async function buildReport(db: D1Database, s: Settings, today: string, weekStart: string): Promise<string | null> {
  const d = makeDigits(s.digits);
  const dur = (m: number) => {
    const h = Math.floor(m / 60);
    const mm = m % 60;
    if (h === 0) return `${d(mm)} دقیقه`;
    return mm === 0 ? `${d(h)} ساعت` : `${d(h)} ساعت و ${d(mm)} دقیقه`;
  };
  const prevStart = addDays(weekStart, -7);
  const cats = await listCategories(db);
  const daily = await dailyMinutes(db, addDays(today, -400));

  const thisWeek = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const lastWeek = Array.from({ length: 7 }, (_, i) => addDays(prevStart, i));
  const sum = (catId: number, days: string[]) => days.reduce((a, day) => a + (daily.get(catId)?.get(day) ?? 0), 0);

  let total = 0;
  let prevTotal = 0;
  const perDay = thisWeek.map(() => 0);
  const lines: string[] = [];
  for (const c of cats) {
    const m = sum(c.id, thisWeek);
    const pm = sum(c.id, lastWeek);
    total += m;
    prevTotal += pm;
    thisWeek.forEach((day, i) => (perDay[i] += daily.get(c.id)?.get(day) ?? 0));
    if (m === 0 && pm === 0) continue;
    let goal = '';
    if (c.weekly_goal_minutes) goal = m >= c.weekly_goal_minutes ? ' ✅ هدف هفته' : ` • ${d(Math.round((m / c.weekly_goal_minutes) * 100))}٪ هدف هفته`;
    let dayGoal = '';
    if (c.daily_goal_minutes) {
      const hit = thisWeek.filter((day) => (daily.get(c.id)?.get(day) ?? 0) >= (c.daily_goal_minutes as number)).length;
      dayGoal = ` • هدف روزانه ${d(hit)} از ${d(7)} روز`;
    }
    lines.push(`${escapeHtml(c.icon)} ${escapeHtml(c.title)}: <b>${dur(m)}</b>${pct(m, pm, d)}${goal}${dayGoal}`);
  }
  if (total === 0 && prevTotal === 0) return null;

  const out: string[] = ['📊 <b>گزارش این هفته</b>', '', `⏱ مجموع: <b>${dur(total)}</b>${pct(total, prevTotal, d)}`, '', ...lines];

  const active = perDay.map((m, i) => ({ m, i })).filter((x) => x.m > 0);
  if (active.length >= 2) {
    const best = active.reduce((a, b) => (b.m > a.m ? b : a));
    const worst = active.reduce((a, b) => (b.m < a.m ? b : a));
    out.push('', `🏆 پرکارترین روز: ${WEEKDAY_FA[best.i]} (${dur(best.m)})`, `🐢 کم‌کارترین روز فعال: ${WEEKDAY_FA[worst.i]} (${dur(worst.m)})`);
  }
  const quiet = perDay.filter((m) => m === 0).length;
  if (quiet > 0) out.push(`💤 روز بدون ثبت: ${d(quiet)}`);

  const streaks = streaksFrom(daily, cats, today).filter((x) => x.streak >= 2);
  if (streaks.length) {
    out.push('', '🔥 ' + streaks.map((x) => { const c = cats.find((k) => k.id === x.category_id); return `${escapeHtml(c ? c.title : '')} ${d(x.streak)} روز`; }).join(' • '));
  }

  const habits = (await listHabits(db, today)).habits;
  if (habits.length) {
    const week = new Set(thisWeek);
    let ticks = 0;
    for (const h of habits) for (const day of Object.keys(h.logs)) if (week.has(day)) ticks++;
    out.push('', `✅ عادت‌ها: ${d(ticks)} تیک از ${d(habits.length * 7)}`);
  }
  out.push('', 'هفته‌ی خوبی داشته باشی 🌱');
  return out.join('\n');
}
