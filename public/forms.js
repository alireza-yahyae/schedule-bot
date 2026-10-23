// Bottom sheets and forms.

import { WEEKDAYS, absenceLevel, clock, daysBetween, enDigits, jalaliSlash, jalaliText, weekdayOf } from './lib.js';
import {
  confirmSheet, errorToast, field, h, haptic, icon, jalaliPicker, openSheet, ring, segmented, selectEl, stepper, switchEl,
  textArea, textInput, toast,
} from './ui.js';
import { COURSE_COLORS, D, S, act, api, courseById, focusFinishIfDone, getFocus, hooks, refresh, saveSetting, setFocus } from './core.js';
import { openPasteSchedule } from './exports.js';

/** A short checklist of things people often forget when they type their timetable. */
export const GAP_ITEMS = [
  'درس‌هایی که هنوز اضافه نکردی',
  'جلسه‌های اضافه مثل آزمایشگاه یا کارگاه',
  'ساعت و مکان دقیق هر کلاس',
  'تعداد واحد هر درس',
];

// ------------------------------------------------------------------ class actions
export function openSkipSheet(occ) {
  const area = textArea({ placeholder: 'دلیلت رو بنویس (اختیاری)', rows: 3, maxlength: 300 });
  const quick = ['مریضم', 'کار فوری دارم', 'خوابم برد', 'ترافیک', 'مشکل شخصی'];
  async function submit(reason) {
    sheet.setBusy(true);
    const ok = await act(occ, 'skip', reason.trim() || undefined);
    sheet.setBusy(false);
    if (ok) sheet.close();
  }
  const sheet = openSheet({
    title: 'چرا نمی‌ری؟',
    body: h(
      'div',
      { class: 'form' },
      h('div', { class: 'muted small' }, occ.title),
      h('div', { class: 'row wrap gap-s' }, quick.map((q) => h('button', { class: 'chip-btn', onClick: () => { area.value = q; haptic('select'); } }, q))),
      field('دلیل', area),
      h('button', { class: 'btn ghost block', onClick: () => submit('') }, 'بدون دلیل ثبت کن'),
    ),
    primary: { text: 'ثبت: نمی‌رم', danger: true, onClick: () => submit(area.value) },
  });
}

export function openActionSheet(occ) {
  const run = async (action) => {
    sheet.close();
    if (action === 'skip') openSkipSheet(occ);
    else await act(occ, action);
  };
  const btn = (action, label, cls) => h('button', { class: 'btn block ' + cls, onClick: () => run(action) }, label);
  const sheet = openSheet({
    title: occ.title,
    body: h(
      'div',
      { class: 'form' },
      btn('went', '✅ رفتم', 'soft'),
      btn('cancel', '🚫 کلاس برگزار نشد', 'soft'),
      btn('skip', '❌ نمی‌رم', 'danger-soft'),
      btn('reopen', '↩︎ برگردون به حالت اول', 'ghost'),
    ),
  });
}

// ------------------------------------------------------------------ course detail
export function openCourseDetail(courseId) {
  const c = courseById(courseId);
  if (!c) return;
  const counts = c.counts || {};
  const absences = (counts.skipped || 0) + (counts.no_response || 0);
  const level = absenceLevel(absences, c.allowed_absences ?? 3);
  const levelChip = { ok: ['ok', 'در محدوده‌ی مجاز'], warn: ['warn', 'یکی تا سقف غیبت'], limit: ['warn', 'به سقف غیبت رسیدی'], over: ['bad', 'از سقف غیبت رد شدی'] }[level];

  const rows = [];
  const kv = (label, value) => (value ? h('div', { class: 'row between' }, h('span', { class: 'muted' }, label), h('b', null, value)) : null);
  rows.push(kv('گروه', c.group_no ? D(c.group_no) : ''), kv('استاد', c.teacher), kv('مکان', c.location), kv('تعداد واحد', c.units ? D(c.units) : ''));

  const sess = c.sessions.length
    ? c.sessions.map((s) => h('div', { class: 'row between' }, h('span', null, WEEKDAYS[s.weekday]), h('b', { class: 'num' }, `${D(s.start_time)} تا ${D(s.end_time)}`)))
    : [h('div', { class: 'muted small' }, 'هنوز جلسه‌ای ثبت نشده.')];

  let exam = null;
  if (c.exam_date) {
    const left = daysBetween(S.data.date, c.exam_date);
    exam = h(
      'div',
      { class: 'card flat' },
      h('div', { class: 'row between' }, h('b', null, '🗓 امتحان'), h('span', { class: 'chip ' + (left < 0 ? '' : left <= 7 ? 'bad' : 'info') }, left < 0 ? 'گذشته' : left === 0 ? 'امروز!' : `${D(left)} روز مانده`)),
      h('div', { class: 'small muted mt' }, `${WEEKDAYS[weekdayOf(c.exam_date)]} ${jalaliText(c.exam_date, D)} • ${c.exam_date}`),
      c.exam_start ? h('div', { class: 'small' }, `ساعت ${D(c.exam_start)}${c.exam_end ? ' تا ' + D(c.exam_end) : ''}${c.exam_location ? ' • ' + c.exam_location : ''}`) : null,
    );
  }

  const sheet = openSheet({
    title: c.name,
    body: h(
      'div',
      { class: 'form' },
      h('div', { class: 'card flat', style: { '--c': c.color } }, h('div', { class: 'form' }, rows)),
      h('div', { class: 'card flat' }, h('b', null, 'جلسه‌های هفتگی'), h('div', { class: 'form mt' }, sess)),
      exam,
      h(
        'div',
        { class: 'card flat' },
        h('div', { class: 'row between' }, h('b', null, 'حضور و غیاب'), h('span', { class: 'chip ' + levelChip[0] }, levelChip[1])),
        h('div', { class: 'small muted mt' }, `رفتم: ${D(counts.attended || 0)} • غیبت: ${D(absences)} از ${D(c.allowed_absences ?? 3)} مجاز • برگزار نشد: ${D(counts.cancelled || 0)}`),
      ),
    ),
    primary: { text: 'ویرایش درس', onClick: () => { sheet.close(); openCourseForm(c); } },
  });
}

