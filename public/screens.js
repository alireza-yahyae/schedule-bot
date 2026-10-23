// The five main screens.

import {
  MONTHS, WEEKDAYS, WEEKDAYS_SHORT, absenceLevel, addDays, clip, clock, dayProgress, daysBetween, findNextUp, humanDuration, hmOf, isoToJalali,
  jalaliSlash, jalaliText, layoutWeek, percent, relativeDays, sortTasks, toMin, weekdayOf,
} from './lib.js';
import { emptyState, errorToast, h, haptic, icon, ring, segmented, selectEl, stepper, switchEl, textInput, toast } from './ui.js';
import { D, S, act, api, getFocus, hm, hooks, nowSec, onLongPress, refresh, saveSetting } from './core.js';
import { openActivityExports, openPasteSchedule, openScheduleExports } from './exports.js';
import { dayPlanCard, openDayPlanSheet, quietBanner } from './dayplan.js';
import { bodyCard, challengeCard, fmtMinutes, greetingFor, softItems, softRow, startTaskTimer, studyCard } from './daily.js';
import {
  GAP_ITEMS, openActionSheet, openCourseDetail, openCourseForm, openFocus, openSkipSheet, openTaskForm, openTextsEditor, openTutorial,
  timezoneOptions,
} from './forms.js';

const span = (...kids) => h('span', null, ...kids);
const hdr = (title, sub) => h('div', { class: 'hdr' }, h('h1', null, title), sub ? h('div', { class: 'sub' }, sub) : null);
const fab = (label, onClick) => h('button', { class: 'fab', 'aria-label': label, onClick: () => { haptic('light'); onClick(); } }, icon('plus', 26));
const offlineBanner = () => (S.offline ? h('div', { class: 'banner' }, icon('alert', 18), 'آفلاینی؛ آخرین اطلاعات ذخیره‌شده رو می‌بینی.') : null);

// ====================================================================== TODAY
export function viewToday() {
  const d = S.data;
  const now = nowSec();
  const todayOcc = d.occurrences.filter((o) => o.date === d.date);
  const tomorrowOcc = d.occurrences.filter((o) => o.date !== d.date);
  const name = S.user && S.user.first_name;
  return h(
    'div',
    { class: 'screen' },
    offlineBanner(),
    todayHeader(d, now, name),
    pauseBanner(now),
    quietBanner(now),
    heroCard(todayOcc, tomorrowOcc, now),
    studyCard(),
    challengeCard(),
    bodyCard(),
    h('div', { class: 'section-title' }, h('span', null, 'برنامه‌ی امروز')),
    todayTimeline(todayOcc, now),
    tasksPreview(),
    focusCard(),
  );
}

function todayHeader(d, now, name) {
  const [greet, emoji] = greetingFor(now);
  const plan = d.today_plan;
  const special = plan && (plan.source !== 'default' || plan.quiet_mode !== 'none');
  return h(
    'div',
    { class: 'hdr hdr-row' },
    h('div', { class: 'grow' }, h('div', { class: 'eyebrow-date' }, `${WEEKDAYS[weekdayOf(d.date)]} ${jalaliText(d.date, D)}`), h('h1', null, name ? `${greet} ${name} ${emoji}` : `${greet} ${emoji}`)),
    h('button', { class: 'hdr-btn' + (special ? ' on' : ''), 'aria-label': 'خاموشی و برنامه‌ی ویژه‌ی امروز', onClick: () => openDayPlanSheet({ scope: 'today', quiet: 'window' }) }, icon('moon', 22)),
  );
}

function pauseBanner(now) {
  const s = S.data.settings;
  if (s.vacation === '1') {
    return h('div', { class: 'banner' }, icon('moon', 18), h('span', { class: 'grow' }, 'حالت تعطیلات روشنه؛ هیچ یادآوری‌ای نمیاد.'), h('button', { class: 'btn sm soft', onClick: () => saveSetting({ vacation: '0' }, { rerender: true }) }, 'خاموش کن'));
  }
  const until = Number(s.paused_until || 0);
  if (until > now) {
    return h('div', { class: 'banner' }, icon('pause', 18), h('span', { class: 'grow' }, `یادآوری‌ها تا ساعت ${hm(until)} متوقفه.`), h('button', { class: 'btn sm soft', onClick: () => saveSetting({ paused_until: '0' }, { rerender: true }) }, 'ادامه'));
  }
  return null;
}

function heroCard(todayOcc, tomorrowOcc, now) {
  const d = S.data;
  const next = findNextUp(d.occurrences, now);
  const prog = dayProgress(todayOcc, now);
  const dayRing = prog.total
    ? ring({ value: prog.done / prog.total, size: 70, stroke: 7, color: '#fff', track: 'rgba(255,255,255,0.28)', label: `${D(prog.done)}/${D(prog.total)}`, sub: 'امروز' })
    : null;

  if (next) {
    const running = next.start_ts <= now;
    const target = running ? next.end_ts : next.start_ts;
    const near = next.start_ts - now <= 1800;
    const btn = (label, cls, fn) => h('button', { class: 'hbtn ' + cls, onClick: fn }, label);
    const buttons = [];
    if (near) buttons.push(btn('✅ رفتم', 'main', () => act(next, 'went')));
    buttons.push(btn('🚫 برگزار نشد', '', () => act(next, 'cancel')), btn('❌ نمی‌رم', '', () => openSkipSheet(next)));
    return h(
      'section',
      { class: 'hero' },
      h(
        'div',
        { class: 'row between' },
        h(
          'div',
          { class: 'grow' },
          h('div', { class: 'eyebrow' }, running ? '🔴 در حال برگزاری' : `⏭ کلاس بعدی • ${next.date === d.date ? 'امروز' : 'فردا'}`),
          h('div', { class: 'title' }, next.title),
          h('div', { class: 'meta' }, span(icon('clock', 14), `${hm(next.start_ts)} تا ${hm(next.end_ts)}`), next.location ? span(icon('pin', 14), next.location) : null),
        ),
        dayRing,
      ),
      h('div', { class: 'count num', 'data-cd': target }, clock(target - now, D)),
      h('div', { class: 'count-label' }, running ? 'تا پایان کلاس' : 'تا شروع کلاس'),
      h('div', { class: 'actions', style: { gridTemplateColumns: near ? '1.3fr 1fr 1fr' : '1fr 1fr' } }, buttons),
    );
  }

  const tomorrowFirst = tomorrowOcc.find((o) => !o.is_test);
  const attended = todayOcc.filter((o) => o.status === 'attended').length;
  const title = prog.total ? `امروز تموم شد 🎉` : 'امروز کلاسی نداری 🎉';
  const sub = prog.total ? `${D(attended)} برنامه از ${D(prog.total)} رو انجام دادی` : 'وقت خوبیه برای درس خوندن یا استراحت';
  return h(
    'section',
    { class: 'hero calm' },
    h('div', { class: 'row between' }, h('div', { class: 'grow' }, h('div', { class: 'eyebrow' }, 'امروز'), h('div', { class: 'title' }, title), h('div', { class: 'meta' }, span(sub))), dayRing),
    tomorrowFirst ? h('div', { class: 'count-label mt' }, `فردا اولین کلاس: ${tomorrowFirst.title} ساعت ${hm(tomorrowFirst.start_ts)}`) : null,
    h('div', { class: 'actions', style: { gridTemplateColumns: '1fr' } }, h('button', { class: 'hbtn main', onClick: openFocus }, icon('play', 16), 'شروع تمرکز')),
  );
}

