// The owner's day: study timer, challenge from the partner, meals on the timeline.

import { clock, fromMin, hmOf, jalaliText, toMin } from './lib.js';
import { confirmSheet, errorToast, field, h, haptic, icon, openSheet, segmented, switchEl, textInput, toast } from './ui.js';
import { COURSE_COLORS, D, S, api, hm, hooks, nowSec, refresh, toastUnlocked } from './core.js';

/** 150 -> "۲ ساعت و ۳۰ دقیقه", 45 -> "۴۵ دقیقه", 120 -> "۲ ساعت". */
export function fmtMinutes(min) {
  const m = Math.max(0, Math.round(min));
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  if (hh === 0) return `${D(mm)} دقیقه`;
  return mm === 0 ? `${D(hh)} ساعت` : `${D(hh)} ساعت و ${D(mm)} دقیقه`;
}
const hoursText = (n) => D(String(n).replace('.', '٫'));

// ------------------------------------------------------------------ greeting by the owner's day, not by the clock
export function greetingFor(now) {
  const c = S.data.study && S.data.study.cycle;
  if (!c) return ['سلام', '👋'];
  if (!c.awake) return ['شب بخیر', '😴'];
  const hrs = (now - c.wake_ts) / 3600;
  if (hrs < 3) return ['صبح بخیر', '☀️'];
  if (hrs < 6) return ['روز بخیر', '🌤'];
  if (hrs < 10) return ['عصر بخیر', '🌇'];
  return ['شب بخیر', '🌙'];
}

// ------------------------------------------------------------------ study card
/** Start the timer on a task. Its own category is used when it has one. */
export async function startTaskTimer(task) {
  if (S.data.study.running) {
    haptic('error');
    toast('یه تایمر دیگه الان روشنه؛ اول اون رو تموم کن', { kind: 'error' });
    return;
  }
  await run(() => api('POST', '/study/timer/start', { task_id: task.id }), `تایمر روی «${task.title}» روشن شد 💪`);
}

/** Refresh the app data and drop the cached statistics so the Stats tab reloads them. */
async function refreshAll() {
  S.stats = null;
  await refresh();
}

async function run(fn, okText) {
  try {
    await fn();
    haptic('success');
    await refreshAll();
    if (okText) toast(okText);
  } catch (e) {
    errorToast(e);
  }
}

// ------------------------------------------------------------------ activity categories (study, work, your own)
const cats = () => (S.data.study && S.data.study.categories) || [];
const catById = (id) => cats().find((c) => c.id === id) || null;
let picked = null; // category chosen on the Today card (kept while the app stays open)
function pickedCat() {
  const list = cats();
  if (!list.length) return null;
  return catById(picked) || catById(S.data.study.last_category_id) || list[0];
}

/** Row of category chips; get() returns the chosen id. */
function catPicker(initialId, onChange) {
  let cur = initialId;
  const el = h('div', { class: 'row wrap gap-s cat-row' });
  const draw = () =>
    el.replaceChildren(
      ...cats().map((c) =>
        h(
          'button',
          {
            class: 'chip-btn cat-chip' + (c.id === cur ? ' on' : ''),
            style: c.id === cur ? { borderColor: c.color } : {},
            onClick: () => {
              cur = c.id;
              haptic('select');
              draw();
              if (onChange) onChange(c);
            },
          },
          `${c.icon} ${c.title}`,
        ),
      ),
    );
  draw();
  return { el, get: () => cur };
}