// ------------------------------------------------------------------ course form
export function openCourseForm(course, opts = {}) {
  const editing = !!course;
  let kind = course ? course.kind || 'class' : opts.kind === 'work' ? 'work' : 'class';
  let color = (course && course.color) || COURSE_COLORS[0];
  const sessions = course ? course.sessions.map((s) => ({ ...s, location: s.location || '' })) : [{ id: null, weekday: 0, start_time: '09:00', end_time: '10:30', location: '', kind: 'class' }];

  const nameIn = textInput({ value: course ? course.name : '', placeholder: kind === 'work' ? 'مثلاً شیفت صبح، جلسه‌ی تیم' : 'مثلاً آیرودینامیک ۱', maxlength: 100 });
  const groupIn = textInput({ value: course && course.group_no ? D(course.group_no) : '', placeholder: 'مثلاً ۸۲', inputmode: 'numeric', maxlength: 20 });
  const unitsIn = textInput({ value: course && course.units ? D(course.units) : '', placeholder: 'مثلاً ۳', inputmode: 'decimal', maxlength: 4 });
  const teacherIn = textInput({ value: (course && course.teacher) || '', placeholder: 'اختیاری', maxlength: 100 });
  const locIn = textInput({ value: (course && course.location) || '', placeholder: 'مثلاً دانشکده هوافضا، کلاس ۲۰۴', maxlength: 100 });
  const notesIn = textArea({ value: (course && course.notes) || '', placeholder: 'اختیاری', rows: 2, maxlength: 500 });

  const swatchHost = h('div', { class: 'swatches' });
  const drawSwatches = () =>
    swatchHost.replaceChildren(
      ...COURSE_COLORS.map((c) =>
        h('button', { class: 'swatch' + (c === color ? ' on' : ''), style: { '--c': c }, 'aria-label': 'رنگ ' + c, onClick: () => { color = c; haptic('select'); drawSwatches(); } }, c === color ? icon('check', 18) : null),
      ),
    );
  drawSwatches();

  const sessHost = h('div', { class: 'form' });
  function sessionRow(s, i) {
    const wd = selectEl(WEEKDAYS.map((n, k) => ({ value: k, label: n })), s.weekday, (v) => { s.weekday = Number(v); });
    const st = textInput({ type: 'time', value: s.start_time });
    const en = textInput({ type: 'time', value: s.end_time });
    st.addEventListener('input', () => { s.start_time = st.value; });
    en.addEventListener('input', () => { s.end_time = en.value; });
    const loc = textInput({ value: s.location, placeholder: 'اگه با مکان درس فرق داره', maxlength: 100 });
    loc.addEventListener('input', () => { s.location = loc.value; });
    const kindSel = selectEl([{ value: 'class', label: 'کلاس' }, { value: 'lab', label: 'آزمایشگاه' }, { value: 'workshop', label: 'کارگاه' }], s.kind || 'class', (v) => { s.kind = v; });
    return h(
      'div',
      { class: 'sess' },
      h('div', { class: 'row between' }, h('b', null, `جلسه‌ی ${D(i + 1)}`), h('button', { class: 'icon-btn', 'aria-label': 'حذف جلسه', onClick: () => { sessions.splice(i, 1); drawSessions(); } }, icon('trash', 18))),
      field('روز هفته', wd),
      h('div', { class: 'two' }, field('شروع', st), field('پایان', en)),
      field('مکان این جلسه', loc),
      kind === 'work' ? null : field('نوع', kindSel),
    );
  }
  const drawSessions = () => {
    sessHost.replaceChildren(
      ...sessions.map(sessionRow),
      h('button', { class: 'btn soft block', onClick: () => { sessions.push({ id: null, weekday: 0, start_time: '09:00', end_time: '10:30', location: '', kind: 'class' }); drawSessions(); } }, icon('plus', 18), 'افزودن جلسه'),
    );
  };
  drawSessions();

  // exam
  let hasExam = !!(course && course.exam_date);
  let ex = null;
  const examHost = h('div', { class: 'form' });
  const drawExam = () => {
    if (!hasExam) { examHost.replaceChildren(); ex = null; return; }
    const picker = jalaliPicker({ iso: course && course.exam_date ? course.exam_date : S.data.date, todayIso: S.data.date, D });
    const st = textInput({ type: 'time', value: (course && course.exam_start) || '08:00' });
    const en = textInput({ type: 'time', value: (course && course.exam_end) || '10:30' });
    const loc = textInput({ value: (course && course.exam_location) || '', placeholder: 'مثلاً سالن', maxlength: 100 });
    ex = { picker, st, en, loc };
    examHost.replaceChildren(field('تاریخ امتحان (شمسی)', picker.el), h('div', { class: 'two' }, field('شروع', st), field('پایان', en)), field('مکان امتحان', loc));
  };
  const examSwitch = switchEl(hasExam, (on) => { hasExam = on; drawExam(); });
  drawExam();

  // advanced
  const offsetsIn = textInput({ value: (course && course.offsets) ? D(course.offsets) : '', placeholder: 'خالی = تنظیم کلی (مثلاً ۱۵،۱۰)', inputmode: 'numeric' });
  const nagIn = textInput({ value: course && course.nag_interval_min ? D(course.nag_interval_min) : '', placeholder: 'خالی = تنظیم کلی', inputmode: 'numeric', maxlength: 3 });
  let notify = course ? course.notify_partner !== 0 : true;
  let allowed = course && course.allowed_absences !== undefined ? course.allowed_absences : 3;
  const advHost = h('div', { class: 'form' });
  let advOpen = false;
  const advBtn = h('button', { class: 'btn ghost block', onClick: () => { advOpen = !advOpen; drawAdv(); } }, 'تنظیمات پیشرفته');
  const drawAdv = () => {
    advBtn.textContent = advOpen ? 'بستن تنظیمات پیشرفته' : 'تنظیمات پیشرفته';
    advHost.replaceChildren(
      ...(advOpen
        ? [
            field('یادآوری‌ها (دقیقه قبل از کلاس)', offsetsIn, 'با ویرگول جدا کن. اگه فقط ۰ بنویسی یادآوری قبل از کلاس نمیاد.'),
            field('فاصله‌ی یادآوری تکراری (دقیقه)', nagIn),
            kind === 'work' ? null : h('div', { class: 'setting' }, h('div', null, h('div', { class: 'label' }, 'غیبت مجاز'), h('div', { class: 'desc' }, 'یکی مونده به سقف و خود سقف بهت هشدار می‌دم')), stepper(allowed, 0, 30, (v) => { allowed = v; }, D)),
            
          ]
        : []),
    );
  };

  // a class has a group, units, a teacher and an exam; a work event does not
  const groupUnits = h('div', { class: 'two' }, field('گروه', groupIn), field('تعداد واحد', unitsIn));
  const teacherField = field('استاد', teacherIn);
  const examSetting = h('div', { class: 'setting' }, h('div', null, h('div', { class: 'label' }, 'امتحان دارد'), h('div', { class: 'desc' }, 'یادآوری ۷ روز، ۳ روز، ۱ روز و صبح امتحان')), examSwitch);
  const classOnly = [groupUnits, teacherField, examSetting, examHost];
  const applyKind = () => {
    for (const el of classOnly) el.style.display = kind === 'work' ? 'none' : '';
    nameIn.placeholder = kind === 'work' ? 'مثلاً شیفت صبح، جلسه‌ی تیم' : 'مثلاً آیرودینامیک ۱';
    drawSessions();
    drawAdv();
  };
  const kindSeg = segmented([{ value: 'class', label: '🎓 کلاس' }, { value: 'work', label: '💼 کار' }], kind, (v) => { kind = v; applyKind(); });

  const sheet = openSheet({
    title: editing ? 'ویرایش برنامه' : 'برنامه‌ی جدید',
    full: true,
    body: h(
      'div',
      { class: 'form' },
      editing ? null : h('button', { class: 'btn soft block sm', onClick: () => { sheet.close(); openPasteSchedule(); } }, '✨ چند درس یکجا با هوش مصنوعی'),
      kindSeg.el,
      field('نام', nameIn),
      groupUnits,
      teacherField,
      field('مکان', locIn),
      field('رنگ', swatchHost),
      h('div', { class: 'section-title' }, h('span', null, 'جلسه‌های هفتگی')),
      sessHost,
      examSetting,
      examHost,
      field('یادداشت', notesIn),
      advBtn,
      advHost,
      editing ? h('button', { class: 'btn danger-soft block', onClick: del }, icon('trash', 18), 'حذف درس') : null,
    ),
    primary: { text: editing ? 'ذخیره' : 'افزودن', onClick: save },
  });
  applyKind();

  async function del() {
    const ok = await confirmSheet({
      title: 'حذف درس؟',
      text: `«${course.name}» از برنامه حذف می‌شه. تاریخچه‌ی حضور و غیابش می‌مونه و می‌تونی بلافاصله با «برگردان» پسش بگیری.`,
      confirmText: 'حذف',
      danger: true,
    });
    if (!ok) return;
    try {
      await api('DELETE', `/courses/${course.id}`);
      S.stats = null;
      await refresh();
      sheet.close();
      haptic('warning');
      toast('درس حذف شد', {
        undo: async () => {
          try {
            await api('POST', `/courses/${course.id}/restore`);
            await refresh();
          } catch (e) {
            errorToast(e);
          }
        },
      });
    } catch (e) {
      errorToast(e);
    }
  }

  async function save() {
    const name = nameIn.value.trim();
    const bad = (msg) => { haptic('error'); toast(msg, { kind: 'error' }); };
    if (!name) return bad(kind === 'work' ? 'نام برنامه لازمه' : 'نام درس لازمه');
    for (const s of sessions) {
      if (!s.start_time || !s.end_time) return bad('ساعت شروع و پایان همه‌ی جلسه‌ها رو پر کن');
      if (s.end_time <= s.start_time) return bad('ساعت پایان باید بعد از شروع باشه');
    }
    const units = enDigits(unitsIn.value).trim();
    const payload = {
      name,
      group_no: enDigits(groupIn.value).trim() || null,
      teacher: teacherIn.value.trim() || null,
      location: locIn.value.trim() || null,
      units: units === '' ? null : Number(units),
      color,
      notes: notesIn.value.trim() || null,
      offsets: enDigits(offsetsIn.value).replace(/[،؛]/g, ',').trim() || null,
      nag_interval_min: enDigits(nagIn.value).trim() || null,
      notify_partner: notify,
      allowed_absences: allowed,
      kind,
      sessions: sessions.map((s) => ({ id: s.id || null, weekday: s.weekday, start_time: s.start_time, end_time: s.end_time, location: s.location.trim() || null, kind: kind === 'work' ? 'class' : s.kind || 'class' })),
    };
    if (kind === 'class' && hasExam && ex) {
      const iso = ex.picker.getIso();
      payload.exam_date_j = jalaliSlash(iso);
      payload.exam_start = ex.st.value || null;
      payload.exam_end = ex.en.value || null;
      payload.exam_location = ex.loc.value.trim() || null;
    }
    sheet.setBusy(true);
    try {
      if (editing) await api('PUT', `/courses/${course.id}`, payload);
      else await api('POST', '/courses', payload);
      S.stats = null;
      await refresh();
      sheet.close();
      haptic('success');
      toast(kind === 'work' ? 'برنامه ذخیره شد ✓' : 'درس ذخیره شد ✓');
      const conflict = S.data.conflicts.find((c) => c.a.name === name || c.b.name === name);
      if (conflict) toast(`⚠️ تداخل: «${conflict.a.name}» و «${conflict.b.name}» روز ${WEEKDAYS[conflict.weekday]} هم‌زمانن`, { kind: 'error', ms: 6000 });
    } catch (e) {
      errorToast(e);
    }
    sheet.setBusy(false);
  }
}