/** A small, closed-by-default reminder of what could not be read from the university file (lives in Settings now). */
function gapsCompact() {
  if (S.data.settings.gaps_dismissed === '1') return null;
  const open = !!S.gapsOpen;
  return h(
    'section',
    { class: 'card compact' },
    h('button', { class: 'compact-head', onClick: () => { S.gapsOpen = !open; hooks.render(); } }, h('span', null, '🧩 برنامه‌ات کامله؟'), h('span', { class: 'muted xs' }, open ? 'بستن' : 'ببین')),
    open
      ? h(
          'div',
          { class: 'mt' },
          h('div', { class: 'small muted' }, 'این چیزها از فایل دانشگاه بریده شده بود و حدس نمی‌زنم:'),
          h('ul', { class: 'plain small gaps mt' }, GAP_ITEMS.map((t) => h('li', null, t))),
          h(
            'div',
            { class: 'row wrap gap-s mt' },
            h('button', { class: 'btn soft sm', onClick: () => openCourseForm(null) }, icon('plus', 16), 'افزودن درس'),
          h('button', { class: 'btn soft sm', onClick: () => openCourseForm(null, { kind: 'work' }) }, icon('plus', 16), 'برنامه‌ی کاری'),
            h('button', { class: 'btn soft sm', onClick: () => hooks.go('week', 'courses') }, 'ویرایش درس‌ها'),
            h('button', { class: 'btn ghost sm', onClick: () => saveSetting({ gaps_dismissed: '1' }, { rerender: true }) }, 'دیگه نشون نده'),
          ),
        )
      : null,
  );
}

const STATUS_CHIP = {
  attended: ['ok', '✅ رفتم'],
  cancelled: ['warn', '🚫 برگزار نشد'],
  skipped: ['bad', '❌ نرفتم'],
  no_response: ['bad', '⚠️ بدون پاسخ'],
  unmarked: ['', 'ثبت نشده'],
  awaiting_reason: ['warn', '✍️ منتظر دلیل'],
};

function minuteOfDay(ts) {
  return toMin(hmOf(ts, S.data.tz));
}

function todayTimeline(todayOcc, now) {
  const items = todayOcc.map((o) => ({ min: minuteOfDay(o.start_ts), o }));
  items.push(...softItems()); // wake first, meals you can tick, sleep always last
  items.sort((a, b) => a.min - b.min);
  return h(
    'div',
    { class: 'timeline' },
    todayOcc.length === 0 ? h('div', { class: 'tl-empty' }, '🎉 امروز کلاسی نداری') : null,
    items.map((it) => (it.soft ? softRow(it.soft) : occRow(it.o, now))),
  );
}

function occRow(o, now) {
  const final = ['attended', 'cancelled', 'skipped'].includes(o.status);
  const open = !final;
  const running = open && o.start_ts <= now && now < o.end_ts;
  const past = o.end_ts <= now;
  let chip;
  if (STATUS_CHIP[o.status] && o.status !== 'upcoming') chip = h('span', { class: 'chip ' + STATUS_CHIP[o.status][0] }, STATUS_CHIP[o.status][1]);
  else if (running) chip = h('span', { class: 'chip info' }, '🔴 در حال برگزاری');
  else chip = h('span', { class: 'chip' }, `تا ${humanDuration(Math.max(0, o.start_ts - now), D)} دیگه`);

  const near = o.start_ts - now <= 1800;
  let actions = null;
  if (open && !past) {
    const b = (cls, label, fn) => h('button', { class: cls, onClick: fn }, label);
    const list = [];
    if (near) list.push(b('a-went', '✅ رفتم', () => act(o, 'went')));
    list.push(b('a-cancel', '🚫 برگزار نشد', () => act(o, 'cancel')), b('a-skip', '❌ نمی‌رم', () => openSkipSheet(o)));
    actions = h('div', { class: 'tl-actions', style: { gridTemplateColumns: near ? '1.2fr 1fr 1fr' : '1fr 1fr' } }, list);
  } else if (open && past) {
    actions = h('div', { class: 'tl-actions', style: { gridTemplateColumns: '1fr' } }, h('button', { class: 'a-went', onClick: () => openActionSheet(o) }, 'ثبت وضعیت'));
  } else {
    actions = h('div', { class: 'row between', style: { marginTop: '6px' } }, h('span', { class: 'small muted' }, o.skip_reason ? `دلیل: ${o.skip_reason}` : ''), h('button', { class: 'btn ghost sm', onClick: () => openActionSheet(o) }, 'تغییر'));
  }

  return h(
    'div',
    { class: 'tl-item', style: { '--c': o.color || '#4F8CFF' } },
    h('div', { class: 'tl-time' }, h('b', null, hm(o.start_ts)), hm(o.end_ts)),
    h('div', { class: 'tl-rail' }, h('span', { class: 'tl-dot' })),
    h(
      'div',
      { class: 'tl-body' },
      h(
        'div',
        { class: 'tl-card' + (final || past ? ' dim' : '') + (running ? ' now' : '') },
        h('div', { class: 'row between' }, h('div', { class: 'tl-title grow' }, (o.is_test ? '🧪 ' : '') + o.title), chip),
        h('div', { class: 'tl-meta' }, o.location ? span(icon('pin', 14), o.location) : null, span(icon('clock', 14), humanDuration(o.end_ts - o.start_ts, D))),
        actions,
      ),
    ),
  );
}