export function studyCard() {
  const st = S.data.study;
  const now = nowSec();
  const running = st.running;
  const rc = running ? catById(st.running_category_id) : null;
  const total = h('div', { class: 'study-total num', 'data-live-min': running ? '1' : '0', 'data-base': st.today_minutes, 'data-at': S.data.now }, fmtMinutes(st.today_minutes));

  const head = h(
    'div',
    { class: 'row between' },
    h('div', { class: 'card-title', style: { margin: 0 } }, rc ? `${rc.icon} ${rc.title}` : '⏱ فعالیت امروز'),
    st.class_minutes ? h('span', { class: 'chip info' }, `🎓 کلاس ${fmtMinutes(st.class_minutes)}`) : null,
  );

  // how today splits between study, work, ...
  const sums = (st.by_category || []).filter((x) => x.minutes > 0 && catById(x.category_id));
  const sumRow =
    sums.length > 1 || (sums.length === 1 && sums[0].category_id !== 1)
      ? h(
          'div',
          { class: 'cat-sums' },
          sums.map((x) => {
            const c = catById(x.category_id);
            return h('span', { class: 'cat-sum' }, h('i', { style: { background: c.color } }), `${c.icon} ${fmtMinutes(x.minutes)}`);
          }),
        )
      : null;

  // goals per category (daily and / or weekly)
  const dayMin = new Map((st.by_category || []).map((x) => [x.category_id, x.minutes]));
  const weekMin = new Map((st.week_by_category || []).map((x) => [x.category_id, x.minutes]));
  const goalCats = cats().filter((c) => c.daily_goal_minutes || c.weekly_goal_minutes);
  const goalList = goalCats.length
    ? h(
        'div',
        { class: 'goal-list' },
        goalCats.map((c) => {
          const dm = dayMin.get(c.id) || 0;
          const wm = weekMin.get(c.id) || 0;
          const main = c.daily_goal_minutes ? [dm, c.daily_goal_minutes] : [wm, c.weekly_goal_minutes];
          const bits = [
            c.daily_goal_minutes ? `امروز ${fmtMinutes(dm)} از ${fmtMinutes(c.daily_goal_minutes)}${dm >= c.daily_goal_minutes ? ' ✓' : ''}` : null,
            c.weekly_goal_minutes ? `هفته ${fmtMinutes(wm)} از ${fmtMinutes(c.weekly_goal_minutes)}${wm >= c.weekly_goal_minutes ? ' ✓' : ''}` : null,
          ].filter(Boolean);
          return h(
            'div',
            { class: 'goal-row' },
            h('div', { class: 'row between small' }, h('span', null, `${c.icon} ${c.title}`), h('span', { class: 'muted' }, bits.join(' • '))),
            h('div', { class: 'meter', style: { '--c': c.color } }, h('i', { style: { width: Math.min(100, Math.round((main[0] / main[1]) * 100)) + '%' } })),
          );
        }),
      )
    : null;

  // streaks per category: days in a row with at least the daily goal (or 20 minutes)
  const streakCats = (st.streaks || []).filter((x) => x.streak >= 2 && catById(x.category_id));
  const streakRow = streakCats.length
    ? h(
        'div',
        { class: 'cat-sums' },
        streakCats.map((x) => {
          const c = catById(x.category_id);
          return h('span', { class: 'cat-sum', title: `حداقل ${fmtMinutes(x.threshold)} در روز` }, `${c.icon} 🔥 ${D(x.streak)} روز`);
        }),
      )
    : null;

  let body;
  if (running) {
    body = [
      h('div', { class: 'timer-big num', 'data-up': running }, clock(now - running, D)),
      st.running_task ? h('div', { class: 'small center' }, `📝 ${st.running_task.title}`) : null,
      h('div', { class: 'small muted center' }, `از ساعت ${hm(running)} شروع کردی؛ هر وقت تموم شد بزن.`),
      h('div', { class: 'row gap-s mt' }, h('button', { class: 'btn primary grow', onClick: openStopSheet }, icon('check', 18), 'تموم شد'), h('button', { class: 'btn ghost', onClick: cancelRun }, 'لغو')),
    ];
  } else {
    const sel = { cat: pickedCat() };
    const startLabel = () => (sel.cat ? `شروع ${sel.cat.title}` : 'شروع درس خوندن');
    const startBtn = h(
      'button',
      {
        class: 'btn primary block big',
        onClick: () => run(() => api('POST', '/study/timer/start', sel.cat ? { category_id: sel.cat.id } : {}), 'تایمر روشن شد؛ موفق باشی 💪'),
      },
      icon('play', 18),
      startLabel(),
    );
    const picker =
      cats().length > 1
        ? catPicker(sel.cat ? sel.cat.id : null, (c) => {
            sel.cat = c;
            picked = c.id;
            startBtn.replaceChildren(icon('play', 18), startLabel());
          })
        : null;
    body = [
      picker ? picker.el : null,
      startBtn,
      h(
        'div',
        { class: 'row gap-s mt' },
        h('button', { class: 'btn soft grow sm', onClick: openStartedEarlier }, 'قبلاً شروع کردم…'),
        h('button', { class: 'btn soft grow sm', onClick: openManualSheet }, icon('plus', 16), 'ثبت دستی'),
        h('button', { class: 'btn ghost sm', 'aria-label': 'دسته‌ها', onClick: openCategorySheet }, '⚙️'),
      ),
    ];
  }

  const list = st.sessions.slice(0, 4);
  return h(
    'section',
    { class: 'card study-card' + (running ? ' live' : '') },
    head,
    total,
    sumRow,
    goalList,
    streakRow,
    ...body,
    list.length
      ? h(
          'div',
          { class: 'sess-list mt' },
          list.map((x) =>
            h(
              'button',
              { class: 'sess-row', onClick: () => openSessionSheet(x) },
              h('span', { class: 'cat-ico' }, (catById(x.category_id) || { icon: '•' }).icon),
              h('span', { class: 'num grow' }, x.started_at ? `${hm(x.started_at)}–${hm(x.ended_at)}` : hm(x.ended_at)),
              h('b', null, fmtMinutes(x.minutes)),
            ),
          ),
        )
      : null,
    list.length ? h('button', { class: 'btn ghost sm block mt', onClick: openHistorySheet }, 'همه‌ی جلسه‌ها و ویرایش ›') : null,
  );
}

