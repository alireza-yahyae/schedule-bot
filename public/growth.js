// Phase 2 screens: habits (daily check-ins with streaks) and grades (GPA).

import { WEEKDAYS_SHORT, enDigits, isoToJalali, weekdayOf } from './lib.js';
import { confirmSheet, emptyState, errorToast, field, h, haptic, icon, openSheet, segmented, selectEl, textInput, toast } from './ui.js';
import { D, S, api, hooks } from './core.js';
import { openExport, gradesCsv } from './exports.js';

const hdr = (title, sub) => h('div', { class: 'hdr' }, h('h1', null, title), sub ? h('div', { class: 'sub' }, sub) : null);
const fab = (label, onClick) => h('button', { class: 'fab', 'aria-label': label, onClick: () => { haptic('light'); onClick(); } }, icon('plus', 26));
const dec = (n) => D(String(Math.round(n * 100) / 100).replace('.', '٫'));

// ------------------------------------------------------------------ lazy data
function ensure(key, path, apply) {
  const loadingKey = key + 'Loading';
  const errorKey = key + 'Error';
  if (!S[key] && !S[loadingKey]) {
    S[loadingKey] = true;
    S[errorKey] = null;
    api('GET', path)
      .then((r) => { S[key] = apply(r); S[key + 'At'] = Date.now(); S[key + 'Day'] = S.data.date; })
      .catch((e) => { S[errorKey] = e.message; })
      .finally(() => { S[loadingKey] = false; if (S.tab === 'growth') hooks.render(); });
  }
  return S[key];
}
function pending(key) {
  if (S[key + 'Error']) {
    return h('div', { class: 'card' }, emptyState({ emoji: '😕', title: 'بارگذاری نشد', text: S[key + 'Error'], action: h('button', { class: 'btn soft', onClick: () => { S[key + 'Error'] = null; hooks.render(); } }, 'تلاش دوباره') }));
  }
  return h('div', { class: 'skeleton-wrap' }, h('div', { class: 'skeleton', style: { height: '120px' } }), h('div', { class: 'skeleton', style: { height: '72px' } }));
}

// ------------------------------------------------------------------ main view
export function viewGrowth() {
  // Reload habits and grades when they are older than a minute or the day changed (auto-ticks from the timer, a new "today").
  for (const key of ['habits', 'grades']) {
    if (S[key] && (Date.now() - (S[key + 'At'] || 0) > 60000 || S[key + 'Day'] !== S.data.date)) S[key] = null;
  }
  S.growthSeg = S.growthSeg || 'habits';
  const seg = segmented([{ value: 'habits', label: 'عادت‌ها' }, { value: 'progress', label: 'سطح و نشان' }, { value: 'grades', label: 'نمره‌ها' }], S.growthSeg, (v) => { S.growthSeg = v; hooks.render(); });
  const body = S.growthSeg === 'grades' ? gradesView() : S.growthSeg === 'progress' ? progressView() : habitsView();
  return h('div', { class: 'screen' }, hdr('پیشرفت'), seg.el, body);
}

// ------------------------------------------------------------------ levels and badges
function levelBar(l) {
  const pct = Math.min(100, Math.round(((l.xp - l.from_xp) / (l.to_xp - l.from_xp)) * 100));
  return h('div', { class: 'meter' }, h('i', { style: { width: pct + '%' } }));
}
const hoursOf = (m) => D(String(Math.round((m / 60) * 10) / 10).replace('.', '٫'));