function dueChip(t) {
  if (!t.due_date) return null;
  const left = daysBetween(S.data.date, t.due_date);
  const cls = t.done ? '' : left < 0 ? 'bad' : left <= 1 ? 'warn' : 'info';
  return h('span', { class: 'chip ' + cls }, `${relativeDays(left, D)}${t.due_time ? ' • ' + D(t.due_time) : ''}`);
}

async function toggleTask(t) {
  haptic(t.done ? 'light' : 'success');
  try {
    await api('PUT', `/tasks/${t.id}`, { done: !t.done });
    await refresh();
  } catch (e) {
    errorToast(e);
  }
}

function taskRow(t) {
  return h(
    'div',
    { class: 'task' + (t.done ? ' done' : '') },
    h('button', { class: 'check' + (t.done ? ' on' : ''), 'aria-label': 'انجام شد', onClick: () => toggleTask(t) }, icon('check', 16)),
    h('div', { class: 'prio p' + (t.priority ?? 1) }),
    h(
      'button',
      { class: 'grow', style: { textAlign: 'start' }, onClick: () => openTaskForm(t) },
      h('div', { class: 'task-title bold' }, t.title),
      h('div', { class: 'row gap-s wrap' }, dueChip(t), t.course_id ? h('span', { class: 'xs muted' }, courseName(t.course_id)) : null, taskCategoryChip(t), taskTimeChip(t), t.repeat ? h('span', { class: 'xs muted' }, '🔁') : null),
    ),
    t.done ? null : h('button', { class: 'icon-btn', 'aria-label': 'شروع تایمر روی این کار', onClick: () => startTaskTimer(t) }, icon('play', 18)),
  );
}
/** The category of a task as a small colored chip. */
function taskCategoryChip(t) {
  const cats = (S.data.study && S.data.study.categories) || [];
  const c = t.category_id ? cats.find((x) => x.id === t.category_id) : null;
  return c ? h('span', { class: 'cat-sum' }, h('i', { style: { background: c.color } }), `${c.icon} ${c.title}`) : null;
}
/** Time spent on a task, next to its estimate: «۱:۱۵ از ۲ ساعت». */
function taskTimeChip(t) {
  if (!t.spent_min && !t.estimate_min) return null;
  const over = t.estimate_min && t.spent_min > t.estimate_min;
  const text = t.estimate_min ? `⏱ ${fmtMinutes(t.spent_min || 0)} از ${fmtMinutes(t.estimate_min)}` : `⏱ ${fmtMinutes(t.spent_min)}`;
  return h('span', { class: 'xs ' + (over ? 'bad-text' : 'muted') }, text);
}
const courseName = (id) => {
  const c = S.data.courses.find((x) => x.id === id);
  return c ? c.name : '';
};

function tasksPreview() {
  const open = sortTasks(S.data.tasks.filter((t) => !t.done)).slice(0, 3);
  if (open.length === 0) return null;
  return h(
    'section',
    { class: 'card' },
    h('div', { class: 'row between' }, h('b', null, '📝 کارهای نزدیک'), h('button', { class: 'btn ghost sm', onClick: () => hooks.go('week', 'tasks') }, 'همه')),
    h('div', { class: 'list mt' }, open.map(taskRow)),
  );
}

function focusCard() {
  const f = getFocus();
  const minutes = Number(S.data.settings.focus_minutes || 25);
  const left = f ? Math.max(0, f.minutes * 60 - (Date.now() - f.start) / 1000) : 0;
  return h(
    'section',
    { class: 'card row' },
    h('div', { class: 'exam-days', style: { width: '52px', height: '52px', borderRadius: '16px' } }, icon('clock', 24)),
    h('div', { class: 'grow' }, h('b', null, f ? 'در حال تمرکز…' : 'تمرکز (پومودورو)'), h('div', { class: 'small muted' }, f ? `${clock(left, D)} مونده` : `${D(minutes)} دقیقه تمرکز کامل، بدون حواس‌پرتی`)),
    h('button', { class: 'btn primary sm', onClick: openFocus }, f ? 'نمایش' : 'شروع'),
  );
}

// ====================================================================== WEEK
export function viewWeek() {
  const seg = segmented(
    [{ value: 'grid', label: 'هفته' }, { value: 'courses', label: 'درس‌ها' }, { value: 'exams', label: 'امتحان‌ها' }, { value: 'tasks', label: 'کارها' }],
    S.weekSeg,
    (v) => { S.weekSeg = v; hooks.render(); },
  );
  const content = { grid: weekGrid, courses: coursesList, exams: examsList, tasks: tasksList }[S.weekSeg]();
  const action = S.weekSeg === 'tasks' ? fab('کار جدید', () => openTaskForm(null)) : S.weekSeg === 'exams' ? null : fab('درس جدید', () => openCourseForm(null));
  const tools = S.weekSeg === 'grid' || S.weekSeg === 'courses'
    ? h('div', { class: 'tools' }, h('button', { class: 'btn soft sm', onClick: () => openPasteSchedule() }, icon('list', 16), 'با هوش مصنوعی / چسباندن'), h('button', { class: 'btn soft sm', onClick: openScheduleExports }, icon('calendar', 16), 'خروجی / تقویم'))
    : null;
  return h('div', { class: 'screen' }, offlineBanner(), hdr('برنامه'), seg.el, tools, content, action);
}