// ------------------------------------------------------------------ task form
export function openTaskForm(task) {
  const editing = !!task;
  const titleIn = textInput({ value: task ? task.title : '', placeholder: 'مثلاً تمرین سری ۳', maxlength: 200 });
  const courseSel = selectEl([{ value: '', label: 'بدون درس' }, ...S.data.courses.filter((c) => c.kind !== 'work').map((c) => ({ value: c.id, label: c.name }))], task && task.course_id ? task.course_id : '', () => {});
  // category (study, work, ...), time estimate and repeat
  const cats = (S.data.study && S.data.study.categories) || [];
  let catId = task && task.category_id ? task.category_id : null;
  const catRow = h('div', { class: 'row wrap gap-s' });
  const drawCats = () =>
    catRow.replaceChildren(
      ...[{ id: null, icon: '', title: 'بدون دسته', color: null }, ...cats].map((c) =>
        h('button', { class: 'chip-btn' + (c.id === catId ? ' on' : ''), style: c.id === catId && c.color ? { borderColor: c.color } : {}, onClick: () => { catId = c.id; haptic('select'); drawCats(); } }, `${c.icon} ${c.title}`.trim()),
      ),
    );
  drawCats();
  const estIn = textInput({ value: task && task.estimate_min ? String(task.estimate_min) : '', inputmode: 'numeric', dir: 'ltr', placeholder: 'مثلاً ۹۰', maxlength: 4 });
  const repeatSel = selectEl([{ value: '', label: 'تکرار نمی‌شه' }, { value: 'daily', label: 'هر روز' }, { value: 'weekly', label: 'هر هفته' }, { value: 'monthly', label: 'هر ۳۰ روز' }], (task && task.repeat) || '', () => {});
  let hasDue = !!(task && task.due_date);
  let picker = null;
  const timeIn = textInput({ type: 'time', value: (task && task.due_time) || '' });
  const dueHost = h('div', { class: 'form' });
  const drawDue = () => {
    if (!hasDue) { dueHost.replaceChildren(); picker = null; return; }
    picker = jalaliPicker({ iso: task && task.due_date ? task.due_date : S.data.date, todayIso: S.data.date, D });
    dueHost.replaceChildren(field('موعد (شمسی)', picker.el), field('ساعت (اختیاری)', timeIn));
  };
  const dueSwitch = switchEl(hasDue, (on) => { hasDue = on; drawDue(); });
  drawDue();
  const prio = segmented([{ value: 0, label: 'کم' }, { value: 1, label: 'عادی' }, { value: 2, label: 'زیاد' }], task ? task.priority : 1, () => {});
  const notesIn = textArea({ value: (task && task.notes) || '', placeholder: 'اختیاری', rows: 2, maxlength: 500 });

  const sheet = openSheet({
    title: editing ? 'ویرایش کار' : 'کار جدید',
    body: h(
      'div',
      { class: 'form' },
      field('عنوان', titleIn),
      cats.length ? h('div', { class: 'field' }, h('div', { class: 'field-label' }, 'دسته'), catRow) : null,
      field('درس', courseSel),
      field('تخمین زمان (دقیقه)', estIn, 'اختیاری. زمان واقعی با تایمر کنارش نشون داده می‌شه.'),
      h('div', { class: 'setting' }, h('div', { class: 'label' }, 'موعد دارد'), dueSwitch),
      dueHost,
      field('تکرار', repeatSel, 'برای کار تکراری موعد لازمه؛ وقتی انجامش بدی، نسخه‌ی بعدی خودش ساخته می‌شه.'),
      field('اولویت', prio.el),
      field('یادداشت', notesIn),
      editing ? h('button', { class: 'btn danger-soft block', onClick: del }, icon('trash', 18), 'حذف کار') : null,
    ),
    primary: { text: editing ? 'ذخیره' : 'افزودن کار', onClick: save },
  });

  async function del() {
    try {
      await api('DELETE', `/tasks/${task.id}`);
      await refresh();
      sheet.close();
      haptic('warning');
      toast('کار حذف شد', { undo: async () => { try { await api('POST', `/tasks/${task.id}/restore`); await refresh(); } catch (e) { errorToast(e); } } });
    } catch (e) {
      errorToast(e);
    }
  }

  async function save() {
    const title = titleIn.value.trim();
    if (!title) { haptic('error'); toast('عنوان کار لازمه', { kind: 'error' }); return; }
    const payload = {
      title,
      course_id: courseSel.value ? Number(courseSel.value) : null,
      category_id: catId,
      estimate_min: Number(enDigits(estIn.value).trim()) || null,
      repeat: repeatSel.value || null,
      due_date: hasDue && picker ? picker.getIso() : null,
      due_time: hasDue && timeIn.value ? timeIn.value : null,
      priority: prio.get(),
      notes: notesIn.value.trim() || null,
    };
    sheet.setBusy(true);
    try {
      if (editing) await api('PUT', `/tasks/${task.id}`, payload);
      else await api('POST', '/tasks', payload);
      await refresh();
      sheet.close();
      haptic('success');
      toast('ذخیره شد ✓');
    } catch (e) {
      errorToast(e);
    }
    sheet.setBusy(false);
  }
}