function progressView() {
  // reload after every refresh of the app data (a new session may have changed the levels)
  if (S.progress && S.progressStamp !== S.data.now) S.progress = null;
  const data = ensure('progress', '/progress', (r) => { S.progressStamp = S.data.now; return r; });
  if (!data) return h('div', { class: 'list' }, pending('progress'));
  const o = data.overall;
  const unlocked = data.badges.filter((b) => b.unlocked_at).length;
  return h(
    'div',
    { class: 'list' },
    h(
      'div',
      { class: 'card form', style: { gap: '8px' } },
      h('div', { class: 'row between' }, h('b', null, `⭐ سطح ${D(o.level)}`), h('span', { class: 'small muted' }, `${hoursOf(o.xp)} ساعت فعالیت`)),
      levelBar(o),
      h('div', { class: 'xs muted' }, `تا سطح ${D(o.level + 1)}: ${hoursOf(o.to_xp - o.xp)} ساعت دیگه`),
    ),
    h('div', { class: 'section-title' }, h('span', null, 'سطح هر دسته')),
    h(
      'div',
      { class: 'card form', style: { gap: '12px' } },
      data.categories.map((c) =>
        h(
          'div',
          { class: 'form', style: { gap: '6px' } },
          h('div', { class: 'row between' }, h('span', null, `${c.icon} ${c.title}${c.is_active ? '' : ' (بایگانی)'}`), h('span', { class: 'small muted' }, `سطح ${D(c.level.level)} • ${hoursOf(c.level.xp)} ساعت`)),
          h('div', { class: 'meter', style: { '--c': c.color } }, h('i', { style: { width: Math.min(100, Math.round(((c.level.xp - c.level.from_xp) / (c.level.to_xp - c.level.from_xp)) * 100)) + '%' } })),
        ),
      ),
    ),
    h('div', { class: 'section-title' }, h('span', null, '🏅 نشان‌ها'), h('span', { class: 'small' }, `${D(unlocked)} از ${D(data.badges.length)}`)),
    h(
      'div',
      { class: 'card form', style: { gap: '12px' } },
      data.badges.map((b) =>
        h(
          'div',
          { class: 'row gap-s', style: { opacity: b.unlocked_at ? 1 : 0.55, alignItems: 'center' } },
          h('div', { style: { fontSize: '26px', width: '36px', textAlign: 'center' } }, b.unlocked_at ? b.icon : '🔒'),
          h('div', { class: 'grow' }, h('b', null, b.title), h('div', { class: 'xs muted' }, b.unlocked_at ? b.desc : `${b.desc} • ${D(b.have)} از ${D(b.need)}`)),
        ),
      ),
    ),
    h('div', { class: 'xs muted' }, 'هر دقیقه فعالیت (تایمر، ثبت دستی و پومودورو) یه امتیاز می‌گیره. سطح ۲ با ۵ ساعت، سطح ۳ با ۱۵ ساعت، سطح ۴ با ۳۰ ساعت.'),
  );
}

// ------------------------------------------------------------------ habits
function habitsView() {
  const data = ensure('habits', '/habits', (r) => r);
  const add = fab('عادت جدید', openHabitForm);
  if (!data) return h('div', { class: 'list' }, pending('habits'));
  if (data.habits.length === 0) {
    return h('div', { class: 'list' }, h('div', { class: 'card' }, emptyState({ emoji: '🌱', title: 'هنوز عادتی نداری', text: 'یه عادت کوچیک اضافه کن (مثلاً آب خوردن یا ورزش) و هر روز تیکش بزن تا زنجیره‌ش بلند بشه.' })), add);
  }
  const done = data.habits.filter((x) => x.done_today).length;
  return h(
    'div',
    { class: 'list' },
    h('div', { class: 'banner' }, icon('check', 18), `امروز ${D(done)} از ${D(data.habits.length)} عادت انجام شده.`),
    data.habits.map((x) => habitCard(x, data.dates)),
    add,
  );
}

function habitCard(x, dates) {
  const toggle = async (date) => {
    haptic('select');
    try {
      const r = await api('POST', `/habits/${x.id}/toggle`, { date });
      S.habits = { dates: r.dates, habits: r.habits };
      hooks.render();
    } catch (e) {
      errorToast(e);
    }
  };
  const cells = dates.map((iso, i) => {
    const [, , jd] = isoToJalali(iso);
    return h('button', { class: 'hday' + (x.logs[iso] ? ' on' : '') + (x.auto && x.auto[iso] ? ' auto' : '') + (i === 0 ? ' today' : ''), 'aria-label': iso, 'aria-pressed': x.logs[iso] ? 'true' : 'false', onClick: () => toggle(iso) }, h('small', null, WEEKDAYS_SHORT[weekdayOf(iso)]), h('b', { class: 'num' }, D(jd)));
  });
  const del = async () => {
    if (!(await confirmSheet({ title: 'حذف عادت؟', text: `«${x.title}» و تمام سابقه‌ش پاک می‌شه.`, confirmText: 'حذف', danger: true }))) return;
    try {
      S.habits = await api('DELETE', `/habits/${x.id}`);
      haptic('warning');
      toast('عادت حذف شد');
      hooks.render();
    } catch (e) {
      errorToast(e);
    }
  };
  return h(
    'section',
    { class: 'card habit' },
    h('div', { class: 'row between' }, h('div', { class: 'row gap-s' }, h('span', { class: 'habit-icon' }, x.icon), h('b', null, x.title)), h('button', { class: 'icon-btn', 'aria-label': 'حذف', onClick: del }, icon('trash', 18))),
    h('div', { class: 'row gap-s wrap mt' }, h('span', { class: 'chip ' + (x.streak > 0 ? 'warn' : '') }, `🔥 ${D(x.streak)} روز پشت‌سرهم`), h('span', { class: 'chip' }, `🏅 رکورد ${D(x.best)}`)),
    x.category_id && x.auto_minutes ? h('div', { class: 'xs muted mt' }, `⚡ خودکار: هر روزی که ${autoLabel(x)} بشه تیک می‌خوره`) : null,
    h('div', { class: 'hrow mt' }, cells),
  );
}