function weekGrid() {
  const d = S.data;
  const lay = layoutWeek(d.courses);
  const HOUR = 64;
  const rows = lay.endHour - lay.startHour;
  const todayWd = weekdayOf(d.date);
  const weekStart = addDays(d.date, -todayWd);

  const cells = [h('div', { class: 'wg-head' }, '')];
  for (let wd = 0; wd < 7; wd++) {
    const iso = addDays(weekStart, wd);
    const [, jm, jd] = isoToJalali(iso);
    cells.push(h('div', { class: 'wg-head' + (wd === todayWd ? ' today' : '') }, WEEKDAYS[wd], h('small', null, `${D(jd)} ${MONTHS[jm - 1]}`)));
  }
  const times = h('div', { class: 'wg-times', style: { height: rows * HOUR + 'px' } });
  for (let k = 0; k <= rows; k++) times.append(h('span', { style: { top: k * HOUR + 'px' } }, D(`${String(lay.startHour + k).padStart(2, '0')}:00`)));
  cells.push(times);

  for (let wd = 0; wd < 7; wd++) {
    const col = h('div', { class: 'wg-day' + (wd === todayWd ? ' today' : ''), style: { height: rows * HOUR + 'px' } });
    for (const b of lay.days[wd]) {
      const height = Math.max(34, (b.height / 60) * HOUR - 3);
      const el = h(
        'button',
        { class: 'wblock' + (b.conflict ? ' conflict' : ''), style: { '--c': b.color, top: (b.top / 60) * HOUR + 1 + 'px', height: height + 'px' }, onClick: () => openCourseDetail(b.courseId) },
        b.conflict ? h('span', { class: 'warn-badge' }, icon('alert', 14)) : null,
        h('b', null, clip(b.name, height > 70 ? 34 : 20)),
        h('span', { class: 'num' }, `${D(b.start)} تا ${D(b.end)}`),
        height > 80 && b.location ? h('div', { class: 'ellipsis' }, b.location) : null,
      );
      onLongPress(el, () => { const c = d.courses.find((x) => x.id === b.courseId); if (c) openCourseForm(c); });
      col.append(el);
    }
    cells.push(col);
  }

  const out = [];
  if (d.courses.length === 0) {
    out.push(h('div', { class: 'card' }, emptyState({ emoji: '🗓', title: 'هنوز درسی نداری', text: 'با دکمه‌ی + اولین درست رو اضافه کن.' })));
    return h('div', { class: 'list' }, out);
  }
  out.push(h('div', { class: 'wgrid-scroll' }, h('div', { class: 'wgrid', style: { '--hour': HOUR + 'px' } }, cells)));
  out.push(h('div', { class: 'legend' }, icon('pin', 14), 'روی درس بزن برای جزئیات • نگه دار برای ویرایش • ⚠️ = تداخل'));
  for (const c of d.conflicts) {
    out.push(h('div', { class: 'banner' }, icon('alert', 18), `تداخل ${WEEKDAYS[c.weekday]}: «${c.a.name}» (${D(c.a.start)}–${D(c.a.end)}) با «${c.b.name}» (${D(c.b.start)}–${D(c.b.end)})`));
  }
  return h('div', { class: 'list' }, out);
}

function sessionsSummary(c) {
  if (!c.sessions.length) return 'جلسه‌ای ثبت نشده';
  return c.sessions.map((s) => `${WEEKDAYS[s.weekday]} ${D(s.start_time)}`).join(' • ');
}

function coursesList() {
  const d = S.data;
  if (d.courses.length === 0) return h('div', { class: 'card' }, emptyState({ emoji: '📚', title: 'هنوز درسی نداری', text: 'با دکمه‌ی + اولین درست رو اضافه کن.' }));
  return h(
    'div',
    { class: 'list' },
    d.courses.map((c) => {
      const counts = c.counts || {};
      const absences = (counts.skipped || 0) + (counts.no_response || 0);
      const level = absenceLevel(absences, c.allowed_absences ?? 3);
      const examLeft = c.exam_date ? daysBetween(d.date, c.exam_date) : null;
      const el = h(
        'button',
        { class: 'card course', style: { '--c': c.color, textAlign: 'start', width: '100%' }, onClick: () => openCourseDetail(c.id) },
        h('div', { class: 'bar' }),
        h(
          'div',
          { class: 'grow' },
          h('div', { class: 'row between' }, h('div', { class: 'title' }, (c.kind === 'work' ? '💼 ' : '') + c.name), c.units ? h('span', { class: 'chip' }, `${D(c.units)} واحد`) : null),
          h('div', { class: 'kv' }, c.group_no ? span(`گروه ${D(c.group_no)}`) : null, c.teacher ? span(icon('user', 14), c.teacher) : null, c.location ? span(icon('pin', 14), c.location) : null),
          h('div', { class: 'small muted' }, sessionsSummary(c)),
          h(
            'div',
            { class: 'row wrap gap-s mt' },
            examLeft !== null ? h('span', { class: 'chip ' + (examLeft < 0 ? '' : examLeft <= 7 ? 'bad' : 'info') }, examLeft < 0 ? '🗓 امتحان گذشته' : `🗓 امتحان ${relativeDays(examLeft, D)}`) : null,
            c.kind !== 'work' && (absences > 0 || level !== 'ok') ? h('span', { class: 'chip ' + (level === 'ok' ? '' : level === 'warn' ? 'warn' : 'bad') }, `غیبت ${D(absences)} از ${D(c.allowed_absences ?? 3)}`) : null,
          ),
        ),
      );
      onLongPress(el, () => openCourseForm(c));
      return el;
    }),
  );
}