// ------------------------------------------------------------------ focus (Pomodoro)
export function openFocus() {
  const cats = (S.data.study && S.data.study.categories) || [];
  const general = Number(S.data.settings.focus_minutes || 25);
  const generalBreak = Number(S.data.settings.break_minutes || 5);
  // the category used last is the default; its own focus length (if set) wins over the general one
  let cat = cats.find((c) => c.id === (S.data.study && S.data.study.last_category_id)) || cats[0] || null;
  let minutes = (cat && cat.focus_minutes) || general;
  let courseId = '';
  const ringHost = h('div');
  const controls = h('div', { class: 'form', style: { width: '100%' } });
  const courseSel = selectEl([{ value: '', label: 'بدون درس مشخص' }, ...S.data.courses.filter((c) => c.kind !== 'work').map((c) => ({ value: c.id, label: c.name }))], '', (v) => { courseId = v; });

  const drawRing = () => {
    const f = getFocus();
    const total = (f ? f.minutes : minutes) * 60;
    const left = f ? Math.max(0, total - (Date.now() - f.start) / 1000) : total;
    ringHost.replaceChildren(ring({ value: f ? 1 - left / total : 0, size: 220, stroke: 14, label: clock(left, D), sub: f ? 'در حال تمرکز…' : `${D(minutes)} دقیقه` }));
  };
  const drawControls = () => {
    const f = getFocus();
    if (f) {
      controls.replaceChildren(h('button', { class: 'btn danger-soft block', onClick: () => { setFocus(null); haptic('warning'); toast('تمرکز متوقف شد'); drawControls(); drawRing(); hooks.render(); } }, icon('x', 18), 'متوقف کن'));
      return;
    }
    const lengths = [...new Set([15, 25, 45, 60, 90, minutes])].sort((x, y) => x - y);
    controls.replaceChildren(
      cats.length > 1
        ? h(
            'div',
            { class: 'row wrap gap-s cat-row' },
            cats.map((c) =>
              h('button', { class: 'chip-btn cat-chip' + (cat && c.id === cat.id ? ' on' : ''), style: cat && c.id === cat.id ? { borderColor: c.color } : {}, onClick: () => { cat = c; minutes = c.focus_minutes || general; haptic('select'); drawControls(); drawRing(); } }, `${c.icon} ${c.title}`),
            ),
          )
        : null,
      h('div', { class: 'row wrap gap-s' }, lengths.map((v) => h('button', { class: 'chip-btn' + (v === minutes ? ' on' : ''), onClick: () => { minutes = v; haptic('select'); drawControls(); drawRing(); } }, `${D(v)} دقیقه`))),
      field('روی چه درسی؟ (اختیاری)', courseSel),
      h(
        'button',
        {
          class: 'btn primary block',
          onClick: () => {
            setFocus({ start: Date.now(), minutes, courseId: courseId ? Number(courseId) : null, categoryId: cat ? cat.id : null, breakMinutes: (cat && cat.break_minutes) || generalBreak });
            haptic('medium');
            drawControls();
            drawRing();
            hooks.render();
          },
        },
        icon('play', 18),
        'شروع تمرکز',
      ),
    );
  };
  drawRing();
  drawControls();
  const timer = setInterval(async () => {
    drawRing();
    if (await focusFinishIfDone()) { drawControls(); drawRing(); }
  }, 500);
  openSheet({
    title: 'تمرکز',
    body: h('div', { class: 'focus-wrap' }, ringHost, controls, h('div', { class: 'muted small center' }, 'تا تموم نشه، موبایلت رو کنار بذار 📵. مدت پیش‌فرض هر دسته رو از ⚙️ توی کارت امروز می‌تونی عوض کنی.')),
    onClose: () => clearInterval(timer),
  });
}