async function removeSession(x) {
  if (!(await confirmSheet({ title: 'حذف این جلسه؟', text: fmtMinutes(x.minutes), confirmText: 'حذف', danger: true }))) return false;
  await run(() => api('DELETE', `/study/${x.id}`), 'حذف شد');
  return true;
}

/** Fix an old session: its category, its times (or just its minutes when it was typed with /study). */
function openSessionSheet(x) {
  const hasTimes = !!(x.started_at && x.ended_at);
  const cp = cats().length ? catPicker(x.category_id) : null;
  const tz = S.data.tz;
  const span = hasTimes ? Math.round((x.ended_at - x.started_at) / 60) : 0;
  const startIn = textInput({ type: 'time', value: hasTimes ? hmOf(x.started_at, tz) : '' });
  const endIn = textInput({ type: 'time', value: hasTimes ? hmOf(x.ended_at, tz) : '' });
  const brk = numberInput(hasTimes ? Math.max(0, span - x.minutes) : 0, '0');
  const mins = numberInput(x.minutes, '60');
  const noteIn = textInput({ value: x.note || '', placeholder: 'اختیاری', maxlength: 200 });
  const sheet = openSheet({
    title: 'ویرایش جلسه',
    body: h(
      'div',
      { class: 'form' },
      cp ? h('div', { class: 'field' }, h('div', { class: 'field-label' }, 'دسته'), cp.el) : null,
      hasTimes
        ? [h('div', { class: 'two' }, field('از ساعت', startIn), field('تا ساعت', endIn)), field('استراحت وسط کار (دقیقه)', brk)]
        : field('مدت (دقیقه)', mins),
      field('یادداشت', noteIn),
      h('button', { class: 'btn ghost block', onClick: async () => { if (await removeSession(x)) sheet.close(); } }, icon('trash', 16), 'حذف این جلسه'),
    ),
    primary: {
      text: 'ذخیره',
      onClick: async () => {
        sheet.setBusy(true);
        try {
          const body = { category_id: cp ? cp.get() : undefined, note: noteIn.value };
          if (hasTimes) Object.assign(body, { start: startIn.value, end: endIn.value, break_minutes: num(brk) });
          else body.minutes = num(mins);
          await api('PUT', `/study/${x.id}`, body);
          haptic('success');
          sheet.close();
          await refreshAll();
          toast('ذخیره شد ✓');
        } catch (e) {
          errorToast(e);
        }
        sheet.setBusy(false);
      },
    },
  });
}

/** Everything from the last 30 days, grouped by day. Tap one to edit it. */
async function openHistorySheet() {
  let list;
  try {
    list = (await api('GET', '/study/sessions')).sessions;
  } catch (e) {
    errorToast(e);
    return;
  }
  const byDay = new Map();
  for (const x of list) {
    if (!byDay.has(x.date)) byDay.set(x.date, []);
    byDay.get(x.date).push(x);
  }
  const body = h('div', { class: 'form' });
  if (!list.length) body.append(h('div', { class: 'small muted center' }, 'توی ۳۰ روز گذشته چیزی ثبت نشده.'));
  for (const [date, items] of byDay) {
    const sum = items.reduce((s, x) => s + x.minutes, 0);
    body.append(
      h('div', { class: 'row between' }, h('b', null, jalaliText(date, D)), h('span', { class: 'small muted' }, fmtMinutes(sum))),
      h(
        'div',
        { class: 'sess-list' },
        items.map((x) =>
          h(
            'button',
            { class: 'sess-row', onClick: () => { sheet.close(); openSessionSheet(x); } },
            h('span', { class: 'cat-ico' }, (catById(x.category_id) || { icon: '•' }).icon),
            h('span', { class: 'grow' }, h('span', { class: 'num' }, x.started_at ? `${hm(x.started_at)}–${hm(x.ended_at)}` : hm(x.ended_at)), x.note ? h('div', { class: 'xs muted' }, x.note) : null),
            h('b', null, fmtMinutes(x.minutes)),
          ),
        ),
      ),
    );
  }
  const sheet = openSheet({ title: 'جلسه‌های ۳۰ روز اخیر', body });
}