function examsList() {
  const d = S.data;
  const exams = d.courses.filter((c) => c.exam_date).sort((a, b) => (a.exam_date < b.exam_date ? -1 : 1));
  if (exams.length === 0) return h('div', { class: 'card' }, emptyState({ emoji: '🗓', title: 'امتحانی ثبت نشده', text: 'توی فرم هر درس می‌تونی تاریخ امتحانش رو بذاری.' }));
  const upcoming = exams.filter((c) => daysBetween(d.date, c.exam_date) >= 0);
  const nearest = upcoming[0];
  const out = [];
  if (nearest) {
    const left = daysBetween(d.date, nearest.exam_date);
    out.push(
      h(
        'section',
        { class: 'hero' },
        h('div', { class: 'eyebrow' }, '🎯 نزدیک‌ترین امتحان'),
        h('div', { class: 'title' }, nearest.name),
        h('div', { class: 'count num' }, left === 0 ? 'امروزه!' : `${D(left)} روز`),
        h('div', { class: 'count-label' }, `${WEEKDAYS[weekdayOf(nearest.exam_date)]} ${jalaliText(nearest.exam_date, D)}${nearest.exam_start ? ' • ساعت ' + D(nearest.exam_start) : ''}`),
      ),
    );
  }
  out.push(
    ...exams.map((c) => {
      const left = daysBetween(d.date, c.exam_date);
      const cls = left < 0 ? 'past' : left <= 7 ? 'soon' : '';
      return h(
        'button',
        { class: 'card exam-row', style: { textAlign: 'start', width: '100%' }, onClick: () => openCourseDetail(c.id) },
        h('div', { class: 'exam-days ' + cls }, h('b', null, left < 0 ? '—' : D(left)), h('span', null, left < 0 ? 'گذشته' : left === 0 ? 'امروز' : 'روز')),
        h(
          'div',
          { class: 'grow' },
          h('div', { class: 'bold' }, c.name),
          h('div', { class: 'small muted' }, `${WEEKDAYS[weekdayOf(c.exam_date)]} ${jalaliText(c.exam_date, D)}`),
          h('div', { class: 'xs muted' }, `${c.exam_start ? 'ساعت ' + D(c.exam_start) + (c.exam_end ? ' تا ' + D(c.exam_end) : '') : ''}${c.exam_location ? ' • ' + c.exam_location : ''}`),
        ),
      );
    }),
  );
  return h('div', { class: 'list' }, out);
}

function tasksList() {
  const d = S.data;
  const tasks = sortTasks(d.tasks);
  if (tasks.length === 0) return h('div', { class: 'card' }, emptyState({ emoji: '✅', title: 'کاری نداری', text: 'تمرین‌ها و موعدهات رو با دکمه‌ی + اضافه کن.' }));
  const open = tasks.filter((t) => !t.done);
  const done = tasks.filter((t) => t.done);
  const overdue = open.filter((t) => t.due_date && t.due_date < d.date);
  const rest = open.filter((t) => !overdue.includes(t));
  const group = (title, list) => (list.length ? [h('div', { class: 'section-title' }, h('span', null, title)), h('div', { class: 'card tight list' }, list.map(taskRow))] : []);
  return h('div', { class: 'list' }, group('⚠️ عقب‌افتاده', overdue), group('پیش‌رو', rest), group('انجام‌شده (۳ روز اخیر)', done));
}

// ====================================================================== STATS
export function viewStats() {
  if (!S.stats && !S.statsLoading) {
    S.statsLoading = true;
    S.statsError = null;
    api('GET', '/stats')
      .then((r) => { S.stats = r; })
      .catch((e) => { S.statsError = e.message; })
      .finally(() => { S.statsLoading = false; if (S.tab === 'stats') hooks.render(); });
  }
  if (!S.stats) {
    if (S.statsError) {
      return h('div', { class: 'screen' }, hdr('آمار'), h('div', { class: 'card' }, emptyState({ emoji: '😕', title: 'آمار بارگذاری نشد', text: S.statsError, action: h('button', { class: 'btn soft', onClick: () => { S.statsError = null; hooks.render(); } }, 'تلاش دوباره') })));
    }
    return h('div', { class: 'screen' }, hdr('آمار'), h('div', { class: 'skeleton-wrap' }, h('div', { class: 'skeleton', style: { height: '140px' } }), h('div', { class: 'skeleton', style: { height: '90px' } }), h('div', { class: 'skeleton', style: { height: '160px' } })));
  }
  const st = S.stats;
  const o = st.overall;
  const rate = percent(o.rate);
  const total = o.attended + o.skipped + o.no_response;
  if (total === 0 && o.cancelled === 0 && st.focus_total === 0 && !(st.activity && st.activity.total_minutes)) {
    return h('div', { class: 'screen' }, offlineBanner(), hdr('آمار'), h('div', { class: 'card' }, emptyState({ emoji: '📊', title: 'هنوز آماری نیست', text: 'بعد از اینکه برای چند کلاس «رفتم» یا «نمی‌رم» بزنی، آمارت اینجا ساخته می‌شه.' })));
  }
  const weekLabel = (iso) => { const [, jm, jd] = isoToJalali(iso); return `${D(jd)}/${D(jm)}`; };
  return h(
    'div',
    { class: 'screen' },
    offlineBanner(),
    hdr('آمار', 'از ابتدای ترم'),
    h(
      'section',
      { class: 'card day-ring' },
      ring({ value: o.rate || 0, size: 108, stroke: 11, color: rate !== null && rate < 70 ? 'var(--warn)' : 'var(--ok)', label: rate === null ? '—' : D(rate) + '٪', sub: 'حضور' }),
      h('div', { class: 'stat-grid grow' },
        h('div', { class: 'stat' }, h('div', { class: 'v' }, '🔥 ' + D(st.streak)), h('div', { class: 'l' }, 'پشت‌سرهم رفتی')),
        h('div', { class: 'stat' }, h('div', { class: 'v' }, '🏆 ' + D(st.best_streak)), h('div', { class: 'l' }, 'بهترین رکورد')),
        h('div', { class: 'stat' }, h('div', { class: 'v' }, D(o.attended)), h('div', { class: 'l' }, 'رفتم')),
        h('div', { class: 'stat' }, h('div', { class: 'v' }, D(o.skipped + o.no_response)), h('div', { class: 'l' }, 'نرفتم')),
      ),
    ),
    h('div', { class: 'section-title' }, h('span', null, 'هفته‌به‌هفته'), h('span', { class: 'row gap-s' }, h('span', { class: 'chip ok' }, 'رفتم'), h('span', { class: 'chip bad' }, 'نرفتم'))),
    h('section', { class: 'card' }, barChart(st.weeks, [['attended', 'var(--ok)'], ['missed', 'var(--bad)']], weekLabel)),
    h('div', { class: 'section-title' }, h('span', null, 'هر درس')),
    h(
      'section',
      { class: 'card list' },
      st.per_course.map((c) => {
        const level = absenceLevel(c.absences, c.allowed_absences);
        const pct = c.allowed_absences > 0 ? Math.min(100, (c.absences / c.allowed_absences) * 100) : c.absences > 0 ? 100 : 0;
        const color = level === 'ok' ? 'var(--ok)' : level === 'warn' ? 'var(--warn)' : 'var(--bad)';
        return h(
          'div',
          { class: 'form', style: { gap: '6px' } },
          h('div', { class: 'row between' }, h('b', null, c.name), h('span', { class: 'small muted' }, c.rate === null ? 'بدون داده' : `${D(percent(c.rate))}٪ حضور`)),
          h('div', { class: 'meter', style: { '--c': color } }, h('i', { style: { width: pct + '%' } })),
          h('div', { class: 'xs muted' }, `غیبت: ${D(c.absences)} از ${D(c.allowed_absences)} مجاز • رفتم: ${D(c.attended)} • برگزار نشد: ${D(c.cancelled)}`),
        );
      }),
    ),
    activitySection(st.activity, weekLabel),
    bodySection(st.body),
    h('div', { class: 'section-title' }, h('span', null, '🎯 دقیقه‌های تمرکز هر هفته'), h('span', { class: 'small' }, `جمع: ${D(st.focus_total)} دقیقه`)),
    h('section', { class: 'card' }, barChart(st.weeks, [['focus', 'var(--accent)']], weekLabel)),
    st.reasons.length
      ? [h('div', { class: 'section-title' }, h('span', null, 'دلیل‌های نرفتن')), h('section', { class: 'card list' }, st.reasons.map((r) => h('div', null, h('div', { class: 'bold small' }, r.title), h('div', { class: 'small muted' }, `${jalaliText(r.date, D)} — ${r.reason}`))))]
      : null,
  );
}

