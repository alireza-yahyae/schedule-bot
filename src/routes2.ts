// Phase 2 API routes: partner, templates, study log, habits, grades.
// api.ts calls routePhase2() first; it returns null for routes that are not ours.

import type { Env, Role, TemplateCategory } from './types.ts';
import { Telegram } from './telegram.ts';
import { loadRawSettings, loadSettings, setSetting } from './db.ts';
import { ApiError, bad } from './http.ts';
import { localDate } from './time.ts';
import {
  CATEGORIES, composeMessage, createTemplate, deleteStudy, deleteTemplate, getPartner, listTemplates, logStudy, newPairingCode,
  partnerStudy, sendToPartner, studySnapshot, unpair, updatePartner, updateTemplate,
} from './partner.ts';
import { deleteOverride, listOverrides, planForDate, saveOverride } from './overrides.ts';
import { addManual, cancelTimer, listSessions, startTimer, stopTimer, studySummary, updateSession } from './study.ts';
import { listMeals, setMeal } from './meals.ts';
import { createCategory, deleteCategory, listCategories, resolveCategoryId, updateCategory } from './categories.ts';
import { bodyToday, saveDayLog, saveEnergy } from './body.ts';
import { evaluateAchievements, progressView } from './progress.ts';
import { sendBackup } from './backup.ts';
import { unlinkPartner } from './registry.ts';
import { challengeViews, deleteChallenge, saveChallenge } from './challenges.ts';
import { addLibrary, cancelOutbox, deleteLibrary, listLibrary, listOutbox, sendOrSchedule } from './pmsg.ts';
import { currentCycle, quietNow } from './overrides.ts';
import { createGrade, createHabit, deleteGrade, deleteHabit, listGrades, listHabits, toggleHabit, updateGrade } from './growth.ts';

export interface Phase2Ctx {
  env: Env;
  now: number;
  role: Role;
  method: string;
  parts: string[]; // URL segments after "/api"
  body: Record<string, unknown>;
}
export interface Phase2Result {
  data: unknown;
  status?: number;
}

/** What the connected partner may do. Everything else is owner-only. */
const OVERRIDE_ROUTES = ['GET overrides', 'POST overrides', 'DELETE overrides/:id'];
const PARTNER_ROUTES = new Set([
  'GET partner/state', 'POST templates', 'PUT templates/:id', 'DELETE templates/:id',
  'GET partner/home', 'POST partner/message', 'GET partner/library', 'POST partner/library', 'DELETE partner/library/:id', 'DELETE partner/outbox/:id',
  'GET challenges', 'PUT challenges', 'DELETE challenges/:id',
]);
/** Only the partner may use these: the owner must not see or touch what she writes for him. */
const PARTNER_ONLY = new Set(['GET partner/home', 'POST partner/message', 'GET partner/library', 'POST partner/library', 'DELETE partner/library/:id', 'DELETE partner/outbox/:id', 'PUT challenges', 'DELETE challenges/:id']);
const PARTNER_WRITES = new Set(['POST templates', 'PUT templates/:id', 'DELETE templates/:id']);

const idOf = (p: string | undefined): number => {
  const n = Number(p);
  if (!Number.isInteger(n) || n <= 0) throw new ApiError(404, 'پیدا نشد');
  return n;
};

async function botUsername(env: Env): Promise<string | null> {
  const raw = await loadRawSettings(env.DB);
  if (raw.bot_username) return raw.bot_username;
  const r = await new Telegram(env.BOT_TOKEN).call<{ username?: string }>('getMe', {});
  if (r.ok && r.result.username) {
    await setSetting(env.DB, 'bot_username', r.result.username, Math.floor(Date.now() / 1000));
    return r.result.username;
  }
  return null;
}

async function partnerState(c: Phase2Ctx) {
  const db = c.env.DB;
  const p = await getPartner(db);
  const templates = await listTemplates(db);
  if (c.role === 'partner') {
    return { role: 'partner', partner: { name: p.name, allow_edit: p.allow_partner_edit_templates }, templates };
  }
  const s = await loadSettings(db);
  const snap = await studySnapshot(db, s, c.now);
  const username = p.chat_id ? null : await botUsername(c.env);
  return {
    role: 'owner',
    partner: {
      paired: p.chat_id !== null,
      name: p.name,
      pairing_code: p.pairing_code,
      invite_url: p.pairing_code && username ? `https://t.me/${username}?start=pair_${c.env.TENANT_ID ? c.env.TENANT_ID + '_' : ''}${p.pairing_code}` : null,
      bot_username: username,
      allow_partner_edit_templates: p.allow_partner_edit_templates,
      auto_notify_enabled: p.auto_notify_enabled,
      idle_threshold_hours: p.idle_threshold_hours,
      hard_study_threshold_hours: p.hard_study_threshold_hours,
      last_notified_at: p.last_notified_at,
    },
    templates,
    study: { today_minutes: snap.todayMinutes, today_hours: snap.todayHours, idle_hours: snap.idleHours, last_study_ts: snap.lastStudyTs },
  };
}