async function cancelRun() {
  if (!(await confirmSheet({ title: 'تایمر لغو بشه؟', text: 'زمانی که گذشته ثبت نمی‌شه.', confirmText: 'لغو کن', danger: true }))) return;
  await run(() => api('POST', '/study/timer/cancel', {}), 'تایمر لغو شد');
}

function numberInput(value, placeholder) {
  return textInput({ value: String(value), inputmode: 'numeric', dir: 'ltr', placeholder });
}
const num = (el) => Number((el.value || '0').replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)) || 0);

function chipPicker(values, input, label) {
  const row = h('div', { class: 'row wrap gap-s' });
  const draw = () => row.replaceChildren(...values.map((v) => h('button', { class: 'chip-btn' + (num(input) === v ? ' on' : ''), onClick: () => { input.value = String(v); draw(); } }, label(v))));
  input.addEventListener('input', draw);
  draw();
  return row;
}

function openStopSheet() {
  const running = S.data.study.running;
  const rcat = catById(S.data.study.running_category_id);
  const brk = numberInput(0, '0');
  const noteIn = textInput({ placeholder: 'اختیاری: چی کار کردی؟', maxlength: 200 });
  const live = h('div', { class: 'timer-big num', 'data-up': running }, clock(nowSec() - running, D));
  const sheet = openSheet({
    title: rcat ? `پایان ${rcat.title}` : 'پایان درس خوندن',
    body: h('div', { class: 'form' }, live, field('یادداشت', noteIn), field('بین کار استراحت یا کار اضافه کردی؟ (دقیقه)', brk, 'اون مدت از کل زمان کم می‌شه.'), chipPicker([0, 15, 30, 60], brk, (v) => (v === 0 ? 'نه' : `${D(v)} دقیقه`))),
    primary: {
      text: 'ثبت',
      onClick: async () => {
        sheet.setBusy(true);
        try {
          const r = await api('POST', '/study/timer/stop', { break_minutes: num(brk), note: noteIn.value });
          toastUnlocked(r.unlocked);
          haptic('success');
          sheet.close();
          await refreshAll();
          toast(`${fmtMinutes(r.minutes)} ${rcat ? rcat.title : 'درس خوندن'} ثبت شد 🎉`);
        } catch (e) {
          errorToast(e);
        }
        sheet.setBusy(false);
      },
    },
  });
}

function openStartedEarlier() {
  const ago = numberInput(30, '30');
  const cp = cats().length > 1 ? catPicker(pickedCat() ? pickedCat().id : null) : null;
  const sheet = openSheet({
    title: 'قبلاً شروع کرده بودم',
    body: h('div', { class: 'form' }, cp ? h('div', { class: 'field' }, h('div', { class: 'field-label' }, 'چی کار می‌کردی؟'), cp.el) : null, field('چند دقیقه پیش شروع کردی؟', ago), chipPicker([15, 30, 60, 120, 180], ago, (v) => (v < 60 ? `${D(v)} دقیقه` : `${D(v / 60)} ساعت`))),
    primary: {
      text: 'تایمر رو از اون موقع روشن کن',
      onClick: async () => {
        sheet.setBusy(true);
        try {
          await api('POST', '/study/timer/start', { minutes_ago: num(ago), category_id: cp ? cp.get() : undefined });
          haptic('success');
          sheet.close();
          await refreshAll();
          toast('تایمر روشن شد 💪');
        } catch (e) {
          errorToast(e);
        }
        sheet.setBusy(false);
      },
    },
  });
}

function openManualSheet() {
  const nowMin = toMin(hmOf(nowSec(), S.data.tz));
  const startIn = textInput({ type: 'time', value: fromMin(Math.max(0, nowMin - 60)) });
  const endIn = textInput({ type: 'time', value: fromMin(nowMin) });
  const brk = numberInput(0, '0');
  const cp = cats().length > 1 ? catPicker(pickedCat() ? pickedCat().id : null) : null;
  let when = 'today';
  const seg = segmented([{ value: 'today', label: 'امروز' }, { value: 'yesterday', label: 'دیروز' }], when, (v) => { when = v; });
  const sheet = openSheet({
    title: 'ثبت دستی',
    body: h(
      'div',
      { class: 'form' },
      cp ? h('div', { class: 'field' }, h('div', { class: 'field-label' }, 'چی کار کردی؟'), cp.el) : null,
      h('div', { class: 'field' }, h('div', { class: 'field-label' }, 'کدوم روز شروع کردی؟'), seg.el),
      h('div', { class: 'two' }, field('از ساعت', startIn), field('تا ساعت', endIn)),
      field('استراحت / کار اضافه (دقیقه)', brk),
      h('div', { class: 'field-hint' }, 'اگه «تا» از «از» زودتر باشه یعنی از نیمه‌شب رد شده.'),
    ),
    primary: {
      text: 'ثبت',
      onClick: async () => {
        sheet.setBusy(true);
        try {
          const r = await api('POST', '/study/manual', { date: when, start: startIn.value, end: endIn.value, break_minutes: num(brk), category_id: cp ? cp.get() : undefined });
          toastUnlocked(r.unlocked);
          haptic('success');
          sheet.close();
          await refreshAll();
          toast(`${fmtMinutes(r.minutes)} ثبت شد ✓`);
        } catch (e) {
          errorToast(e);
        }
        sheet.setBusy(false);
      },
    },
  });
}