/** Water, exercise, sleep and energy over the last 30 days. */
function bodySection(b) {
  if (!b) return null;
  const hasAny = b.avg_water !== null || b.exercise_days > 0 || b.avg_sleep !== null || Object.values(b.energy).some(Boolean);
  if (!hasAny) return null;
  const dec = (n) => D(String(n).replace('.', '٫'));
  const SLOT = { morning: 'صبح', afternoon: 'بعدازظهر', evening: 'شب' };
  const lines = [];
  if (b.avg_water !== null) lines.push(`💧 میانگین آب: ${dec(b.avg_water)} لیوان در روز`);
  if (b.exercise_days > 0) lines.push(`🏃 ورزش: ${D(b.exercise_days)} روز از ${D(b.days)}`);
  if (b.avg_sleep !== null) lines.push(`😴 میانگین خواب: ${dec(b.avg_sleep)} ساعت (${D(b.sleep_days)} شب ثبت‌شده)`);
  const faces = ['😫', '😕', '😐', '🙂', '🤩'];
  const en = Object.entries(b.energy).filter(([, v]) => v).map(([k, v]) => `${SLOT[k]} ${faces[Math.min(4, Math.max(0, Math.round(v.avg) - 1))]} ${dec(v.avg)}`);
  if (en.length) lines.push(`⚡ انرژی: ${en.join(' • ')}`);
  const e = b.sleep_effect;
  return [
    h('div', { class: 'section-title' }, h('span', null, '🌿 تن و انرژی'), h('span', { class: 'small' }, '۳۰ روز اخیر')),
    h(
      'section',
      { class: 'card form', style: { gap: '8px' } },
      lines.map((l) => h('div', { class: 'small' }, l)),
      e ? h('div', { class: 'small' }, `روزهایی که ≥ ۷ ساعت خوابیدی (${D(e.good_days)} روز) میانگین فعالیتت ${fmtMinutes(e.good_avg)} بود؛ روزهای کم‌خوابی (${D(e.short_days)} روز) ${fmtMinutes(e.short_avg)}.`) : null,
      e ? h('div', { class: 'xs muted' }, 'این فقط یه مقایسه‌ی ساده‌ست، نه اثبات.') : null,
    ),
  ];
}

async function sendBackupNow() {
  try {
    const r = await api('POST', '/backup/send');
    haptic('success');
    toast(`بکاپ (${D(r.kb)} کیلوبایت) توی تلگرام فرستاده شد ✓`);
  } catch (e) {
    errorToast(e);
  }
}