/** Everything the partner's home screen shows (study / schedule only if the owner shares them). */
async function partnerHome(c: Phase2Ctx, s: Awaited<ReturnType<typeof loadSettings>>) {
  const db = c.env.DB;
  const p = await getPartner(db);
  const snap = await studySnapshot(db, s, c.now);
  const q = await quietNow(db, s.timezone, c.now);
  const classes = p.share_schedule
    ? (
        await db
          .prepare(`SELECT title, start_ts, end_ts, location, status FROM occurrences WHERE is_test = 0 AND start_ts >= ?1 AND start_ts < ?2 ORDER BY start_ts`)
          .bind(snap.cycle.startTs, snap.cycle.sleepTs)
          .all<{ title: string; start_ts: number; end_ts: number; location: string | null; status: string }>()
      ).results
    : null;
  return {
    role: 'partner',
    now: c.now,
    tz: s.timezone,
    digits: s.digits,
    partner: { name: p.name, allow_edit: p.allow_partner_edit_templates, allow_send: p.allow_partner_send, share_study: p.share_study, share_schedule: p.share_schedule },
    owner: { awake: snap.cycle.awake, quiet: q.quiet },
    study: p.share_study ? await partnerStudy(db, s, c.now) : null,
    categories: (await listCategories(db)).filter((x) => x.share_with_partner).map((x) => ({ id: x.id, title: x.title, icon: x.icon })),
    classes,
    challenge: await challengeViews(db, s, c.now),
    outbox: await listOutbox(db),
    library: await listLibrary(db),
  };
}

