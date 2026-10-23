// "Special days": a different sleep / wake time and/or a quiet period (no reminders) for one date or for a weekday every week.

import { WEEKDAYS, addDays, fromMin, hmOf, jalaliText, toMin, weekdayOf } from './lib.js';
import { confirmSheet, errorToast, field, h, haptic, icon, openSheet, segmented, selectEl, switchEl, textInput, toast } from './ui.js';
import { D, S, api, nowSec, refresh } from './core.js';

const QUIET_LABEL = { none: 'ندارد', all_day: 'کل روز', window: 'یه بازه' };

/** "امروز" / "فردا" / "۲۸ مهر" / "هر شنبه" for a rule. */
export function overrideTitle(o) {
  if (o.scope === 'weekday') return `هر ${WEEKDAYS[o.weekday]}`;
  if (o.date === S.data.date) return 'امروز';
  if (o.date === addDays(S.data.date, 1)) return 'فردا';
  return `${WEEKDAYS[weekdayOf(o.date)]} ${jalaliText(o.date, D)}`;
}

/** Short chips that say what a rule changes. */
export function overrideChips(o) {
  const chips = [];
  if (o.sleep_time) chips.push(['info', `🌙 خواب ${D(o.sleep_time)}`]);
  if (o.wake_time) chips.push(['info', `☀️ بیداری ${D(o.wake_time)}`]);
  if (o.quiet_mode === 'all_day') chips.push(['warn', '🔕 خاموشیِ کل روز']);
  if (o.quiet_mode === 'window') chips.push(['warn', `🔕 ${D(o.quiet_from)} تا ${D(o.quiet_to)}`]);
  return chips;
}

const nextFive = () => {
  const m = toMin(hmOf(nowSec(), S.data.tz));
  return Math.min(23 * 60 + 55, Math.ceil((m + 1) / 5) * 5);
};

/**
 * @param {{ row?: object, scope?: 'today'|'tomorrow'|'weekly', quiet?: 'none'|'all_day'|'window' }} opts
 *   `row` edits an existing rule; otherwise a new one is made (replacing any rule for the same day).
 */
export function openDayPlanSheet({ row = null, scope = 'today', quiet = 'none' } = {}) {
  const plan = S.data.today_plan;
  const date0 = S.data.date;
  const editing = !!row;
  let scopeKey = row ? (row.scope === 'weekday' ? 'weekly' : row.date === date0 ? 'today' : row.date === addDays(date0, 1) ? 'tomorrow' : 'other') : scope;
  let quietMode = row ? row.quiet_mode : quiet;

  const normal = { sleep: S.data.settings.sleep_time || '23:30', wake: S.data.settings.wake_time || '07:00' };
  const start = nextFive();
  const timeIn = (v, narrow = true) => { const el = textInput({ type: 'time', value: v }); if (narrow) el.style.maxWidth = '150px'; return el; };
  const sleepIn = timeIn((row && row.sleep_time) || normal.sleep);
  const wakeIn = timeIn((row && row.wake_time) || normal.wake);
  const fromIn = timeIn((row && row.quiet_from) || fromMin(start), false);
  const toIn = timeIn((row && row.quiet_to) || fromMin(Math.min(23 * 60 + 59, start + 120)), false);
  let useSleep = !!(row && row.sleep_time);
  let useWake = !!(row && row.wake_time);
  const wdSel = selectEl(WEEKDAYS.map((n, i) => ({ value: String(i), label: n })), String(row && row.weekday !== null && row.weekday !== undefined ? row.weekday : weekdayOf(date0)), () => {});

  const host = h('div', { class: 'form' });
  const switchRow = (label, desc, on, set, input) => {
    const wrap = h('div', { class: 'setting' }, h('div', { class: 'grow' }, h('div', { class: 'label' }, label), desc ? h('div', { class: 'desc' }, desc) : null), on ? input : null, switchEl(on, (v) => { set(v); draw(); }));
    return wrap;
  };

  function draw() {
    const parts = [];
    if (!editing) {
      parts.push(h('div', { class: 'field' }, h('div', { class: 'field-label' }, 'برای کدوم روز؟'), segmented([{ value: 'today', label: 'امروز' }, { value: 'tomorrow', label: 'فردا' }, { value: 'weekly', label: 'هر هفته' }], scopeKey, (v) => { scopeKey = v; draw(); }).el));
    } else {
      parts.push(h('div', { class: 'chip info', style: { alignSelf: 'flex-start' } }, overrideTitle(row)));
    }
    if (scopeKey === 'weekly' && !editing) parts.push(field('کدوم روز هفته؟', wdSel));

    parts.push(
      h('div', { class: 'section-title' }, h('span', null, '🌙 خواب و بیداری')),
      h(
        'div',
        { class: 'card flat tight' },
        switchRow('ساعت خواب', `معمولاً ${D(normal.sleep)}`, useSleep, (v) => { useSleep = v; }, sleepIn),
        switchRow('ساعت بیدار شدن', `معمولاً ${D(normal.wake)}`, useWake, (v) => { useWake = v; }, wakeIn),
      ),
      h('div', { class: 'section-title' }, h('span', null, '🔕 خاموشی (یادآوری نیاد)')),
      segmented(Object.entries(QUIET_LABEL).map(([value, label]) => ({ value, label })), quietMode, (v) => { quietMode = v; draw(); }).el,
    );
    if (quietMode === 'window') {
      parts.push(h('div', { class: 'two' }, field('از ساعت', fromIn), field('تا ساعت', toIn)), h('div', { class: 'field-hint' }, 'اگه «تا» زودتر از «از» باشه، بازه از نیمه‌شب رد می‌شه.'));
    }
    parts.push(
      h('div', { class: 'field-hint' }, quietMode === 'all_day' ? 'اون روز هیچ یادآوری‌ای از ربات نمیاد؛ کلاس‌ها بدون پیام می‌گذرن.' : quietMode === 'window' ? 'توی این بازه ربات ساکته؛ کلاسی که وسطش باشه بدون یادآوری رد می‌شه.' : 'اگه فقط ساعت خواب/بیداری رو عوض کنی، یادآوری‌ها مثل قبل میان.'),
    );
    if (editing) parts.push(h('button', { class: 'btn danger-soft block', onClick: remove }, icon('trash', 18), 'حذف این تنظیم'));
    host.replaceChildren(...parts);
  }

  async function remove() {
    if (!(await confirmSheet({ title: 'حذف این تنظیم؟', text: `«${overrideTitle(row)}» به حالت عادی برمی‌گرده.`, confirmText: 'حذف', danger: true }))) return;
    try {
      await api('DELETE', `/overrides/${row.id}`);
      haptic('warning');
      sheet.close();
      await refresh();
      toast('به حالت عادی برگشت');
    } catch (e) {
      errorToast(e);
    }
  }

  async function save() {
    const body = {
      sleep_time: useSleep ? sleepIn.value : null,
      wake_time: useWake ? wakeIn.value : null,
      quiet_mode: quietMode,
      quiet_from: quietMode === 'window' ? fromIn.value : null,
      quiet_to: quietMode === 'window' ? toIn.value : null,
    };
    if (row) Object.assign(body, row.scope === 'weekday' ? { scope: 'weekday', weekday: row.weekday } : { scope: 'date', date: row.date });
    else if (scopeKey === 'weekly') Object.assign(body, { scope: 'weekday', weekday: Number(wdSel.value) });
    else Object.assign(body, { scope: 'date', date: scopeKey === 'tomorrow' ? addDays(date0, 1) : date0 });
    sheet.setBusy(true);
    try {
      await api('POST', '/overrides', body);
      haptic('success');
      sheet.close();
      await refresh();
      toast('ذخیره شد ✓');
    } catch (e) {
      errorToast(e);
    }
    sheet.setBusy(false);
  }

  const sheet = openSheet({ title: editing ? 'ویرایش روز خاص' : 'تنظیم روز خاص', body: host, primary: { text: editing ? 'ذخیره' : 'اعمال', onClick: save } });
  draw();
}