// ------------------------------------------------------------------ manage categories
const CAT_ICONS = ['📚', '💼', '🛠', '💻', '🗣', '🏃', '📖', '🎨', '🧪', '✍️', '🎧', '🧘'];

async function openCategorySheet() {
  let all;
  try {
    all = (await api('GET', '/categories')).categories;
  } catch (e) {
    errorToast(e);
    return;
  }
  const rows = all.map((c) =>
    h(
      'button',
      { class: 'sess-row', onClick: () => { sheet.close(); openCategoryForm(c); } },
      h('span', { class: 'grow' }, `${c.icon} ${c.title}`),
      c.is_active ? null : h('span', { class: 'chip' }, 'بایگانی'),
      h('span', { class: 'cat-dot', style: { background: c.color } }),
    ),
  );
  const sheet = openSheet({
    title: 'دسته‌های فعالیت',
    body: h('div', { class: 'form' }, h('div', { class: 'field-hint' }, 'روی هر دسته بزن تا ویرایشش کنی.'), h('div', { class: 'sess-list' }, rows)),
    primary: { text: '＋ دسته‌ی جدید', onClick: () => { sheet.close(); openCategoryForm(null); } },
  });
}

function openCategoryForm(cat) {
  const titleIn = textInput({ value: cat ? cat.title : '', placeholder: 'مثلاً فریلنس', maxlength: 24 });
  const iconIn = textInput({ value: cat ? cat.icon : '📌', maxlength: 4 });
  let color = cat ? cat.color : COURSE_COLORS[1];
  let share = cat ? cat.share_with_partner !== 0 : true;
  const hrs = (m) => (m ? String(Math.round((m / 60) * 10) / 10) : '');
  const dailyIn = textInput({ value: cat ? hrs(cat.daily_goal_minutes) : '', inputmode: 'decimal', dir: 'ltr', placeholder: 'مثلاً ۳' });
  const weeklyIn = textInput({ value: cat ? hrs(cat.weekly_goal_minutes) : '', inputmode: 'decimal', dir: 'ltr', placeholder: 'مثلاً ۱۵' });
  const focusIn = textInput({ value: cat && cat.focus_minutes ? String(cat.focus_minutes) : '', inputmode: 'numeric', dir: 'ltr', placeholder: 'مثلاً ۵۰' });
  const breakIn = textInput({ value: cat && cat.break_minutes ? String(cat.break_minutes) : '', inputmode: 'numeric', dir: 'ltr', placeholder: 'مثلاً ۱۰' });
  const toMinutes = (el) => {
    const v = Number((el.value || '').replace('٫', '.').replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)) || 0);
    return Number.isFinite(v) ? Math.round(v * 60) : 0;
  };
  const iconRow = h('div', { class: 'row wrap gap-s' }, CAT_ICONS.map((e) => h('button', { class: 'chip-btn', onClick: () => { iconIn.value = e; haptic('select'); } }, e)));
  const colorRow = h('div', { class: 'row wrap gap-s' });
  const drawColors = () =>
    colorRow.replaceChildren(
      ...COURSE_COLORS.map((c) =>
        h('button', {
          class: 'chip-btn cat-color',
          'aria-label': c,
          style: { background: c, borderColor: c === color ? 'currentColor' : 'transparent', width: '34px', minHeight: '34px', padding: '0' },
          onClick: () => { color = c; haptic('select'); drawColors(); },
        }),
      ),
    );
  drawColors();

  const done = async (msg) => {
    sheet.close();
    await refreshAll();
    toast(msg);
  };
  const toggleArchive = async () => {
    try {
      await api('PUT', `/categories/${cat.id}`, { is_active: cat.is_active ? 0 : 1 });
      await done(cat.is_active ? 'بایگانی شد' : 'برگشت به لیست ✓');
    } catch (e) {
      errorToast(e);
    }
  };
  const remove = async () => {
    if (!(await confirmSheet({ title: 'این دسته حذف بشه؟', text: 'اگه قبلاً ثبتی داشته باشه فقط بایگانی می‌شه تا آمار قبلی نپره.', confirmText: 'حذف', danger: true }))) return;
    try {
      const r = await api('DELETE', `/categories/${cat.id}`);
      await done(r.archived ? 'جلسه داشت؛ بایگانی شد' : 'حذف شد');
    } catch (e) {
      errorToast(e);
    }
  };

  const sheet = openSheet({
    title: cat ? 'ویرایش دسته' : 'دسته‌ی جدید',
    body: h(
      'div',
      { class: 'form' },
      field('اسم', titleIn),
      field('آیکون', iconIn),
      iconRow,
      h('div', { class: 'field' }, h('div', { class: 'field-label' }, 'رنگ'), colorRow),
      h('div', { class: 'two' }, field('هدف روزانه (ساعت)', dailyIn), field('هدف هفتگی (ساعت)', weeklyIn)),
      h('div', { class: 'two' }, field('تمرکز (دقیقه)', focusIn), field('استراحت (دقیقه)', breakIn)),
      h(
        'div',
        { class: 'row between' },
        h('div', { class: 'grow' }, h('b', null, 'پارتنر ببینه'), h('div', { class: 'xs muted' }, 'اگه خاموش باشه فقط می‌بینه «مشغوله»، بدون اسم و ساعت این دسته.')),
        switchEl(share, (on) => { share = !!on; }),
      ),
      cat && !cat.is_builtin
        ? h('div', { class: 'row gap-s mt' }, h('button', { class: 'btn soft grow', onClick: toggleArchive }, cat.is_active ? 'بایگانی' : 'برگردوندن'), h('button', { class: 'btn ghost grow', onClick: remove }, icon('trash', 16), 'حذف'))
        : null,
    ),
    primary: {
      text: 'ذخیره',
      onClick: async () => {
        sheet.setBusy(true);
        try {
          const body = { title: titleIn.value, icon: iconIn.value, color, daily_goal_minutes: toMinutes(dailyIn), weekly_goal_minutes: toMinutes(weeklyIn), share_with_partner: share ? 1 : 0, focus_minutes: num(focusIn), break_minutes: num(breakIn) };
          if (cat) await api('PUT', `/categories/${cat.id}`, body);
          else await api('POST', '/categories', body);
          haptic('success');
          await done('ذخیره شد ✓');
        } catch (e) {
          errorToast(e);
        }
        sheet.setBusy(false);
      },
    },
  });
}