// ------------------------------------------------------------------ message texts editor
export async function openTextsEditor() {
  let texts;
  try {
    texts = (await api('GET', '/texts')).texts;
  } catch (e) {
    errorToast(e);
    return;
  }
  const list = h('div', { class: 'list' });
  const draw = () => {
    list.replaceChildren(
      ...texts.map((t) =>
        h(
          'button',
          { class: 'card flat tight', style: { textAlign: 'start' }, onClick: () => edit(t) },
          h('div', { class: 'row between' }, h('b', null, t.description || t.key), icon('edit', 16)),
          h('div', { class: 'small muted ellipsis' }, t.text.replace(/\n/g, ' ')),
        ),
      ),
    );
  };
  const edit = (t) => {
    const area = textArea({ value: t.text, rows: 7, maxlength: 2000 });
    const vars = [...new Set((t.text.match(/\{\w+\}/g) || []))];
    const sh = openSheet({
      title: t.description || t.key,
      body: h('div', { class: 'form' }, field('متن', area, vars.length ? 'متغیرها (دست نزن): ' + vars.join(' ') : undefined), h('div', { class: 'muted xs' }, 'می‌تونی از <b>، <i> و <code> هم استفاده کنی.')),
      primary: {
        text: 'ذخیره',
        onClick: async () => {
          const text = area.value.trim();
          if (!text) { toast('متن نمی‌تونه خالی باشه', { kind: 'error' }); return; }
          sh.setBusy(true);
          try {
            await api('PUT', `/texts/${encodeURIComponent(t.key)}`, { text });
            t.text = text;
            draw();
            sh.close();
            haptic('success');
            toast('ذخیره شد ✓');
          } catch (e) {
            errorToast(e);
          }
          sh.setBusy(false);
        },
      },
    });
  };
  draw();
  openSheet({ title: 'متن پیام‌ها و دکمه‌ها', full: true, body: h('div', { class: 'form' }, h('div', { class: 'muted small' }, 'همه‌ی پیام‌هایی که ربات برات می‌فرسته از همین متن‌ها ساخته می‌شن.'), list) });
}