/** Settings card: every special-day rule, with an "add" button. */
export function dayPlanCard() {
  const rows = S.data.overrides || [];
  const sorted = [...rows].sort((a, b) => (a.scope === b.scope ? (a.date || '').localeCompare(b.date || '') || (a.weekday ?? 0) - (b.weekday ?? 0) : a.scope === 'date' ? -1 : 1));
  return h(
    'section',
    { class: 'card' },
    h('div', { class: 'card-title' }, '🗓 روزهای خاص'),
    h('div', { class: 'small muted' }, 'مثلاً شنبه‌ها دیرتر بخوابی، یا امروز از ۱۴ تا ۱۶ ربات ساکت باشه.'),
    sorted.length
      ? h(
          'div',
          { class: 'list mt' },
          sorted.map((o) =>
            h(
              'button',
              { class: 'plan-row', onClick: () => openDayPlanSheet({ row: o }) },
              h('div', { class: 'grow', style: { textAlign: 'start' } }, h('div', { class: 'bold' }, overrideTitle(o)), h('div', { class: 'row wrap gap-s', style: { marginTop: '4px' } }, overrideChips(o).map(([cls, t]) => h('span', { class: 'chip ' + cls }, t)))),
              icon('chevron', 18),
            ),
          ),
        )
      : null,
    h('button', { class: 'btn soft block mt', onClick: () => openDayPlanSheet() }, icon('plus', 18), 'افزودن روز خاص'),
  );
}

/** A banner for Today when a quiet period is on (or about to start). */
export function quietBanner(now) {
  const p = S.data.today_plan;
  if (!p || p.quiet_mode === 'none') return null;
  const edit = () => { const row = (S.data.overrides || []).find((o) => (o.scope === 'date' && o.date === p.date) || (o.scope === 'weekday' && o.weekday === weekdayOf(p.date))); openDayPlanSheet(row ? { row } : {}); };
  const btn = h('button', { class: 'btn sm soft', onClick: edit }, 'تغییر');
  if (p.quiet_mode === 'all_day') return h('div', { class: 'banner quiet' }, icon('moon', 18), h('span', { class: 'grow' }, 'امروز خاموشه؛ ربات هیچ یادآوری‌ای نمی‌فرسته.'), btn);
  const m = toMin(hmOf(now, S.data.tz));
  const from = toMin(p.quiet_from), to = toMin(p.quiet_to);
  const inside = from <= to ? m >= from && m < to : m >= from || m < to;
  return h('div', { class: 'banner quiet' }, icon('moon', 18), h('span', { class: 'grow' }, inside ? `خاموشی فعاله تا ساعت ${D(p.quiet_to)}.` : `خاموشی امروز از ${D(p.quiet_from)} تا ${D(p.quiet_to)}.`), btn);
}