function autoLabel(x) {
  const cats = (S.data.study && S.data.study.categories) || [];
  const c = cats.find((k) => k.id === x.category_id);
  return `${c ? c.title : 'دسته'} به ${D(x.auto_minutes)} دقیقه برسه`;
}

const ICON_CHOICES = ['📚', '💧', '🏃', '😴', '🧘', '📝', '🥗', '☀️', '💊', '🚶'];
function openHabitForm() {
  let chosen = ICON_CHOICES[0];
  const cats = (S.data.study && S.data.study.categories) || [];
  let catId = null;
  const catRow = h('div', { class: 'row wrap gap-s' });
  const autoIn = textInput({ placeholder: 'مثلاً ۶۰', inputmode: 'numeric', dir: 'ltr', maxlength: 4 });
  const autoField = field('حداقل دقیقه در روز', autoIn, 'روزی که این دسته به این زمان برسه، عادت خودکار تیک می‌خوره.');
  const drawCats = () => {
    catRow.replaceChildren(...[{ id: null, icon: '', title: 'دستی' }, ...cats].map((c) => h('button', { class: 'chip-btn' + (c.id === catId ? ' on' : ''), onClick: () => { catId = c.id; drawCats(); } }, `${c.icon} ${c.title}`.trim())));
    autoField.style.display = catId === null ? 'none' : '';
  };
  const titleIn = textInput({ placeholder: 'مثلاً مطالعه‌ی نیم ساعته', maxlength: 80 });
  const iconsHost = h('div', { class: 'row wrap gap-s' });
  const drawIcons = () => iconsHost.replaceChildren(...ICON_CHOICES.map((c) => h('button', { class: 'chip-btn' + (c === chosen ? ' on' : ''), onClick: () => { chosen = c; drawIcons(); } }, c)));
  drawIcons();
  drawCats();
  const sheet = openSheet({
    title: 'عادت جدید',
    body: h('div', { class: 'form' }, field('عنوان', titleIn), field('آیکون', iconsHost), cats.length ? h('div', { class: 'field' }, h('div', { class: 'field-label' }, 'تیک خوردن'), catRow) : null, cats.length ? autoField : null),
    primary: {
      text: 'افزودن',
      onClick: async () => {
        const title = titleIn.value.trim();
        if (!title) { haptic('error'); toast('عنوان عادت لازمه', { kind: 'error' }); return; }
        sheet.setBusy(true);
        try {
          const payload = { title, icon: chosen };
          if (catId !== null) Object.assign(payload, { category_id: catId, auto_minutes: Number((autoIn.value || '0').replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))) || 0 });
          S.habits = await api('POST', '/habits', payload);
          haptic('success');
          sheet.close();
          hooks.render();
        } catch (e) {
          errorToast(e);
        }
        sheet.setBusy(false);
      },
    },
  });
}

// ------------------------------------------------------------------ grades
/** Weighted average (by units) of total scores. */
export function gpa(list) {
  const units = list.reduce((a, g) => a + g.units, 0);
  return units > 0 ? list.reduce((a, g) => a + g.total_score * g.units, 0) / units : 0;
}

function gradeChip(score) {
  const cls = score >= 17 ? 'ok' : score >= 10 ? 'info' : 'bad';
  return h('span', { class: 'chip ' + cls + ' num' }, dec(score));
}

function gradesView() {
  const data = ensure('grades', '/grades', (r) => r.grades);
  const add = fab('نمره‌ی جدید', () => openGradeForm(null));
  if (!data) return h('div', { class: 'list' }, pending('grades'));
  if (data.length === 0) {
    return h('div', { class: 'list' }, h('div', { class: 'card' }, emptyState({ emoji: '🎓', title: 'هنوز نمره‌ای ثبت نکردی', text: 'نمره‌ی درس‌ها رو اضافه کن تا معدل ترم و معدل کل خودکار حساب بشه.' })), add);
  }
  const semesters = [...new Set(data.map((g) => g.semester))].sort().reverse();
  if (!S.gradeSem || (S.gradeSem !== 'all' && !semesters.includes(S.gradeSem))) S.gradeSem = semesters[0];
  const shown = S.gradeSem === 'all' ? data : data.filter((g) => g.semester === S.gradeSem);
  const semOpts = [{ value: 'all', label: 'همه‌ی ترم‌ها' }, ...semesters.map((x) => ({ value: x, label: D(x) }))];
  const totalUnits = data.reduce((a, g) => a + g.units, 0);

  return h(
    'div',
    { class: 'list' },
    h(
      'section',
      { class: 'card' },
      h('div', { class: 'stat-grid' }, h('div', { class: 'stat' }, h('div', { class: 'v num' }, dec(gpa(shown))), h('div', { class: 'l' }, S.gradeSem === 'all' ? 'معدل کل' : 'معدل این ترم')), h('div', { class: 'stat' }, h('div', { class: 'v num' }, dec(gpa(data))), h('div', { class: 'l' }, `معدل کل (${D(totalUnits)} واحد)`))),
      h('div', { class: 'mt' }, selectEl(semOpts, S.gradeSem, (v) => { S.gradeSem = v; hooks.render(); })),
    ),
    h(
      'div',
      { class: 'card tight list' },
      shown.map((g) =>
        h(
          'button',
          { class: 'grade-row', onClick: () => openGradeForm(g) },
          h('div', { class: 'grow', style: { textAlign: 'start' } }, h('div', { class: 'bold' }, g.course_name), h('div', { class: 'xs muted num' }, `${D(g.units)} واحد • ${D(g.semester)}` + (g.midterm_score || g.final_score || g.project_score ? ` • ${dec(g.midterm_score)} + ${dec(g.final_score)} + ${dec(g.project_score)}` : ''))),
          gradeChip(g.total_score),
        ),
      ),
    ),
    h('button', { class: 'btn soft block', onClick: () => openExport({ title: 'خروجی نمره‌ها', filename: 'grades.csv', mime: 'text/csv', content: gradesCsv(data) }) }, 'خروجی CSV نمره‌ها'),
    add,
  );
}