// ------------------------------------------------------------------ tutorial + onboarding
export function openTutorial() {
  const slides = [
    ['📅', 'امروز', 'کلاس بعدی با شمارش معکوس، خط زمانی روز و دکمه‌های «رفتم»، «برگزار نشد» و «نمی‌رم». هر کاری رو با «برگردان» می‌تونی پس بگیری.'],
    ['🗓', 'هفته', 'جدول هفتگی با رنگ هر درس. روی درس بزن تا جزئیاتش رو ببینی و نگه دار تا ویرایش بشه. علامت ⚠️ یعنی دو کلاس با هم تداخل دارن.'],
    ['📊', 'آمار', 'درصد حضور، غیبت مجاز هر درس، رکورد پشت‌سرهم رفتن و دقیقه‌های تمرکز هر هفته.'],
    ['🔔', 'ربات', 'تلگرام قبل از هر کلاس بهت پیام می‌ده و تا جواب ندی دست‌بردار نیست. تنظیم‌هاش با تنظیمات همین برنامه عوض می‌شه.'],
  ];
  let i = 0;
  const body = h('div', { class: 'form' });
  const sheet = openSheet({ title: 'آموزش کوتاه', body });
  const draw = () => {
    const [emoji, title, text] = slides[i];
    body.replaceChildren(
      h('div', { class: 'steps' }, slides.map((_, k) => h('i', { class: k === i ? 'on' : '' }))),
      h('div', { class: 'hero-emoji' }, emoji),
      h('div', { class: 'slide-title' }, title),
      h('div', { class: 'slide-text' }, text),
      h('button', { class: 'btn primary block', onClick: () => { if (i < slides.length - 1) { i++; haptic('select'); draw(); } else sheet.close(); } }, i < slides.length - 1 ? 'بعدی' : 'شروع'),
    );
  };
  draw();
}

