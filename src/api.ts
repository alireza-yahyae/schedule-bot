// JSON API used by the Mini App. Every request must carry valid Telegram initData
// ("Authorization: tma <initData>") AND belong to the owner (OWNER_ID).

import type { Env, Occ, Role } from './types.ts';
import { Telegram } from './telegram.ts';
import { verifyInitData } from './auth.ts';
import { ApiError } from './http.ts';
import { getPartner } from './partner.ts';
import { listOverrides, planForDate } from './overrides.ts';
import { routePhase2 } from './routes2.ts';
import { studySummary } from './study.ts';
import { listCategories, resolveCategoryId } from './categories.ts';
import { bodyStats, bodyToday } from './body.ts';
import { evaluateAchievements } from './progress.ts';
import { listMeals } from './meals.ts';
import { challengeViews } from './challenges.ts';
import { emit, getOcc, loadRawSettings, loadSettings, parseOffsets } from './db.ts';
import { parseJalali } from './jalali.ts';
import { ensureOccurrences } from './occurrences.ts';
import { retireMessage } from './scheduler.ts';
import { validateTelegramHtml } from './messages.ts';
import { addDays, iranWeekday, localDate } from './time.ts';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

type Obj = Record<string, unknown>;

// ---------------------------------------------------------------- validation helpers
function bad(msg: string): never {
  throw new ApiError(400, msg);
}
function str(v: unknown, max: number, label: string, required = false): string | null {
  if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
    if (required) bad(`${label} لازمه`);
    return null;
  }
  if (typeof v !== 'string' && typeof v !== 'number') bad(`${label} درست نیست`);
  const s = String(v).trim();
  if (s.length > max) bad(`${label} خیلی طولانیه`);
  return s;
}
function intIn(v: unknown, min: number, max: number, label: string): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) bad(`${label} باید عددی بین ${min} و ${max} باشه`);
  return n;
}
function hhmm(v: unknown, label: string, required = false): string | null {
  if (v === undefined || v === null || v === '') {
    if (required) bad(`${label} لازمه`);
    return null;
  }
  if (typeof v !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) bad(`${label} باید به شکل ساعت:دقیقه باشه`);
  return v;
}
function isoDate(v: unknown, label: string): string | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) bad(`${label} درست نیست`);
  return v;
}
function colorOf(v: unknown): string {
  if (v === undefined || v === null || v === '') return '#4F8CFF';
  if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v)) bad('رنگ درست نیست');
  return v;
}
function toMin(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

// ---------------------------------------------------------------- courses
interface SessionInput {
  id: number | null;
  weekday: number;
  start_time: string;
  end_time: string;
  location: string | null;
  kind: string;
}
interface CourseInput {
  name: string;
  group_no: string | null;
  teacher: string | null;
  location: string | null;
  units: number | null;
  color: string;
  notes: string | null;
  exam_date: string | null;
  exam_date_j: string | null;
  exam_start: string | null;
  exam_end: string | null;
  exam_location: string | null;
  offsets: string | null;
  nag_interval_min: number | null;
  notify_partner: number;
  allowed_absences: number;
  kind: 'class' | 'work';
  sessions: SessionInput[];
}

function parseCourse(b: Obj): CourseInput {
  const kind: 'class' | 'work' = b.kind === 'work' ? 'work' : 'class';
  const name = str(b.name, 100, kind === 'work' ? 'نام برنامه‌ی کاری' : 'نام درس', true) as string;
  let units: number | null = null;
  if (b.units !== undefined && b.units !== null && b.units !== '') {
    units = Number(b.units);
    if (!Number.isFinite(units) || units < 0 || units > 30) bad('تعداد واحد درست نیست');
  }
  let examJ: string | null = null;
  let examG: string | null = null;
  const rawExam = str(b.exam_date_j, 12, 'تاریخ امتحان');
  if (rawExam) {
    examG = parseJalali(rawExam);
    if (!examG) bad('تاریخ امتحان درست نیست');
    examJ = rawExam.replace(/-/g, '/');
  }
  const examStart = hhmm(b.exam_start, 'ساعت شروع امتحان');
  const examEnd = hhmm(b.exam_end, 'ساعت پایان امتحان');
  if (examStart && examEnd && toMin(examEnd) <= toMin(examStart)) bad('ساعت پایان امتحان باید بعد از شروعش باشه');

  let offsets: string | null = null;
  if (b.offsets !== undefined && b.offsets !== null && String(b.offsets).trim() !== '') {
    const parsed = parseOffsets(String(b.offsets));
    const raw = String(b.offsets).trim();
    if (raw === '0') offsets = '0';
    else if (!parsed || parsed.length === 0 || parsed.length > 8 || parsed.some((n) => n > 720)) bad('زمان یادآوری‌ها درست نیست');
    else offsets = parsed.join(',');
  }

  const sessionsRaw = Array.isArray(b.sessions) ? (b.sessions as unknown[]) : [];
  if (sessionsRaw.length > 14) bad('تعداد جلسه‌ها زیاده');
  const sessions: SessionInput[] = sessionsRaw.map((raw) => {
    const s = (raw ?? {}) as Obj;
    const weekday = intIn(s.weekday, 0, 6, 'روز هفته');
    if (weekday === null) bad('روز هفته لازمه');
    const start = hhmm(s.start_time, 'ساعت شروع', true) as string;
    const end = hhmm(s.end_time, 'ساعت پایان', true) as string;
    if (toMin(end) <= toMin(start)) bad('ساعت پایان باید بعد از ساعت شروع باشه');
    const kind = typeof s.kind === 'string' && ['class', 'lab', 'workshop'].includes(s.kind) ? s.kind : 'class';
    const id = s.id === undefined || s.id === null ? null : Number(s.id);
    return {
      id: id !== null && Number.isInteger(id) ? id : null,
      weekday: weekday as number,
      start_time: start,
      end_time: end,
      location: str(s.location, 100, 'مکان جلسه'),
      kind,
    };
  });

  return {
    name,
    group_no: kind === 'work' ? null : str(b.group_no, 20, 'شماره گروه'),
    teacher: kind === 'work' ? null : str(b.teacher, 100, 'نام استاد'),
    location: str(b.location, 100, 'مکان'),
    units: kind === 'work' ? null : units,
    color: colorOf(b.color),
    notes: str(b.notes, 500, 'یادداشت'),
    exam_date: kind === 'work' ? null : examG,
    exam_date_j: kind === 'work' ? null : examJ,
    exam_start: kind === 'work' ? null : examStart,
    exam_end: kind === 'work' ? null : examEnd,
    exam_location: kind === 'work' ? null : str(b.exam_location, 100, 'مکان امتحان'),
    offsets,
    nag_interval_min: intIn(b.nag_interval_min, 1, 120, 'فاصله‌ی یادآوری تکراری'),
    notify_partner: b.notify_partner === false || b.notify_partner === 0 ? 0 : 1,
    allowed_absences: intIn(b.allowed_absences, 0, 30, 'تعداد غیبت مجاز') ?? 3,
    kind,
    sessions,
  };
}

/** Future classes that were not announced yet are re-created from the new data. */
async function dropFutureUnannounced(db: D1Database, courseId: number, now: number): Promise<void> {
  await db
    .prepare(
      `DELETE FROM occurrences
        WHERE course_id = ?1 AND is_test = 0 AND status = 'upcoming' AND next_nag_ts IS NULL AND start_ts > ?2
          AND NOT EXISTS (SELECT 1 FROM sent_log l WHERE l.key LIKE 'rem:' || occurrences.id || ':%')`,
    )
    .bind(courseId, now)
    .run();
}

async function saveCourse(db: D1Database, courseId: number | null, c: CourseInput, now: number): Promise<number> {
  const fields = [
    c.name,
    c.group_no,
    c.teacher,
    c.location,
    c.units,
    c.color,
    c.notes,
    c.exam_date,
    c.exam_date_j,
    c.exam_start,
    c.exam_end,
    c.exam_location,
    c.offsets,
    c.nag_interval_min,
    c.notify_partner,
    c.allowed_absences,
    c.kind,
  ];
  let id = courseId;
  if (id === null) {
    const sem = await db
      .prepare(`SELECT id FROM semesters WHERE is_active = 1 AND archived_at IS NULL ORDER BY id DESC LIMIT 1`)
      .first<{ id: number }>();
    if (!sem) bad('ترم فعالی وجود نداره');
    const r = await db
      .prepare(
        `INSERT INTO courses (semester_id, name, group_no, teacher, location, units, color, notes,
                              exam_date, exam_date_j, exam_start, exam_end, exam_location,
                              offsets, nag_interval_min, notify_partner, allowed_absences, kind)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)`,
      )
      .bind(sem.id, ...fields)
      .run();
    id = Number(r.meta.last_row_id);
  } else {
    await db
      .prepare(
        `UPDATE courses SET name = ?1, group_no = ?2, teacher = ?3, location = ?4, units = ?5, color = ?6,
                notes = ?7, exam_date = ?8, exam_date_j = ?9, exam_start = ?10, exam_end = ?11,
                exam_location = ?12, offsets = ?13, nag_interval_min = ?14, notify_partner = ?15,
                allowed_absences = ?16, kind = ?17
          WHERE id = ?18`,
      )
      .bind(...fields, id)
      .run();
    // Days that are already generated but not started yet follow the new type.
    await db.prepare(`UPDATE occurrences SET kind = ?1 WHERE course_id = ?2 AND status = 'upcoming' AND is_test = 0`).bind(c.kind, id).run();
  }

  // Sessions: keep (update) the ones that still exist, add new ones, remove the rest.
  const existing = await db
    .prepare(`SELECT id FROM course_sessions WHERE course_id = ?1`)
    .bind(id)
    .all<{ id: number }>();
  const existingIds = new Set(existing.results.map((r) => r.id));
  const kept = new Set<number>();
  const stmts: D1PreparedStatement[] = [];
  for (const s of c.sessions) {
    if (s.id !== null && existingIds.has(s.id)) {
      kept.add(s.id);
      stmts.push(
        db
          .prepare(
            `UPDATE course_sessions SET weekday = ?1, start_time = ?2, end_time = ?3, location = ?4, kind = ?5, active = 1
              WHERE id = ?6`,
          )
          .bind(s.weekday, s.start_time, s.end_time, s.location, s.kind, s.id),
      );
    } else {
      stmts.push(
        db
          .prepare(
            `INSERT INTO course_sessions (course_id, weekday, start_time, end_time, location, kind)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
          )
          .bind(id, s.weekday, s.start_time, s.end_time, s.location, s.kind),
      );
    }
  }
  for (const oldId of existingIds) {
    if (!kept.has(oldId)) stmts.push(db.prepare(`DELETE FROM course_sessions WHERE id = ?1`).bind(oldId));
  }
  if (stmts.length > 0) await db.batch(stmts);
  // Only AFTER the sessions are saved: otherwise the minute job could re-create the days from the old session data.
  await dropFutureUnannounced(db, id, now);
  return id;
}

interface SessionRow {
  id: number;
  course_id: number;
  weekday: number;
  start_time: string;
  end_time: string;
  location: string | null;
  kind: string;
}
interface CourseRow {
  id: number;
  name: string;
  [k: string]: unknown;
}

function findConflicts(sessions: SessionRow[], courses: CourseRow[]) {
  const names = new Map(courses.map((c) => [c.id, c.name]));
  const out: { weekday: number; a: Obj; b: Obj }[] = [];
  for (let i = 0; i < sessions.length; i++) {
    for (let j = i + 1; j < sessions.length; j++) {
      const a = sessions[i];
      const b = sessions[j];
      if (a.weekday !== b.weekday) continue;
      if (toMin(a.start_time) < toMin(b.end_time) && toMin(b.start_time) < toMin(a.end_time)) {
        out.push({
          weekday: a.weekday,
          a: { course_id: a.course_id, name: names.get(a.course_id) ?? '', start: a.start_time, end: a.end_time },
          b: { course_id: b.course_id, name: names.get(b.course_id) ?? '', start: b.start_time, end: b.end_time },
        });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- state
/** What the connected partner gets from /api/state: no class, task or setting data at all. */
async function partnerShell(env: Env, now: number) {
  const s = await loadSettings(env.DB);
  return {
    role: 'partner',
    now,
    tz: s.timezone,
    date: localDate(now, s.timezone),
    settings: { digits: s.digits },
    occurrences: [],
    courses: [],
    conflicts: [],
    tasks: [],
    pending_events: 0,
  };
}

async function buildState(env: Env, now: number) {
  const db = env.DB;
  const s = await loadSettings(db);
  const raw = await loadRawSettings(db);
  const today = localDate(now, s.timezone);
  const tomorrow = addDays(today, 1);
  await ensureOccurrences(db, today, s.timezone);
  await ensureOccurrences(db, tomorrow, s.timezone);
  const studySummary_ = await studySummary(db, s, now);
  const partnerRow = await getPartner(db);

  const occ = await db
    .prepare(
      `SELECT o.id, o.course_id, o.title, o.location, o.start_ts, o.end_ts, o.status, o.skip_reason,
              o.nag_count, o.is_test, o.date, c.color AS color
         FROM occurrences o LEFT JOIN courses c ON c.id = o.course_id
        WHERE o.date IN (?1, ?2) ORDER BY o.start_ts`,
    )
    .bind(today, tomorrow)
    .all<Obj>();

  const courses = await db
    .prepare(
      `SELECT c.* FROM courses c JOIN semesters m ON m.id = c.semester_id
        WHERE c.active = 1 AND m.is_active = 1 AND m.archived_at IS NULL ORDER BY c.id`,
    )
    .all<CourseRow>();
  const courseIds = new Set(courses.results.map((c) => c.id));
  const sessionsAll = await db
    .prepare(`SELECT * FROM course_sessions WHERE active = 1 ORDER BY weekday, start_time`)
    .all<SessionRow>();
  const sessions = sessionsAll.results.filter((x) => courseIds.has(x.course_id));

  const cs = await db
    .prepare(
      `SELECT course_id, status, COUNT(*) AS n FROM occurrences
        WHERE is_test = 0 AND course_id IS NOT NULL AND status IN ('attended','skipped','no_response','cancelled')
        GROUP BY course_id, status`,
    )
    .all<{ course_id: number; status: string; n: number }>();
  const counts = new Map<number, Record<string, number>>();
  for (const r of cs.results) {
    const m = counts.get(r.course_id) ?? {};
    m[r.status] = r.n;
    counts.set(r.course_id, m);
  }

  const tasks = await db
    .prepare(
      `SELECT id, title, course_id, due_date, due_time, priority, notes, done, done_at, category_id, estimate_min, repeat,
               (SELECT COALESCE(SUM(minutes), 0) FROM study_sessions s WHERE s.task_id = tasks.id) AS spent_min FROM tasks
        WHERE deleted_at IS NULL AND (done = 0 OR done_at > ?1)
        ORDER BY done, due_date IS NULL, due_date, priority DESC, id`,
    )
    .bind(now - 3 * 86400)
    .all<Obj>();

  const pending = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM trigger_events e LEFT JOIN occurrences o ON o.id = e.occurrence_id
        WHERE e.processed = 0 AND COALESCE(o.is_test, 0) = 0`,
    )
    .first<{ n: number }>();

  return {
    role: 'owner',
    partner_name: partnerRow.chat_id ? partnerRow.name : null,
    study: studySummary_,
    body: await bodyToday(db, s, now),
    meals: await listMeals(db, studySummary_.cycle.day),
    challenge: await challengeViews(db, s, now),
    today_plan: await planForDate(db, today),
    tomorrow_plan: await planForDate(db, tomorrow),
    overrides: await listOverrides(db, today),
    now,
    tz: s.timezone,
    date: today,
    settings: raw,
    occurrences: occ.results,
    courses: courses.results.map((c) => ({
      ...c,
      sessions: sessions.filter((x) => x.course_id === c.id),
      counts: counts.get(c.id) ?? {},
    })),
    // clashes are only checked between real classes (work events are shown, but never counted as a clash)
    conflicts: findConflicts(
      sessions.filter((x) => courses.results.find((c) => c.id === x.course_id)?.kind !== 'work'),
      courses.results.filter((c) => c.kind !== 'work'),
    ),
    tasks: tasks.results,
    pending_events: pending?.n ?? 0,
  };
}

// ---------------------------------------------------------------- stats
async function buildStats(env: Env, now: number) {
  const db = env.DB;
  const s = await loadSettings(db);
  const today = localDate(now, s.timezone);
  const rows = await db
    .prepare(
      `SELECT o.date, o.status, o.course_id, o.title, o.skip_reason
         FROM occurrences o
        WHERE o.is_test = 0 AND o.kind = 'class' AND o.status IN ('attended','skipped','no_response','cancelled')
        ORDER BY o.start_ts`,
    )
    .all<{ date: string; status: string; course_id: number | null; title: string; skip_reason: string | null }>();

  const overall = { attended: 0, skipped: 0, no_response: 0, cancelled: 0 };
  for (const r of rows.results) overall[r.status as keyof typeof overall]++;
  const counted = overall.attended + overall.skipped + overall.no_response;

  // Streak = classes attended in a row (cancelled classes are ignored).
  const seq = rows.results.filter((r) => r.status !== 'cancelled').map((r) => r.status === 'attended');
  let best = 0;
  let run = 0;
  for (const ok of seq) {
    run = ok ? run + 1 : 0;
    if (run > best) best = run;
  }
  let streak = 0;
  for (let i = seq.length - 1; i >= 0 && seq[i]; i--) streak++;

  const weekStart = (d: string) => addDays(d, -iranWeekday(d));
  const thisWeek = weekStart(today);
  const weeks: { week_start: string; attended: number; missed: number; cancelled: number; focus: number }[] = [];
  for (let i = 7; i >= 0; i--) weeks.push({ week_start: addDays(thisWeek, -7 * i), attended: 0, missed: 0, cancelled: 0, focus: 0 });
  const idx = new Map(weeks.map((w, i) => [w.week_start, i]));
  for (const r of rows.results) {
    const i = idx.get(weekStart(r.date));
    if (i === undefined) continue;
    if (r.status === 'attended') weeks[i].attended++;
    else if (r.status === 'cancelled') weeks[i].cancelled++;
    else weeks[i].missed++;
  }
  const focus = await db
    .prepare(`SELECT date, SUM(minutes) AS m FROM focus_sessions GROUP BY date`)
    .all<{ date: string; m: number }>();
  let focusTotal = 0;
  for (const f of focus.results) {
    focusTotal += f.m;
    const i = idx.get(weekStart(f.date));
    if (i !== undefined) weeks[i].focus += f.m;
  }

  const courses = await db
    .prepare(
      `SELECT c.id, c.name, c.color, c.allowed_absences FROM courses c JOIN semesters m ON m.id = c.semester_id
        WHERE c.active = 1 AND m.is_active = 1 AND m.archived_at IS NULL ORDER BY c.id`,
    )
    .all<{ id: number; name: string; color: string; allowed_absences: number }>();
  const perCourse = courses.results.map((c) => {
    const mine = rows.results.filter((r) => r.course_id === c.id);
    const attended = mine.filter((r) => r.status === 'attended').length;
    const skipped = mine.filter((r) => r.status === 'skipped').length;
    const noResp = mine.filter((r) => r.status === 'no_response').length;
    const cancelled = mine.filter((r) => r.status === 'cancelled').length;
    const total = attended + skipped + noResp;
    return {
      id: c.id,
      name: c.name,
      color: c.color,
      allowed_absences: c.allowed_absences,
      attended,
      skipped,
      no_response: noResp,
      cancelled,
      absences: skipped + noResp,
      rate: total === 0 ? null : attended / total,
    };
  });

  const reasons = rows.results
    .filter((r) => r.status === 'skipped' && r.skip_reason)
    .slice(-15)
    .reverse()
    .map((r) => ({ date: r.date, title: r.title, reason: r.skip_reason }));

  // Time per activity (study, work, ...) for the same 8 weeks.
  const cats = await listCategories(db, true);
  const winStart = weeks[0].week_start;
  const sessRows = (
    await db
      .prepare(`SELECT date, category_id, SUM(minutes) AS m, COUNT(*) AS n FROM study_sessions WHERE date >= ?1 GROUP BY date, category_id`)
      .bind(winStart)
      .all<{ date: string; category_id: number; m: number; n: number }>()
  ).results;
  const focusAct = (
    await db
      .prepare(`SELECT date, category_id, SUM(minutes) AS m, COUNT(*) AS n FROM focus_sessions WHERE date >= ?1 GROUP BY date, category_id`)
      .bind(winStart)
      .all<{ date: string; category_id: number; m: number; n: number }>()
  ).results;
  sessRows.push(...focusAct);
  const actWeeks = weeks.map((w) => ({ week_start: w.week_start } as Record<string, number | string>));
  const agg = new Map<number, { total: number; sessions: number; week: number; prev: number }>();
  for (const r of sessRows) {
    const i = idx.get(weekStart(r.date));
    if (i === undefined) continue;
    const key = `c${r.category_id}`;
    actWeeks[i][key] = Number(actWeeks[i][key] ?? 0) + Number(r.m);
    const a = agg.get(r.category_id) ?? { total: 0, sessions: 0, week: 0, prev: 0 };
    a.total += Number(r.m);
    a.sessions += Number(r.n);
    if (i === weeks.length - 1) a.week += Number(r.m);
    if (i === weeks.length - 2) a.prev += Number(r.m);
    agg.set(r.category_id, a);
  }
  const activityCats = cats
    .filter((c) => agg.has(c.id))
    .map((c) => {
      const a = agg.get(c.id)!;
      return {
        id: c.id, title: c.title, icon: c.icon, color: c.color, is_active: c.is_active,
        total_minutes: a.total, week_minutes: a.week, prev_week_minutes: a.prev, sessions: a.sessions,
        daily_goal_minutes: c.daily_goal_minutes, weekly_goal_minutes: c.weekly_goal_minutes,
        avg_minutes: a.sessions ? Math.round(a.total / a.sessions) : 0,
      };
    });
  const activity = { total_minutes: activityCats.reduce((x, c) => x + c.total_minutes, 0), categories: activityCats, weeks: actWeeks };

  return {
    overall: { ...overall, rate: counted === 0 ? null : overall.attended / counted },
    activity,
    body: await bodyStats(db, today),
    streak,
    best_streak: best,
    weeks,
    focus_total: focusTotal,
    per_course: perCourse,
    reasons,
  };
}

// ---------------------------------------------------------------- class actions (same rules as the bot buttons)
const ACTIONS = ['went', 'cancel', 'skip', 'snooze', 'reopen'];

async function occAction(env: Env, id: number, body: Obj, now: number): Promise<Obj> {
  const db = env.DB;
  const occ = await getOcc(db, id);
  if (!occ) throw new ApiError(404, 'این کلاس پیدا نشد');
  const action = String(body.action ?? '');
  if (!ACTIONS.includes(action)) bad('عملیات درست نیست');
  const s = await loadSettings(db);
  const eventData = { title: occ.title, start_ts: occ.start_ts, is_test: occ.is_test };

  if (action === 'went' || action === 'cancel') {
    await db
      .prepare(
        `UPDATE occurrences SET status = ?1, skip_reason = NULL, resolved_at = ?2, awaiting_since = NULL,
                snooze_until = NULL, last_msg_id = NULL, last_msg_kind = NULL WHERE id = ?3`,
      )
      .bind(action === 'went' ? 'attended' : 'cancelled', now, id)
      .run();
    if (action === 'cancel') await emit(db, 'class_cancelled', id, eventData, now);
  } else if (action === 'skip') {
    const reason = str(body.reason, 300, 'دلیل');
    await db
      .prepare(
        `UPDATE occurrences SET status = 'skipped', skip_reason = ?1, resolved_at = ?2, awaiting_since = NULL,
                snooze_until = NULL, last_msg_id = NULL, last_msg_kind = NULL WHERE id = ?3`,
      )
      .bind(reason, now, id)
      .run();
    await emit(db, reason ? 'class_skipped_with_reason' : 'class_skipped_no_reason', id, { ...eventData, reason }, now);
  } else if (action === 'snooze') {
    if (occ.status !== 'upcoming' || occ.next_nag_ts === null || now >= occ.end_ts) {
      bad('الان نمی‌شه عقبش انداخت');
    }
    await db
      .prepare(
        `UPDATE occurrences SET snooze_until = ?1, snooze_count = snooze_count + 1, nag_count = 0,
                last_msg_id = NULL, last_msg_kind = NULL WHERE id = ?2`,
      )
      .bind(now + s.snoozeMin * 60, id)
      .run();
  } else {
    // reopen = undo
    const next = now < occ.end_ts ? 'upcoming' : 'unmarked';
    const nag = next === 'upcoming' && occ.next_nag_ts !== null && now >= occ.start_ts ? now + s.nagIntervalMin * 60 : occ.next_nag_ts;
    await db
      .prepare(
        `UPDATE occurrences SET status = ?1, skip_reason = NULL, resolved_at = NULL, awaiting_since = NULL,
                snooze_until = NULL, next_nag_ts = ?2 WHERE id = ?3`,
      )
      .bind(next, nag, id)
      .run();
  }
  await db.prepare(`DELETE FROM pending_input WHERE ref_id = ?1 AND kind = 'skip_reason'`).bind(id).run();

  // The buttons of the bot message for this class are no longer needed.
  if (action !== 'reopen' && occ.last_msg_id) {
    try {
      await retireMessage({ db, tg: new Telegram(env.BOT_TOKEN), chatId: Number(env.OWNER_ID) }, occ as Occ);
    } catch {
      /* not important */
    }
  }
  const fresh = await getOcc(db, id);
  return { occurrence: fresh };
}

// ---------------------------------------------------------------- settings
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
function csvInts(v: string, min: number, max: number, maxItems: number): string | null {
  const parts = v.split(',').map((x) => x.trim()).filter((x) => x !== '');
  if (parts.length === 0 || parts.length > maxItems) return null;
  const nums = parts.map(Number);
  if (nums.some((n) => !Number.isInteger(n) || n < min || n > max)) return null;
  return [...new Set(nums)].sort((a, b) => b - a).join(',');
}
const SETTING_RULES: Record<string, (v: string) => string | null> = {
  timezone: (v) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: v });
      return v;
    } catch {
      return null;
    }
  },
  offsets: (v) => (v.trim() === '0' ? '0' : csvInts(v, 1, 720, 8)),
  nag_interval_min: (v) => (/^\d+$/.test(v) && +v >= 1 && +v <= 120 ? v : null),
  max_nags: (v) => (/^\d+$/.test(v) && +v >= 1 && +v <= 50 ? v : null),
  snooze_min: (v) => (/^\d+$/.test(v) && +v >= 1 && +v <= 120 ? v : null),
  digits: (v) => (v === 'fa' || v === 'en' ? v : null),
  weekend_days: (v) => (v.trim() === '' ? '' : csvInts(v, 0, 6, 7)?.split(',').reverse().join(',') ?? null),
  lunch_time: (v) => (HHMM.test(v) ? v : null),
  dinner_time: (v) => (HHMM.test(v) ? v : null),
  sleep_time: (v) => (HHMM.test(v) ? v : null),
  wake_time: (v) => (HHMM.test(v) ? v : null),
  vacation: (v) => (v === '0' || v === '1' ? v : null),
  paused_until: (v) => (/^\d{1,12}$/.test(v) ? v : null),
  onboarded: (v) => (v === '0' || v === '1' ? v : null),
  gaps_dismissed: (v) => (v === '0' || v === '1' ? v : null),
  focus_minutes: (v) => (/^\d+$/.test(v) && +v >= 5 && +v <= 120 ? v : null),
  break_minutes: (v) => (/^\d+$/.test(v) && +v >= 1 && +v <= 60 ? v : null),
  weekly_report: (v) => (v === '0' || v === '1' ? v : null),
  weekly_backup: (v) => (v === '0' || v === '1' ? v : null),
  ack_start_notice: (v) => (v === '0' || v === '1' ? v : null),
  setup_done: (v) => (v === '0' || v === '1' ? v : null),
};