// ------------------------------------------------------------------ challenge from the partner
function meter(value, max, markAt) {
  const pct = Math.max(0, Math.min(100, max ? (value / max) * 100 : 0));
  return h('div', { class: 'meter chal-meter' }, h('i', { style: { width: pct + '%' } }), markAt != null ? h('b', { class: 'mark', style: { insetInlineStart: Math.min(100, (markAt / max) * 100) + '%' } }) : null);
}

export function challengeCard() {
  const ch = S.data.challenge;
  if (!ch) return null;
  const c = ch.today || null;
  const nextDay = ch.tomorrow || null;
  if (!c && !nextDay) return null;
  const who = S.data.partner_name || 'پارتنر';
  const parts = [];
  if (c) {
    const prog = c.progress_minutes || 0;
    const stateChip = { reward_earned: ['ok', '🎉 جایزه رو بردی!'], at_risk: ['bad', '⚠️ هنوز از حداقل کمتری'], running: ['info', 'در جریانه'], upcoming: ['info', 'در جریانه'], settled: ['', 'تموم شد'] }[c.state];
    const max = Math.max((c.target_hours || 0) * 60, (c.min_hours || 0) * 60, 60);
    parts.push(
      h('div', { class: 'row between' }, h('div', { class: 'card-title', style: { margin: 0 } }, `🏆 چالش ${who} برای امروز`), h('span', { class: 'chip ' + stateChip[0] }, stateChip[1])),
      c.reward_text && c.target_hours ? h('div', { class: 'chal-line' }, h('span', null, '🎁'), h('div', null, h('b', null, `${hoursText(c.target_hours)} ساعت یا بیشتر:`), ' ', c.reward_text)) : null,
      c.punishment_text && c.min_hours ? h('div', { class: 'chal-line' }, h('span', null, '😈'), h('div', null, h('b', null, `کمتر از ${hoursText(c.min_hours)} ساعت:`), ' ', c.punishment_text)) : null,
      c.scope_label ? h('div', { class: 'xs muted' }, `حساب می‌شه: ${c.scope_label}`) : null,
      meter(prog, max, c.min_hours && c.punishment_text ? c.min_hours * 60 : null),
      h('div', { class: 'row between small muted' }, h('span', null, `تا الان ${fmtMinutes(prog)}`), h('span', null, c.target_hours ? `هدف ${hoursText(c.target_hours)} ساعت` : '')),
    );
  }
  if (nextDay) {
    parts.push(h('div', { class: 'chal-next' }, h('b', null, `فردا (از ${who}): `), [nextDay.reward_text && nextDay.target_hours ? `🎁 ${nextDay.reward_text} (${hoursText(nextDay.target_hours)} ساعت)` : null, nextDay.punishment_text && nextDay.min_hours ? `😈 ${nextDay.punishment_text} (زیر ${hoursText(nextDay.min_hours)} ساعت)` : null].filter(Boolean).join(' • ')));
  }
  return h('section', { class: 'card chal-card' }, ...parts);
}