/** Time per activity (study, work, ...): this week vs last week, plus hours per week. */
function activitySection(a, weekLabel) {
  if (!a || !a.total_minutes || !a.categories.length) return null;
  const cats = a.categories;
  const hours = (m) => Math.round((m / 60) * 10) / 10;
  const weeks = a.weeks.map((w) => {
    const o = { week_start: w.week_start };
    for (const c of cats) o['c' + c.id] = hours(w['c' + c.id] || 0);
    return o;
  });
  const biggest = Math.max(1, ...cats.map((c) => c.total_minutes));
  const delta = (c) => {
    if (!c.prev_week_minutes) return c.week_minutes ? 'هفته‌ی قبل چیزی نبود' : '';
    const pct = Math.round(((c.week_minutes - c.prev_week_minutes) / c.prev_week_minutes) * 100);
    if (pct === 0) return 'مثل هفته‌ی قبل';
    return (pct > 0 ? '▲ ' : '▼ ') + D(Math.abs(pct)) + '٪ نسبت به هفته‌ی قبل';
  };
  return [
    h('div', { class: 'section-title' }, h('span', null, '⏱ فعالیت‌ها'), h('span', { class: 'small' }, `جمع ۸ هفته: ${fmtMinutes(a.total_minutes)}`)),
    h(
      'section',
      { class: 'card list' },
      cats.map((c) =>
        h(
          'div',
          { class: 'form', style: { gap: '6px' } },
          h('div', { class: 'row between' }, h('b', null, `${c.icon} ${c.title}`), h('span', { class: 'small muted' }, `این هفته ${fmtMinutes(c.week_minutes)}`)),
          h('div', { class: 'meter', style: { '--c': c.color } }, h('i', { style: { width: (c.weekly_goal_minutes ? Math.min(100, Math.round((c.week_minutes / c.weekly_goal_minutes) * 100)) : Math.round((c.total_minutes / biggest) * 100)) + '%' } })),
          h('div', { class: 'xs muted' }, [c.weekly_goal_minutes ? `هدف هفته ${fmtMinutes(c.week_minutes)} از ${fmtMinutes(c.weekly_goal_minutes)}${c.week_minutes >= c.weekly_goal_minutes ? ' ✓' : ''}` : '', delta(c), `${D(c.sessions)} جلسه`, `میانگین ${fmtMinutes(c.avg_minutes)}`].filter(Boolean).join(' • ')),
        ),
      ),
    ),
    h('div', { class: 'section-title' }, h('span', null, 'ساعت هر هفته'), h('span', { class: 'row gap-s' }, cats.map((c) => h('span', { class: 'cat-sum' }, h('i', { style: { background: c.color } }), c.title)))),
    h('section', { class: 'card' }, barChart(weeks, cats.map((c) => ['c' + c.id, c.color]), weekLabel)),
  ];
}

/** Stacked bar chart as inline SVG. keys: [[field, color], ...] bottom to top. */
function barChart(weeks, keys, label) {
  const W = 320;
  const H = 150;
  const top = 12;
  const bottom = 24;
  const n = weeks.length;
  const slot = W / n;
  const bw = Math.min(26, slot - 10);
  const totals = weeks.map((w) => keys.reduce((s, [k]) => s + (w[k] || 0), 0));
  const max = Math.max(1, ...totals);
  const ch = H - top - bottom;
  const svg = h('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img' });
  svg.append(h('line', { x1: 0, y1: H - bottom, x2: W, y2: H - bottom, stroke: 'var(--line)', 'stroke-width': 1 }));
  weeks.forEach((w, i) => {
    const x = W - (i + 1) * slot + (slot - bw) / 2; // newest on the left (RTL)
    let y = H - bottom;
    for (const [k, color] of keys) {
      const hh = ((w[k] || 0) / max) * ch;
      if (hh > 0) {
        y -= hh;
        svg.append(h('rect', { x, y, width: bw, height: hh, rx: 5, fill: color }));
      }
    }
    if (totals[i] > 0) svg.append(h('text', { x: x + bw / 2, y: y - 4, 'text-anchor': 'middle' }, D(Math.round(totals[i] * 10) / 10)));
    svg.append(h('text', { x: x + bw / 2, y: H - 8, 'text-anchor': 'middle' }, label(w.week_start)));
  });
  return svg;
}