async function saveSettings(env: Env, body: Obj, now: number): Promise<void> {
  const stmts: D1PreparedStatement[] = [];
  for (const [k, v] of Object.entries(body)) {
    const rule = SETTING_RULES[k];
    if (!rule) bad(`تنظیم ناشناخته: ${k}`);
    const val = rule(String(v));
    if (val === null) bad('مقدار تنظیم درست نیست');
    stmts.push(
      env.DB
        .prepare(
          `INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)
           ON CONFLICT(key) DO UPDATE SET value = ?2, updated_at = ?3`,
        )
        .bind(k, val, now),
    );
  }
  if (stmts.length > 0) await env.DB.batch(stmts);
}

// ---------------------------------------------------------------- tasks
const REPEAT_DAYS: Record<string, number> = { daily: 1, weekly: 7, monthly: 30 };

async function saveTask(db: D1Database, id: number | null, b: Obj, now: number): Promise<number> {
  if (id !== null) {
    const row = await db.prepare(`SELECT * FROM tasks WHERE id = ?1 AND deleted_at IS NULL`).bind(id).first<Obj>();
    if (!row) throw new ApiError(404, 'این کار پیدا نشد');
    if (b.done !== undefined && Object.keys(b).length === 1) {
      const done = b.done ? 1 : 0;
      await db.prepare(`UPDATE tasks SET done = ?1, done_at = ?2 WHERE id = ?3`).bind(done, done ? now : null, id).run();
      // A repeating task that was just finished comes back with the next due date.
      const days = typeof row.repeat === 'string' ? REPEAT_DAYS[row.repeat] : undefined;
      if (done && !row.done && days) {
        const s = await loadSettings(db);
        const today = localDate(now, s.timezone);
        const base = typeof row.due_date === 'string' && row.due_date ? (row.due_date as string) : today;
        let next = addDays(base, days);
        while (next <= today) next = addDays(next, days); // never create something that is already overdue
        // Un-doing and re-doing must not create a second copy: skip it if the same next task already exists.
        const exists = await db
          .prepare(`SELECT 1 AS x FROM tasks WHERE title = ?1 AND repeat = ?2 AND due_date = ?3 AND deleted_at IS NULL LIMIT 1`)
          .bind(row.title, row.repeat, next)
          .first();
        if (!exists) {
          await db
            .prepare(`INSERT INTO tasks (title, course_id, due_date, due_time, priority, notes, category_id, estimate_min, repeat) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`)
            .bind(row.title, row.course_id, next, row.due_time, row.priority, row.notes, row.category_id, row.estimate_min, row.repeat)
            .run();
        }
      }
      return id;
    }
  }
  const title = str(b.title, 200, 'عنوان کار', true) as string;
  const courseId = b.course_id === null || b.course_id === undefined || b.course_id === '' ? null : intIn(b.course_id, 1, 1e9, 'درس');
  const categoryId = b.category_id === null || b.category_id === undefined || b.category_id === '' ? null : intIn(b.category_id, 1, 1e9, 'دسته');
  if (categoryId !== null && !(await db.prepare(`SELECT id FROM categories WHERE id = ?1`).bind(categoryId).first())) bad('این دسته وجود نداره');
  const estimate = b.estimate_min === null || b.estimate_min === undefined || b.estimate_min === '' || Number(b.estimate_min) === 0 ? null : intIn(b.estimate_min, 5, 6000, 'تخمین زمان');
  const repeat = b.repeat === null || b.repeat === undefined || b.repeat === '' ? null : String(b.repeat);
  if (repeat !== null && !(repeat in REPEAT_DAYS)) bad('نوع تکرار درست نیست');
  const dueDate = isoDate(b.due_date, 'موعد');
  if (repeat !== null && !dueDate) bad('برای کار تکراری یه موعد لازمه');
  const dueTime = dueDate ? hhmm(b.due_time, 'ساعت موعد') : null;
  const priority = intIn(b.priority, 0, 2, 'اولویت') ?? 1;
  const notes = str(b.notes, 500, 'یادداشت');
  if (id === null) {
    const r = await db
      .prepare(`INSERT INTO tasks (title, course_id, due_date, due_time, priority, notes, category_id, estimate_min, repeat) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`)
      .bind(title, courseId, dueDate, dueTime, priority, notes, categoryId, estimate, repeat)
      .run();
    return Number(r.meta.last_row_id);
  }
  await db
    .prepare(`UPDATE tasks SET title = ?1, course_id = ?2, due_date = ?3, due_time = ?4, priority = ?5, notes = ?6, category_id = ?7, estimate_min = ?8, repeat = ?9 WHERE id = ?10`)
    .bind(title, courseId, dueDate, dueTime, priority, notes, categoryId, estimate, repeat, id)
    .run();
  return id;
}