export async function routePhase2(c: Phase2Ctx): Promise<Phase2Result | null> {
  const key = `${c.method} ${c.parts.map((x, i) => (i > 0 && /^\d+$/.test(x) ? ':id' : x)).join('/')}`;
  const OURS = [
    'GET partner/state', 'PUT partner', 'POST partner/unpair', 'POST partner/newcode', 'POST partner/preview', 'POST partner/send',
    'POST study', 'DELETE study/:id', 'PUT study/:id', 'GET study/sessions',
    'GET templates', 'POST templates', 'PUT templates/:id', 'DELETE templates/:id',
    'GET habits', 'POST habits', 'DELETE habits/:id', 'POST habits/:id/toggle',
    'GET grades', 'POST grades', 'PUT grades/:id', 'DELETE grades/:id',
    ...OVERRIDE_ROUTES,
    'POST study/timer/start', 'POST study/timer/stop', 'POST study/timer/cancel', 'POST study/manual', 'POST meals',
    'GET partner/home', 'POST partner/message', 'GET partner/library', 'POST partner/library', 'DELETE partner/library/:id', 'DELETE partner/outbox/:id',
    'GET challenges', 'PUT challenges', 'DELETE challenges/:id',
    'GET categories', 'POST categories', 'PUT categories/:id', 'DELETE categories/:id',
    'PUT body', 'POST mood', 'GET progress', 'GET export/study', 'POST backup/send',
  ];
  if (!OURS.includes(key)) return null;

  const { env, now, role, body } = c;
  const db = env.DB;

  if (role === 'owner' && PARTNER_ONLY.has(key)) throw new ApiError(403, 'این بخش مخصوص پارتنره.');
  if (role === 'partner') {
    if (!PARTNER_ROUTES.has(key)) throw new ApiError(403, 'دسترسی نداری.');
    if (PARTNER_WRITES.has(key)) {
      const p = await getPartner(db);
      if (!p.allow_partner_edit_templates) throw new ApiError(403, 'ویرایش پیام‌ها برای تو غیرفعال شده.');
    }
  }

  const s = await loadSettings(db);
  const today = localDate(now, s.timezone);

  switch (key) {
    // ---------------------------------------------------------------- partner
    case 'GET partner/state':
      return { data: await partnerState(c) };

    case 'PUT partner':
      await updatePartner(db, body);
      return { data: await partnerState(c) };

    case 'POST partner/unpair': {
      const before = await getPartner(db);
      await unpair(db);
      await unlinkPartner(c.env, before.chat_id ? Number(before.chat_id) : null);
      return { data: await partnerState(c) };
    }

    case 'POST partner/newcode':
      await newPairingCode(db);
      return { data: await partnerState(c) };

    case 'POST partner/preview': {
      const category = body.category as TemplateCategory;
      if (!CATEGORIES.includes(category)) bad('دسته‌بندی پیام درست نیست');
      const p = await getPartner(db);
      if (!p.chat_id) bad('اول پارتنر رو وصل کن.');
      const m = await composeMessage(db, category, now);
      return { data: { text: m.text, template_id: m.template_id, name: p.name } };
    }

    case 'POST partner/send': {
      const text = String(body.text ?? '').trim();
      if (!text) bad('متن پیام خالیه');
      if (text.length > 1000) bad('متن پیام خیلی طولانیه');
      const p = await getPartner(db);
      if (!p.chat_id) bad('اول پارتنر رو وصل کن.');
      const r = await sendToPartner(new Telegram(env.BOT_TOKEN), p, text);
      if (!r.ok) throw new ApiError(502, `پیام نرفت. احتمالاً ${p.name} هنوز ربات رو استارت نکرده یا بلاکش کرده.`);
      await db.prepare(`UPDATE partner_settings SET last_notified_at = ?1 WHERE id = 1`).bind(now).run();
      return { data: { ok: true } };
    }

    // ---------------------------------------------------------------- study log
    case 'POST study': {
      const minutes = Number(body.minutes);
      if (!Number.isInteger(minutes) || minutes < 1 || minutes > 720) bad('مدت باید بین ۱ تا ۷۲۰ دقیقه باشه');
      const categoryId = await resolveCategoryId(db, body.category_id);
      const id = await logStudy(db, s, minutes, null, now, categoryId);
      const snap = await studySnapshot(db, s, now);
      return { data: { id, today_minutes: snap.todayMinutes, today_hours: snap.todayHours, idle_hours: snap.idleHours }, status: 201 };
    }
    case 'DELETE study/:id':
      await deleteStudy(db, idOf(c.parts[1]));
      return { data: { ok: true } };

    case 'PUT study/:id': {
      const r = await updateSession(db, s, now, idOf(c.parts[1]), body);
      return { data: { ...r, study: await studySummary(db, s, now) } };
    }
    case 'GET study/sessions':
      return { data: { sessions: await listSessions(db, s, now) } };

    // ---------------------------------------------------------------- study timer, manual entries, meals
    case 'POST study/timer/start': {
      const startedAt = await startTimer(db, now, body.minutes_ago, body.category_id, body.task_id);
      return { data: { started_at: startedAt, study: await studySummary(db, s, now) }, status: 201 };
    }
    case 'POST study/timer/stop': {
      const r = await stopTimer(db, s, now, body.break_minutes, body.note);
      return { data: { ...r, study: await studySummary(db, s, now), unlocked: await evaluateAchievements(db, s, now) } };
    }
    case 'POST study/timer/cancel':
      await cancelTimer(db);
      return { data: { study: await studySummary(db, s, now) } };
    case 'POST study/manual': {
      const r = await addManual(db, s, now, body);
      return { data: { ...r, study: await studySummary(db, s, now), unlocked: await evaluateAchievements(db, s, now) }, status: 201 };
    }
    // ---------------------------------------------------------------- water, exercise, sleep, energy; levels and badges; export; backup (owner only)
    case 'PUT body': {
      await saveDayLog(db, s, now, body);
      return { data: { body: await bodyToday(db, s, now), unlocked: await evaluateAchievements(db, s, now) } };
    }
    case 'POST mood': {
      await saveEnergy(db, s, now, body);
      return { data: { body: await bodyToday(db, s, now) } };
    }
    case 'GET progress':
      return { data: await progressView(db, s, now) };
    case 'GET export/study': {
      const rows = (
        await db
          .prepare(
            `SELECT x.date, x.started_at, x.ended_at, x.minutes, c.title AS category, t.title AS task, x.note, x.type FROM (
               SELECT date, started_at, created_at AS ended_at, minutes, category_id, task_id, note, 'timer' AS type FROM study_sessions
               UNION ALL
               SELECT date, started_at, started_at + minutes * 60 AS ended_at, minutes, category_id, NULL AS task_id, NULL AS note, 'focus' AS type FROM focus_sessions
             ) x LEFT JOIN categories c ON c.id = x.category_id LEFT JOIN tasks t ON t.id = x.task_id
             ORDER BY x.date, x.ended_at LIMIT 20000`,
          )
          .all<Record<string, unknown>>()
      ).results;
      return { data: { rows } };
    }
    case 'POST backup/send': {
      const r = await sendBackup(c.env, new Telegram(c.env.BOT_TOKEN), s, now);
      if (!r.ok) throw new ApiError(502, 'فایل بکاپ به تلگرام نرسید. دوباره امتحان کن.');
      return { data: { ok: true, kb: Math.max(1, Math.round(r.bytes / 1024)) } };
    }

    // ---------------------------------------------------------------- activity categories (owner only)
    case 'GET categories':
      return { data: { categories: await listCategories(db, true) } };
    case 'POST categories':
      return { data: { category: await createCategory(db, now, body) }, status: 201 };
    case 'PUT categories/:id':
      return { data: { category: await updateCategory(db, idOf(c.parts[1]), body) } };
    case 'DELETE categories/:id':
      return { data: await deleteCategory(db, idOf(c.parts[1])) };

    case 'POST meals': {
      const cyc = await currentCycle(db, s.timezone, now);
      await setMeal(db, cyc.day, s.timezone, now, body);
      return { data: { meals: await listMeals(db, cyc.day) } };
    }

    // ---------------------------------------------------------------- challenges + what the partner writes
    case 'GET challenges':
      return { data: await challengeViews(db, s, now) };
    case 'PUT challenges': {
      await saveChallenge(env, new Telegram(env.BOT_TOKEN), s, now, body);
      return { data: await challengeViews(db, s, now) };
    }
    case 'DELETE challenges/:id':
      await deleteChallenge(db, idOf(c.parts[1]));
      return { data: await challengeViews(db, s, now) };
    case 'GET partner/home':
      return { data: await partnerHome(c, s) };
    case 'POST partner/message': {
      const r = await sendOrSchedule(env, new Telegram(env.BOT_TOKEN), s, now, body);
      return { data: { ...r, outbox: await listOutbox(db) }, status: 201 };
    }
    case 'GET partner/library':
      return { data: { library: await listLibrary(db) } };
    case 'POST partner/library':
      await addLibrary(db, body.text, now);
      return { data: { library: await listLibrary(db) }, status: 201 };
    case 'DELETE partner/library/:id':
      await deleteLibrary(db, idOf(c.parts[2]));
      return { data: { library: await listLibrary(db) } };
    case 'DELETE partner/outbox/:id':
      await cancelOutbox(db, idOf(c.parts[2]));
      return { data: { outbox: await listOutbox(db) } };

    // ---------------------------------------------------------------- templates
    case 'GET templates':
      return { data: { templates: await listTemplates(db) } };
    case 'POST templates':
      return { data: { template: await createTemplate(db, role, body, now) }, status: 201 };
    case 'PUT templates/:id':
      return { data: { template: await updateTemplate(db, idOf(c.parts[1]), body) } };
    case 'DELETE templates/:id':
      await deleteTemplate(db, idOf(c.parts[1]));
      return { data: { ok: true } };

    // ---------------------------------------------------------------- habits
    case 'GET habits':
      return { data: await listHabits(db, today) };
    case 'POST habits':
      await createHabit(db, body, now);
      return { data: await listHabits(db, today), status: 201 };
    case 'DELETE habits/:id':
      await deleteHabit(db, idOf(c.parts[1]));
      return { data: await listHabits(db, today) };
    case 'POST habits/:id/toggle': {
      const done = await toggleHabit(db, idOf(c.parts[1]), body.date, today);
      return { data: { done, ...(await listHabits(db, today)) } };
    }

    // ---------------------------------------------------------------- special days
    case 'GET overrides':
      return { data: { overrides: await listOverrides(db, today), plan: await planForDate(db, today) } };
    case 'POST overrides':
      await saveOverride(db, body, today, now);
      return { data: { overrides: await listOverrides(db, today), plan: await planForDate(db, today) }, status: 201 };
    case 'DELETE overrides/:id':
      await deleteOverride(db, idOf(c.parts[1]));
      return { data: { overrides: await listOverrides(db, today), plan: await planForDate(db, today) } };

    // ---------------------------------------------------------------- grades
    case 'GET grades':
      return { data: { grades: await listGrades(db) } };
    case 'POST grades':
      return { data: { grade: await createGrade(db, body, now) }, status: 201 };
    case 'PUT grades/:id':
      return { data: { grade: await updateGrade(db, idOf(c.parts[1]), body) } };
    case 'DELETE grades/:id':
      await deleteGrade(db, idOf(c.parts[1]));
      return { data: { ok: true } };
  }
  return null;
}