const TZ_CHOICES = [['Asia/Tehran', 'تهران'], ['Europe/Istanbul', 'استانبول'], ['Asia/Dubai', 'دبی'], ['Europe/Berlin', 'برلین'], ['Europe/London', 'لندن'], ['America/New_York', 'نیویورک'], ['UTC', 'UTC']];
export function timezoneOptions(current) {
  const opts = TZ_CHOICES.map(([value, label]) => ({ value, label: `${label} (${value})` }));
  if (!opts.some((o) => o.value === current)) opts.unshift({ value: current, label: current });
  return opts;
}

export function openOnboarding() {
  const st = {
    timezone: S.data.settings.timezone || 'Asia/Tehran',
    weekend: (S.data.settings.weekend_days || '6').split(',').filter(Boolean).map(Number),
    lunch: S.data.settings.lunch_time || '13:00',
    dinner: S.data.settings.dinner_time || '20:00',
    sleep: S.data.settings.sleep_time || '23:30',
    wake: S.data.settings.wake_time || '07:00',
  };
  let step = 0;
  const TOTAL = 5;
  const body = h('div', { class: 'form' });

  const finish = async (skipAll) => {
    const patch = skipAll
      ? { onboarded: '1' }
      : { timezone: st.timezone, weekend_days: st.weekend.join(','), lunch_time: st.lunch, dinner_time: st.dinner, sleep_time: st.sleep, wake_time: st.wake, onboarded: '1' };
    const ok = await saveSetting(patch, { quiet: true });
    if (!ok) return;
    sheet.close();
    hooks.render();
    if (!skipAll) openTutorial();
  };

  const timeField = (label, key) => {
    const el = textInput({ type: 'time', value: st[key] });
    el.addEventListener('input', () => { if (el.value) st[key] = el.value; });
    return field(label, el);
  };

  const pages = [
    () => {
      const weekendHost = h('div', { class: 'row wrap gap-s' });
      const drawWeekend = () => weekendHost.replaceChildren(...WEEKDAYS.map((n, k) => h('button', { class: 'chip-btn' + (st.weekend.includes(k) ? ' on' : ''), onClick: () => { st.weekend = st.weekend.includes(k) ? st.weekend.filter((x) => x !== k) : [...st.weekend, k].sort(); haptic('select'); drawWeekend(); } }, n)));
      drawWeekend();
      return [h('div', { class: 'hero-emoji' }, '👋'), h('div', { class: 'slide-title' }, 'خوش اومدی!'), h('div', { class: 'slide-text' }, 'چند تا سؤال کوتاه تا ربات دقیقاً برای خودت تنظیم بشه. همه‌ش قابل تغییره.'), field('منطقه‌ی زمانی', selectEl(timezoneOptions(st.timezone), st.timezone, (v) => { st.timezone = v; }))];
    },
    () => [h('div', { class: 'hero-emoji' }, '🍽'), h('div', { class: 'slide-title' }, 'وعده‌های غذایی'), h('div', { class: 'slide-text' }, 'این ساعت‌ها توی برنامه‌ی روزانه‌ات نشون داده می‌شن.'), timeField('ناهار', 'lunch'), timeField('شام', 'dinner')],
    () => [h('div', { class: 'hero-emoji' }, '🌙'), h('div', { class: 'slide-title' }, 'خواب'), h('div', { class: 'slide-text' }, 'از این دو ساعت برای ریتم روزانه‌ات (بیداری و خواب) استفاده می‌کنم. اگه یه روز یا بازه‌ای می‌خوای ربات ساکت باشه، از «روزهای خاص» تنظیمش کن.'), timeField('ساعت خواب', 'sleep'), timeField('ساعت بیدار شدن', 'wake')],
    () => [
      h('div', { class: 'hero-emoji' }, '🧩'),
      h('div', { class: 'slide-title' }, 'برنامه‌ات کامله؟'),
      h('div', { class: 'slide-text' }, `${D(S.data.courses.filter((c) => c.kind !== 'work').length)} درس توی برنامه‌ات هست. یه نگاه بنداز ببین چیزی از این‌ها جا نیفتاده باشه:`),
      h('ul', { class: 'plain small gaps' }, GAP_ITEMS.map((t) => h('li', null, t))),
      h('button', { class: 'btn soft block', onClick: () => openCourseForm(null) }, icon('plus', 18), 'افزودن درس'),
    h('button', { class: 'btn soft block', onClick: () => openCourseForm(null, { kind: 'work' }) }, icon('plus', 18), 'افزودن برنامه‌ی کاری'),
      h('div', { class: 'muted xs center' }, 'هر وقت خواستی از تب «هفته» هم می‌تونی اضافه یا ویرایش کنی.'),
    ],
    () => [h('div', { class: 'hero-emoji' }, '💌'), h('div', { class: 'slide-title' }, 'پارتنر'), h('div', { class: 'slide-text' }, 'اگه خواستی، بعداً از تب «پیام‌ها» لینک دعوت بسازی تا یه نفر بتونه پیام‌های خودکار بگیره. فعلاً چیزی لازم نیست انجام بدی.')],
  ];

  const draw = () => {
    body.replaceChildren(
      h('div', { class: 'steps' }, Array.from({ length: TOTAL }, (_, k) => h('i', { class: k === step ? 'on' : '' }))),
      ...pages[step](),
      h(
        'div',
        { class: 'row mt' },
        step > 0 ? h('button', { class: 'btn ghost', onClick: () => { step--; draw(); } }, 'قبلی') : null,
        h('button', { class: 'btn primary grow', onClick: () => { if (step < TOTAL - 1) { step++; haptic('select'); draw(); } else finish(false); } }, step < TOTAL - 1 ? 'بعدی' : 'شروع کنیم 🚀'),
      ),
      h('button', { class: 'btn ghost block', onClick: () => finish(true) }, 'رد کردن'),
    );
  };
  const sheet = openSheet({ title: 'راه‌اندازی', full: true, body });
  draw();
}