// ---------------------------------------------------------------- router
async function readBody(request: Request): Promise<Obj> {
  const text = await request.text();
  if (text.length > 65536) throw new ApiError(413, 'درخواست خیلی بزرگه');
  if (text.trim() === '') return {};
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {};
  } catch {
    throw new ApiError(400, 'درخواست درست نیست');
  }
}

export async function handleApi(request: Request, env: Env): Promise<Response> {
  try {
    const now = Math.floor(Date.now() / 1000);
    const auth = request.headers.get('Authorization') ?? '';
    if (!auth.startsWith('tma ')) throw new ApiError(401, 'لطفاً برنامه رو از داخل تلگرام باز کن.');
    const user = await verifyInitData(auth.slice(4), env.BOT_TOKEN, now);
    if (!user) throw new ApiError(401, 'نشست منقضی شده؛ برنامه رو دوباره از تلگرام باز کن.');
    // The owner can do everything. The connected partner (Phase 2) only gets the message-templates screen.
    let role: Role = 'owner';
    if (String(user.id) !== String(env.OWNER_ID).trim()) {
      const partner = await getPartner(env.DB);
      if (partner.chat_id === null || partner.chat_id !== String(user.id)) throw new ApiError(403, 'دسترسی نداری.');
      role = 'partner';
    }

    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean).slice(1); // drop "api"
    const method = request.method;
    const db = env.DB;
    const body = method === 'POST' || method === 'PUT' ? await readBody(request) : {};
    const idOf = (p: string | undefined): number => {
      const n = Number(p);
      if (!Number.isInteger(n) || n <= 0) throw new ApiError(404, 'پیدا نشد');
      return n;
    };
    const route = `${method} ${parts[0] ?? ''}${parts[1] !== undefined ? '/:id' : ''}${parts[2] ? '/' + parts[2] : ''}`;

    const phase2 = await routePhase2({ env, now, role, method, parts, body });
    if (phase2) return json(phase2.data, phase2.status ?? 200);
    if (role === 'partner') {
      if (route !== 'GET state') throw new ApiError(403, 'دسترسی نداری.');
      return json(await partnerShell(env, now));
    }

    switch (route) {
      case 'GET state':
        return json(await buildState(env, now));
      case 'GET stats':
        return json(await buildStats(env, now));

      case 'POST occ/:id':
        return json(await occAction(env, idOf(parts[1]), body, now));

      case 'POST courses': {
        const c = parseCourse(body);
        const id = await saveCourse(db, null, c, now);
        return json({ id }, 201);
      }
      case 'PUT courses/:id': {
        const id = idOf(parts[1]);
        const exists = await db.prepare(`SELECT id FROM courses WHERE id = ?1`).bind(id).first();
        if (!exists) throw new ApiError(404, 'این درس پیدا نشد');
        await saveCourse(db, id, parseCourse(body), now);
        return json({ id });
      }
      case 'DELETE courses/:id': {
        const id = idOf(parts[1]);
        await db.prepare(`UPDATE courses SET active = 0 WHERE id = ?1`).bind(id).run();
        await dropFutureUnannounced(db, id, now);
        return json({ ok: true });
      }
      case 'POST courses/:id/restore': {
        await db.prepare(`UPDATE courses SET active = 1 WHERE id = ?1`).bind(idOf(parts[1])).run();
        return json({ ok: true });
      }

      case 'PUT settings':
        await saveSettings(env, body, now);
        return json({ settings: await loadRawSettings(db) });

      case 'POST tasks':
        return json({ id: await saveTask(db, null, body, now) }, 201);
      case 'PUT tasks/:id':
        return json({ id: await saveTask(db, idOf(parts[1]), body, now) });
      case 'DELETE tasks/:id':
        await db.prepare(`UPDATE tasks SET deleted_at = ?1 WHERE id = ?2`).bind(now, idOf(parts[1])).run();
        return json({ ok: true });
      case 'POST tasks/:id/restore':
        await db.prepare(`UPDATE tasks SET deleted_at = NULL WHERE id = ?1`).bind(idOf(parts[1])).run();
        return json({ ok: true });

      case 'POST focus': {
        const minutes = intIn(body.minutes, 1, 180, 'مدت');
        if (minutes === null) bad('مدت لازمه');
        const courseId = body.course_id ? intIn(body.course_id, 1, 1e9, 'درس') : null;
        const s = await loadSettings(db);
        const categoryId = await resolveCategoryId(db, body.category_id);
        // The app may send the real start (a session that finished while the phone was offline); otherwise it is "now minus the length".
        const claimed = Number(body.started_at);
        const startedAt =
          Number.isFinite(claimed) && claimed >= now - 3 * 86400 && claimed <= now - (minutes as number) * 60 + 300 ? Math.floor(claimed) : now - (minutes as number) * 60;
        await db
          .prepare(`INSERT INTO focus_sessions (course_id, minutes, started_at, date, category_id) VALUES (?1, ?2, ?3, ?4, ?5)`)
          .bind(courseId, minutes, startedAt, localDate(startedAt, s.timezone), categoryId)
          .run();
        return json({ ok: true, unlocked: await evaluateAchievements(db, s, now) }, 201);
      }

      case 'GET texts': {
        const rows = await db.prepare(`SELECT key, text, description FROM bot_texts ORDER BY key`).all<Obj>();
        return json({ texts: rows.results });
      }
      case 'PUT texts/:id': {
        const key = decodeURIComponent(parts[1] ?? '');
        const text = str(body.text, 2000, 'متن', true) as string;
        const htmlError = key.startsWith('btn_') ? null : validateTelegramHtml(text);
        if (htmlError) throw new ApiError(400, htmlError);
        const r = await db.prepare(`UPDATE bot_texts SET text = ?1 WHERE key = ?2`).bind(text, key).run();
        if ((r.meta.changes ?? 0) === 0) throw new ApiError(404, 'این متن پیدا نشد');
        return json({ ok: true });
      }

      default:
        throw new ApiError(404, 'پیدا نشد');
    }
  } catch (e) {
    if (e instanceof ApiError) return json({ error: e.message }, e.status);
    console.error('api error', e instanceof Error ? e.message : String(e));
    return json({ error: 'خطای سرور؛ چند لحظه دیگه دوباره امتحان کن.' }, 500);
  }
}