// ------------------------------------------------------------------ timeline: wake first, sleep last, meals you can tick
function cycleMidnightTs() {
  const c = S.data.study.cycle;
  const plan = S.data.today_plan;
  return c.wake_ts - toMin(plan.wake) * 60;
}

export function softItems() {
  const s = S.data.settings;
  const plan = S.data.today_plan;
  const meals = S.data.meals || {};
  const out = [];
  const valid = (t) => typeof t === 'string' && /^\d\d:\d\d$/.test(t);
  const mid = cycleMidnightTs();
  const minOf = (ts) => Math.floor((ts - mid) / 60);

  out.push({ min: -1, soft: { kind: 'wake', t: plan.wake, emoji: '☀️', label: 'بیدار شدن' } });
  const dinnerMin = valid(s.dinner_time) ? toMin(s.dinner_time) : 1200;
  for (const [meal, emoji, label, t] of [['lunch', '🍽', 'ناهار', s.lunch_time], ['dinner', '🍲', 'شام', s.dinner_time]]) {
    if (!valid(t)) continue;
    const st = meals[meal] || null;
    let min = toMin(t);
    let shown = t;
    if (st && st.status === 'done' && st.at_ts) {
      min = minOf(st.at_ts);
      shown = hmOf(st.at_ts, S.data.tz);
    } else if (st && st.status === 'later') {
      min = st.after === 'dinner' ? dinnerMin + 0.5 : 99000;
    }
    out.push({ min, soft: { kind: 'meal', meal, t: shown, emoji, label, state: st } });
  }
  if (plan.quiet_mode === 'window') {
    out.push({ min: toMin(plan.quiet_from), soft: { kind: 'note', t: plan.quiet_from, emoji: '🔕', label: 'شروع خاموشی' } });
    out.push({ min: toMin(plan.quiet_to) + (toMin(plan.quiet_to) <= toMin(plan.quiet_from) ? 1440 : 0), soft: { kind: 'note', t: plan.quiet_to, emoji: '🔔', label: 'پایان خاموشی' } });
  }
  out.push({ min: 100000, soft: { kind: 'sleep', t: plan.sleep, emoji: '🌙', label: 'خواب' } });
  return out;
}

async function setMeal(meal, body) {
  try {
    await api('POST', '/meals', { meal, ...body });
    haptic('success');
    await refreshAll();
  } catch (e) {
    errorToast(e);
  }
}

function openMealSheet(x) {
  const st = x.state;
  const timeIn = textInput({ type: 'time', value: hmOf(nowSec(), S.data.tz) });
  let sheet;
  const choose = (body) => async () => { sheet.close(); await setMeal(x.meal, body); };
  const opt = (label, fn, cls = 'soft') => h('button', { class: `btn ${cls} block`, onClick: fn }, label);
  sheet = openSheet({
    title: `${x.emoji} ${x.label}`,
    body: h(
      'div',
      { class: 'form' },
      opt('✅ همین الان خوردم', choose({ status: 'done' }), 'primary'),
      h('div', { class: 'row gap-s' }, h('div', { class: 'grow' }, timeIn), h('button', { class: 'btn soft', onClick: choose({ status: 'done', at: timeIn.value }) }, 'خوردم، ساعتش این بود')),
      h('div', { class: 'section-title' }, h('span', null, '⏳ دیرتر می‌خورم')),
      x.meal === 'lunch' ? opt('بعد از شام', choose({ status: 'later', after: 'dinner' })) : null,
      opt('بعد از بیدار شدن', choose({ status: 'later', after: 'wake' })),
      st ? opt('↩️ پاک کردن علامت', choose({ status: 'clear' }), 'ghost') : null,
    ),
  });
}