// ====================================================================== SETTINGS
export function viewSettings() {
  const st = S.data.settings;
  const now = nowSec();
  const num = (k, d0) => { const v = Number(st[k]); return Number.isFinite(v) && st[k] !== undefined && st[k] !== '' ? v : d0; };
  const row = (label, desc, control) => h('div', { class: 'setting' }, h('div', { class: 'grow' }, h('div', { class: 'label' }, label), desc ? h('div', { class: 'desc' }, desc) : null), control);
  const timeRow = (label, key) => {
    const el = textInput({ type: 'time', value: st[key] || '' });
    el.style.maxWidth = '130px';
    el.addEventListener('change', () => { if (el.value) saveSetting({ [key]: el.value }); });
    return row(label, null, el);
  };

  // reminder offsets
  const offsets = (st.offsets || '15,10').split(',').map((x) => x.trim()).filter((x) => x && x !== '0');
  const offHost = h('div', { class: 'row wrap gap-s' });
  const addIn = textInput({ placeholder: 'مثلاً ۳۰', inputmode: 'numeric', maxlength: 3 });
  addIn.style.maxWidth = '110px';
  const saveOffsets = (list) => saveSetting({ offsets: list.length ? list.join(',') : '0' }, { rerender: true });
  for (const o of offsets) offHost.append(h('button', { class: 'chip-btn on', 'aria-label': 'حذف', onClick: () => saveOffsets(offsets.filter((x) => x !== o)) }, `${D(o)} دقیقه قبل ✕`));
  const addBtn = h('button', { class: 'btn soft sm', onClick: () => {
    const v = String(parseInt(addIn.value.replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0)), 10));
    if (!/^\d+$/.test(v) || Number(v) < 1 || Number(v) > 720) { toast('یه عدد بین ۱ تا ۷۲۰ بنویس', { kind: 'error' }); return; }
    if (!offsets.includes(v)) saveOffsets([...offsets, v]);
  } }, icon('plus', 16), 'افزودن');


  const pausedUntil = Number(st.paused_until || 0);
  const pauseBtn = (label, hours) => h('button', { class: 'btn soft sm', onClick: () => saveSetting({ paused_until: String(nowSec() + hours * 3600) }, { rerender: true }) }, label);

  return h(
    'div',
    { class: 'screen' },
    offlineBanner(),
    hdr('تنظیمات'),

    h('section', { class: 'card' },
      row('ارقام', 'فارسی (۱۲۳) یا لاتین (123)', segmented([{ value: 'fa', label: 'فارسی' }, { value: 'en', label: 'لاتین' }], st.digits === 'en' ? 'en' : 'fa', (v) => saveSetting({ digits: v }, { rerender: true })).el),
      h('div', { class: 'setting', style: { display: 'block' } }, h('div', { class: 'label' }, 'منطقه‌ی زمانی'), h('div', { style: { marginTop: '8px' } }, selectEl(timezoneOptions(st.timezone || 'Asia/Tehran'), st.timezone || 'Asia/Tehran', (v) => saveSetting({ timezone: v }, { rerender: true })))),
    ),

    h('div', { class: 'section-title' }, h('span', null, '🔔 یادآوری‌ها')),
    h('section', { class: 'card' },
      h('div', { class: 'setting', style: { display: 'block' } }, h('div', { class: 'label' }, 'قبل از کلاس'), h('div', { class: 'desc' }, 'علاوه بر پیام لحظه‌ی شروع. روی هر مورد بزن تا حذف بشه.'), h('div', { style: { marginTop: '8px' } }, offHost), h('div', { class: 'row mt' }, addIn, addBtn)),
      row('بعد از زدن «👍 باشه»', 'اگه روشن باشه، موقع شروع کلاس یه پیام ساده می‌فرستم (بدون دکمه و سوال)', switchEl(st.ack_start_notice !== '0', (on) => saveSetting({ ack_start_notice: on ? '1' : '0' }))),
      row('فاصله‌ی یادآوری تکراری', 'بعد از شروع کلاس، تا جواب ندی', stepper(num('nag_interval_min', 5), 1, 60, (v) => saveSetting({ nag_interval_min: String(v) }), D, ' دقیقه')),
      row('حداکثر یادآوری تکراری', 'بعدش «بدون پاسخ» ثبت می‌شه', stepper(num('max_nags', 6), 1, 30, (v) => saveSetting({ max_nags: String(v) }), D, ' بار')),
      row('مدت «چند دقیقه دیگه»', null, stepper(num('snooze_min', 10), 1, 60, (v) => saveSetting({ snooze_min: String(v) }), D, ' دقیقه')),
    ),

    h('div', { class: 'section-title' }, h('span', null, '🕒 ساعت‌های روزانه')),
    h('section', { class: 'card' }, timeRow('بیدار شدن', 'wake_time'), timeRow('ناهار', 'lunch_time'), timeRow('شام', 'dinner_time'), timeRow('خواب', 'sleep_time')),
    dayPlanCard(),
    gapsCompact(),

    h('div', { class: 'section-title' }, h('span', null, '💾 داده‌ها')),
    h(
      'section',
      { class: 'card' },
      row('بکاپ هفتگی', 'جمعه‌ها بعد از ساعت ۲۰:۳۰ یه فایل بکاپ توی تلگرام میاد', switchEl(st.weekly_backup !== '0', (on) => saveSetting({ weekly_backup: on ? '1' : '0' }))),
      row('بکاپ همین الان', 'یه فایل از همه‌ی داده‌هات توی تلگرام فرستاده می‌شه', h('button', { class: 'btn soft sm', onClick: sendBackupNow }, 'بفرست')),
      row('خروجی جلسه‌ها', 'همه‌ی جلسه‌ها با دسته، کار و یادداشت (CSV)', h('button', { class: 'btn soft sm', onClick: openActivityExports }, 'خروجی')),
    ),
    h('div', { class: 'section-title' }, h('span', null, '🎯 تمرکز')),
    h('section', { class: 'card' }, row('مدت هر دوره', null, stepper(num('focus_minutes', 25), 5, 120, (v) => saveSetting({ focus_minutes: String(v) }), D, ' دقیقه', 5))),

    h('div', { class: 'section-title' }, h('span', null, '⏸ حالت‌ها')),
    h('section', { class: 'card' },
      row('گزارش هفتگی', 'جمعه‌ها بعد از ساعت ۲۰ خلاصه‌ی هفته توی تلگرام میاد', switchEl(st.weekly_report !== '0', (on) => saveSetting({ weekly_report: on ? '1' : '0' }))),
      row('حالت تعطیلات', 'همه‌ی یادآوری‌ها ساکت می‌شن', switchEl(st.vacation === '1', (on) => saveSetting({ vacation: on ? '1' : '0' }, { rerender: true }))),
      h('div', { class: 'setting', style: { display: 'block' } },
        h('div', { class: 'label' }, 'توقف موقت'),
        h('div', { class: 'desc' }, pausedUntil > now ? `الان تا ساعت ${hm(pausedUntil)} متوقفه.` : 'برای مدتی یادآوری‌ها رو ساکت کن.'),
        h('div', { class: 'row wrap gap-s mt' }, pausedUntil > now ? h('button', { class: 'btn primary sm', onClick: () => saveSetting({ paused_until: '0' }, { rerender: true }) }, 'ادامه بده') : [pauseBtn('۱ ساعت', 1), pauseBtn('۳ ساعت', 3), pauseBtn('۲۴ ساعت', 24)]),
      ),
    ),

    h('div', { class: 'section-title' }, h('span', null, 'بیشتر')),
    h('section', { class: 'card' },
      h('button', { class: 'setting', style: { width: '100%', textAlign: 'start' }, onClick: openTextsEditor }, h('div', { class: 'grow' }, h('div', { class: 'label' }, '✏️ متن پیام‌ها و دکمه‌ها'), h('div', { class: 'desc' }, 'همه‌ی متن‌های ربات قابل ویرایشن')), icon('chevron', 18)),
      h('button', { class: 'setting', style: { width: '100%', textAlign: 'start' }, onClick: openTutorial }, h('div', { class: 'grow' }, h('div', { class: 'label' }, '🎓 آموزش کوتاه')), icon('chevron', 18)),
      h('button', { class: 'setting', style: { width: '100%', textAlign: 'start' }, onClick: () => saveSetting({ gaps_dismissed: '0' }, { rerender: true, quiet: true }).then(() => hooks.go('today')) }, h('div', { class: 'grow' }, h('div', { class: 'label' }, '🧩 تکمیل برنامه'), h('div', { class: 'desc' }, 'یادآوری چیزهایی که از فایل دانشگاه بریده شده بود')), icon('chevron', 18)),
    ),
    h('div', { class: 'center muted xs mt' }, 'برنامه‌ی من • نسخه‌ی ۷'),
  );
}