function openGradeForm(g) {
  const editing = !!g;
  const known = S.grades && S.grades.length ? S.grades[0].semester : '1405-1';
  const num = (v) => (v ? String(v) : '');
  const nameIn = textInput({ value: g ? g.course_name : '', placeholder: 'مثلاً ریاضی ۲', maxlength: 100 });
  const semIn = textInput({ value: g ? g.semester : known, placeholder: '1405-1', maxlength: 20, dir: 'ltr' });
  const unitsIn = textInput({ value: g ? String(g.units) : '3', inputmode: 'decimal', dir: 'ltr' });
  const midIn = textInput({ value: g ? num(g.midterm_score) : '', inputmode: 'decimal', dir: 'ltr', placeholder: '0' });
  const finIn = textInput({ value: g ? num(g.final_score) : '', inputmode: 'decimal', dir: 'ltr', placeholder: '0' });
  const projIn = textInput({ value: g ? num(g.project_score) : '', inputmode: 'decimal', dir: 'ltr', placeholder: '0' });
  const totIn = textInput({ value: g ? num(g.total_score) : '', inputmode: 'decimal', dir: 'ltr', placeholder: 'از ۲۰' });
  const n = (el) => Number(enDigits(el.value.trim().replace('٫', '.').replace(',', '.')) || 0);

  const sheet = openSheet({
    title: editing ? 'ویرایش نمره' : 'نمره‌ی جدید',
    body: h(
      'div',
      { class: 'form' },
      field('نام درس', nameIn),
      h('div', { class: 'two' }, field('نیمسال', semIn), field('واحد', unitsIn)),
      h('div', { class: 'field-hint' }, 'سهم هر بخش از ۲۰ رو بنویس؛ مثلاً میانترم ۸ + پایان‌ترم ۹ + پروژه ۲. اگر پُرشون کنی جمعشون نمره‌ی کل می‌شه.'),
      h('div', { class: 'two' }, field('میانترم', midIn), field('پایان‌ترم', finIn)),
      h('div', { class: 'two' }, field('پروژه', projIn), field('نمره‌ی کل', totIn, 'اگه بخش‌ها خالیه')),
      editing ? h('button', { class: 'btn danger-soft block', onClick: del }, icon('trash', 18), 'حذف نمره') : null,
    ),
    primary: { text: editing ? 'ذخیره' : 'افزودن', onClick: save },
  });

  async function del() {
    if (!(await confirmSheet({ title: 'حذف نمره؟', text: `«${g.course_name}»`, confirmText: 'حذف', danger: true }))) return;
    try {
      await api('DELETE', `/grades/${g.id}`);
      S.grades = null;
      haptic('warning');
      sheet.close();
      hooks.render();
    } catch (e) {
      errorToast(e);
    }
  }

  async function save() {
    const body = { course_name: nameIn.value.trim(), semester: enDigits(semIn.value.trim()), units: n(unitsIn), midterm_score: n(midIn), final_score: n(finIn), project_score: n(projIn), total_score: n(totIn) };
    if (!body.course_name) { haptic('error'); toast('نام درس لازمه', { kind: 'error' }); return; }
    sheet.setBusy(true);
    try {
      if (editing) await api('PUT', `/grades/${g.id}`, body);
      else await api('POST', '/grades', body);
      S.grades = null; // reload
      haptic('success');
      toast('ذخیره شد ✓');
      sheet.close();
      hooks.render();
    } catch (e) {
      errorToast(e);
    }
    sheet.setBusy(false);
  }
}