export function softRow(x) {
  const time = h('div', { class: 'tl-time' }, D(x.t));
  const rail = h('div', { class: 'tl-rail' }, h('span', { class: 'tl-dot' }));
  if (x.kind !== 'meal') {
    return h('div', { class: 'tl-soft tl-' + x.kind }, time, rail, h('div', { class: 'tl-body' }, `${x.emoji} ${x.label}`));
  }
  const st = x.state;
  let status = null;
  let btns;
  if (st && st.status === 'done') {
    status = h('span', { class: 'chip ok' }, '✅ خوردم');
    btns = [h('button', { class: 'mini-btn', onClick: () => openMealSheet(x) }, 'تغییر')];
  } else if (st && st.status === 'later') {
    status = h('span', { class: 'chip warn' }, st.after === 'dinner' ? '⏳ بعد از شام' : '⏳ بعد از بیدار شدن');
    btns = [h('button', { class: 'mini-btn go', onClick: () => setMeal(x.meal, { status: 'done' }) }, '✅ خوردم'), h('button', { class: 'mini-btn', onClick: () => openMealSheet(x) }, 'تغییر')];
  } else {
    btns = [h('button', { class: 'mini-btn go', onClick: () => setMeal(x.meal, { status: 'done' }) }, '✅ خوردم'), h('button', { class: 'mini-btn', onClick: () => openMealSheet(x) }, '⏳ بعداً…')];
  }
  return h('div', { class: 'tl-soft tl-meal' }, time, rail, h('div', { class: 'tl-body meal-body' }, h('span', { class: 'meal-name' }, `${x.emoji} ${x.label}`), status, h('div', { class: 'meal-btns' }, btns)));
}


// ------------------------------------------------------------------ water, exercise, sleep, energy
const FACES = ['😫', '😕', '😐', '🙂', '🤩'];
const SLOT_FA = { morning: 'صبح', afternoon: 'بعدازظهر', evening: 'شب' };

/** A small card for the body: how much water, exercise and sleep, and the energy right now. */
export function bodyCard() {
  const b = S.data.body;
  if (!b) return null;
  const apply = (r) => {
    S.data.body = r.body;
    S.stats = null;
    haptic('select');
    hooks.render();
    toastUnlocked(r.unlocked);
  };
  const save = async (patch) => {
    try {
      apply(await api('PUT', '/body', patch));
    } catch (e) {
      errorToast(e);
    }
  };
  const saveEnergy = async (energy) => {
    try {
      apply(await api('POST', '/mood', { energy }));
    } catch (e) {
      errorToast(e);
    }
  };
  const small = (label, onClick, aria) => h('button', { class: 'btn soft sm', 'aria-label': aria || label, onClick }, label);
  const cur = b.energy[b.slot];
  const sleepNow = b.sleep_hours === null ? null : Math.round(b.sleep_hours);
  return h(
    'section',
    { class: 'card body-card' },
    h('div', { class: 'card-title' }, '🌿 وضعیت امروز'),
    h('div', { class: 'small muted' }, `انرژی‌ت الان (${SLOT_FA[b.slot]}) چطوره؟`),
    h('div', { class: 'row wrap gap-s cat-row' }, FACES.map((f, i) => h('button', { class: 'chip-btn' + (cur === i + 1 ? ' on' : ''), 'aria-label': `انرژی ${i + 1} از ۵`, onClick: () => saveEnergy(i + 1) }, f))),
    h('div', { class: 'setting' }, h('div', { class: 'label' }, '💧 آب'), h('div', { class: 'row gap-s' }, small('−', () => b.water > 0 && save({ water: b.water - 1 }), 'یک لیوان کمتر'), h('b', { class: 'num' }, `${D(b.water)} لیوان`), small('+', () => save({ water: b.water + 1 }), 'یک لیوان بیشتر'))),
    h('div', { class: 'setting' }, h('div', { class: 'label' }, '🏃 ورزش'), h('div', { class: 'row gap-s' }, h('b', { class: 'num' }, b.exercise_min ? fmtMinutes(b.exercise_min) : 'ثبت نشده'), small('+۱۵', () => save({ exercise_min: Math.min(600, b.exercise_min + 15) }), '۱۵ دقیقه بیشتر'), b.exercise_min ? small('✕', () => save({ exercise_min: 0 }), 'پاک کردن') : null)),
    h('div', { class: 'small muted' }, '😴 دیشب چند ساعت خوابیدی؟'),
    h('div', { class: 'row wrap gap-s cat-row' }, [5, 6, 7, 8, 9].map((v) => h('button', { class: 'chip-btn' + (sleepNow === v ? ' on' : ''), onClick: () => save({ sleep_hours: sleepNow === v ? null : v }) }, D(v)))),
  );
}
