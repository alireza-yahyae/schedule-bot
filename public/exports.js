// Exports (CSV / calendar .ics) and "paste your timetable as text" import.

import { WEEKDAYS, addDays, enDigits, hmOf, isoToJalali, weekdayOf } from './lib.js';
import { confirmSheet, errorToast, h, haptic, icon, openSheet, tg, textArea, toast } from './ui.js';
import { saveSetting } from './core.js';
import { COURSE_COLORS, D, S, api, refresh } from './core.js';

// ------------------------------------------------------------------ download sheet
/**
 * Telegram's in-app browser does not always allow file downloads, so the sheet offers both:
 * a download attempt and "copy the text".
 */
export function openExport({ title, filename, mime, content }) {
  const ta = textArea({ value: content, rows: 8 });
  ta.readOnly = true;
  ta.setAttribute('dir', 'ltr');
  const download = () => {
    try {
      const url = URL.createObjectURL(new Blob(['\ufeff' + content], { type: mime + ';charset=utf-8' }));
      const a = h('a', { href: url, download: filename });
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast('اگه دانلود شروع نشد، متن رو کپی کن و توی فایل بذار.', { ms: 4000 });
    } catch (e) {
      errorToast(e);
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      toast('کپی شد ✓', { ms: 1400 });
    } catch {
      ta.select();
      toast('متن انتخاب شد؛ کپی کن.', { ms: 2500 });
    }
  };
  openSheet({
    title,
    body: h('div', { class: 'form' }, ta, h('div', { class: 'row gap-s' }, h('button', { class: 'btn primary grow', onClick: download }, `دانلود ${filename}`), h('button', { class: 'btn soft grow', onClick: copy }, 'کپی متن'))),
  });
}

// ------------------------------------------------------------------ CSV
const csvCell = (v) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // keep spreadsheets from running a cell as a formula
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const csv = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n');

const KIND_FA = { class: 'کلاس', lab: 'آزمایشگاه', workshop: 'کارگاه' };

function sessionRows() {
  const out = [];
  for (const c of S.data.courses) {
    for (const s of c.sessions) out.push({ course: c, s });
  }
  return out.sort((a, b) => a.s.weekday - b.s.weekday || a.s.start_time.localeCompare(b.s.start_time));
}

export function scheduleCsv() {
  return csv([['درس', 'روز', 'شروع', 'پایان', 'نوع', 'مکان'], ...sessionRows().map(({ course, s }) => [course.name, WEEKDAYS[s.weekday], s.start_time, s.end_time, KIND_FA[s.kind] || s.kind, s.location || course.location || ''])]);
}

export function gradesCsv(grades) {
  return csv([['درس', 'نیمسال', 'واحد', 'میانترم', 'پایان‌ترم', 'پروژه', 'نمره‌ی کل'], ...grades.map((g) => [g.course_name, g.semester, g.units, g.midterm_score, g.final_score, g.project_score, g.total_score])]);
}

// ------------------------------------------------------------------ ICS
const icsEscape = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Lines longer than 75 bytes are folded (RFC 5545), never in the middle of a character. */
function fold(line) {
  const enc = new TextEncoder();
  const parts = [];
  let cur = '';
  let bytes = 0;
  let limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > limit) {
      parts.push(cur);
      cur = '';
      bytes = 0;
      limit = 74;
    }
    cur += ch;
    bytes += n;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}

export function scheduleIcs() {
  const tz = S.data.tz;
  const today = S.data.date;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//schedule-bot//FA//', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:برنامه‌ی هفتگی'];
  // A calendar file that uses TZID should also describe that zone (some calendar apps ignore the times otherwise).
  // A fixed offset is exact for zones without daylight saving (such as Iran); elsewhere it is the current offset.
  let off = '+0000';
  try {
    const name = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(new Date()).find((x) => x.type === 'timeZoneName');
    const m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(name ? name.value : '');
    if (m) off = `${m[1]}${m[2]}${m[3] || '00'}`;
  } catch {
    /* keep +0000 */
  }
  lines.push('BEGIN:VTIMEZONE', `TZID:${tz}`, 'BEGIN:STANDARD', 'DTSTART:19700101T000000', `TZOFFSETFROM:${off}`, `TZOFFSETTO:${off}`, `TZNAME:${tz}`, 'END:STANDARD', 'END:VTIMEZONE');
  for (const { course, s } of sessionRows()) {
    // First date on or after today that falls on this weekday (0 = Saturday).
    const delta = (s.weekday - weekdayOf(today) + 7) % 7;
    const day = addDays(today, delta).replace(/-/g, '');
    const t = (hm) => hm.replace(':', '') + '00';
    lines.push(
      'BEGIN:VEVENT',
      `UID:session-${s.id ?? course.id + '-' + s.weekday + s.start_time}@schedule-bot`,
      `DTSTAMP:${stamp}`,
      `DTSTART;TZID=${tz}:${day}T${t(s.start_time)}`,
      `DTEND;TZID=${tz}:${day}T${t(s.end_time)}`,
      'RRULE:FREQ=WEEKLY',
      `SUMMARY:${icsEscape(course.name)}`,
    );
    const where = s.location || course.location;
    if (where) lines.push(`LOCATION:${icsEscape(where)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

export function openScheduleExports() {
  if (sessionRows().length === 0) { toast('هنوز جلسه‌ای ثبت نشده.', { kind: 'error' }); return; }
  const sheet = openSheet({
    title: 'خروجی برنامه',
    body: h(
      'div',
      { class: 'form' },
      h('button', { class: 'btn soft block', onClick: () => { sheet.close(); openExport({ title: 'برنامه‌ی هفتگی (CSV)', filename: 'schedule.csv', mime: 'text/csv', content: scheduleCsv() }); } }, 'جدول CSV (اکسل)'),
      h('button', { class: 'btn soft block', onClick: () => { sheet.close(); openExport({ title: 'تقویم (ICS)', filename: 'schedule.ics', mime: 'text/calendar', content: scheduleIcs() }); } }, 'تقویم ICS (گوگل کلندر، اپل)'),
      h('div', { class: 'field-hint' }, 'فایل ICS هر جلسه رو به‌صورت تکرار هفتگی از اولین روز مناسب از امروز به بعد می‌سازه.'),
    ),
  });
}

// ------------------------------------------------------------------ paste a timetable
const DAY_WORDS = [
  ['پنج شنبه', 5], ['پنجشنبه', 5], ['چهار شنبه', 4], ['چهارشنبه', 4], ['سه شنبه', 3], ['سهشنبه', 3], ['دو شنبه', 2], ['دوشنبه', 2],
  ['یک شنبه', 1], ['یکشنبه', 1], ['جمعه', 6], ['شنبه', 0], // "شنبه" last: it is part of all the other names
];
const TIME_RE = /(\d{1,2})(?:[:.](\d{2}))?\s*(?:-|–|—|تا|الی)\s*(\d{1,2})(?:[:.](\d{2}))?/;
const TRIM_RE = /^(?:[\s،,\-–—:|()[\]]|و(?=\s))+|(?:[\s،,\-–—:|()[\]]|(?<=\s)و)+$/g;
const pad2 = (n) => String(n).padStart(2, '0');

function normalize(line) {
  return enDigits(line.replace(/ك/g, 'ک').replace(/ي/g, 'ی').replace(/\u200c/g, ' ').replace(/\s+/g, ' ').trim());
}

/**
 * One timetable per line, e.g. "شنبه و سه‌شنبه 08:00-10:00 ریاضی ۲ (کلاس ۲۰۴)".
 * Returns { courses: [{ name, sessions: [{weekday,start_time,end_time,kind}] }], skipped: [line...] }.
 */
export function parseScheduleText(text) {
  const byName = new Map();
  const skipped = [];
  for (const raw of String(text).split(/\r?\n/)) {
    let line = normalize(raw);
    if (!line) continue;
    // a work shift or meeting starts with «کار:»
    const work = /^کار\s*:\s*/.exec(line);
    if (work) line = line.slice(work[0].length);
    const tagged = /\[کار\]/.test(line); // «[کار]» is accepted anywhere in the line
    if (tagged) line = line.replace(/\[کار\]/g, ' ');
    const days = [];
    for (const [word, wd] of DAY_WORDS) {
      while (line.includes(word)) {
        if (!days.includes(wd)) days.push(wd);
        line = line.replace(word, ' ');
      }
    }
    const m = TIME_RE.exec(line);
    if (!days.length || !m) { skipped.push(raw.trim()); continue; }
    const sh = Number(m[1]), sm = Number(m[2] || 0), eh = Number(m[3]), em = Number(m[4] || 0);
    const ok = sh <= 23 && eh <= 23 && sm <= 59 && em <= 59 && eh * 60 + em > sh * 60 + sm;
    let title = (line.slice(0, m.index) + ' ' + line.slice(m.index + m[0].length)).replace(/\s+/g, ' ').replace(TRIM_RE, '');
    // the trim above also removes a closing bracket at the end: put it back, e.g. «فیزیک ۲ (کلاس ۲۰۴)»
    if ((title.match(/\(/g) || []).length > (title.match(/\)/g) || []).length) title += ')';
    if (!ok || !title) { skipped.push(raw.trim()); continue; }
    const kind = /کارگاه/.test(title) ? 'workshop' : /(^|\s)آز(\s|$)|آزمایشگاه/.test(title) ? 'lab' : 'class';
    const course = byName.get(title) || { name: title.slice(0, 100), kind: work || tagged ? 'work' : 'class', sessions: [] };
    for (const wd of days) {
      if (!course.sessions.some((s) => s.weekday === wd && s.start_time === `${pad2(sh)}:${pad2(sm)}`)) {
        course.sessions.push({ weekday: wd, start_time: `${pad2(sh)}:${pad2(sm)}`, end_time: `${pad2(eh)}:${pad2(em)}`, location: null, kind });
      }
    }
    byName.set(title, course);
  }
  return { courses: [...byName.values()], skipped };
}

/** What the person gives to an AI (together with their timetable) to get text in the format of this app. */
export const AI_PROMPT = `تو دستیار من هستی. برنامه‌ی هفتگی من رو که همراه همین پیام فرستادم (متن، عکس، PDF یا اسکرین‌شات) بخون و دقیقاً به فرمت زیر تبدیلش کن.

قانون‌ها:
۱. هر خط فقط یک درس (یا یک برنامه‌ی کاری) رو توضیح می‌ده.
۲. شکل هر خط: روزها ساعتِ‌شروع-ساعتِ‌پایان اسم
   مثال: شنبه و دوشنبه 08:00-10:00 ریاضی ۲
۳. روزها رو با همین اسم‌ها بنویس: شنبه، یکشنبه، دوشنبه، سه‌شنبه، چهارشنبه، پنجشنبه، جمعه. اگه چند روزه، همه‌ی اسم‌ها رو بنویس و با «و» جدا کن (برای بازه‌ی روزها کلمه‌ی «تا» نذار).
۴. ساعت‌ها ۲۴ ساعته و به شکل 08:00-10:00 باشن (ساعت شروع، خط تیره، ساعت پایان).
۵. اگه یه درس چند ساعت مختلف تو هفته داره (مثلاً شنبه ۸ تا ۱۰ و سه‌شنبه ۱۰ تا ۱۲)، برای هر ساعت یه خط جدا بنویس و اسم درس رو در همه‌ی خط‌ها دقیقاً یکسان بنویس.
۶. اگه آزمایشگاه یا کارگاهه، اول اسمش «آز» یا «کارگاه» رو بنویس.
۷. اگه شیفت کاری یا جلسه‌ی کاریه، اول خط بنویس «کار:». مثال: کار: شنبه و یکشنبه 17:00-21:00 شیفت کافه
۸. اسم‌ها رو همون‌طور که تو برنامه هست بنویس. اگه جای کلاس مشخصه می‌تونی آخر اسم، توی پرانتز بذاری.
۹. فقط خودِ خط‌ها رو بده؛ بدون توضیح، بدون شماره‌گذاری، بدون جدول و بدون علامت \`\`\`.
۱۰. اگه چیزی از برنامه خوانا نبود، اون خط رو ننویس.

نمونه‌ی خروجی:
شنبه و دوشنبه 08:00-10:00 ریاضی ۲
یکشنبه 13:30-15:00 فیزیک ۲ (کلاس ۲۰۴)
چهارشنبه 10:00-12:00 آز شیمی
کار: شنبه و یکشنبه 17:00-21:00 شیفت کافه

حالا برنامه‌ی من:`;

const EXAMPLE_LINES = ['شنبه و دوشنبه 08:00-10:00 ریاضی ۲', 'یکشنبه 13:30-15:00 فیزیک ۲', 'کار: شنبه 17:00-21:00 شیفت کافه'];

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* try the old way */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

function readClipboard() {
  return new Promise((resolve) => {
    try {
      if (tg && typeof tg.readTextFromClipboard === 'function') {
        tg.readTextFromClipboard((text) => resolve(typeof text === 'string' ? text : null));
        return;
      }
    } catch {
      /* fall through */
    }
    if (navigator.clipboard && navigator.clipboard.readText) navigator.clipboard.readText().then(resolve, () => resolve(null));
    else resolve(null);
  });
}

/**
 * Make the schedule with an AI: copy the prompt, give it your timetable, paste the answer here.
 * The format is always shown at the top, also while typing, so it can be written by hand too.
 * firstRun: the very first screen (with a "later" button); `then` runs when it is closed.
 */
export function openPasteSchedule({ firstRun = false, then } = {}) {
  let finished = false;
  const finish = async () => {
    if (finished) return;
    finished = true;
    if (firstRun) await saveSetting({ setup_done: '1' }, { quiet: true });
    if (then) then();
  };
  const ta = textArea({ rows: 8, placeholder: 'جواب هوش مصنوعی رو اینجا بچسبون (یا خودت با همین فرمت بنویس)…' });
  const out = h('div', { class: 'form' });
  let parsed = { courses: [], skipped: [] };

  const draw = () => {
    parsed = parseScheduleText(ta.value);
    const existing = new Set(S.data.courses.map((c) => c.name.trim()));
    out.replaceChildren(
      ...parsed.courses.map((c) =>
        h(
          'div',
          { class: 'tpl' },
          h('b', null, `${c.kind === 'work' ? '💼 ' : ''}${c.name}`),
          existing.has(c.name) ? h('span', { class: 'chip warn' }, 'از قبل هست؛ رد می‌شه') : null,
          h('div', { class: 'xs muted num' }, c.sessions.map((s) => `${WEEKDAYS[s.weekday]} ${D(s.start_time)}–${D(s.end_time)}`).join(' • ')),
        ),
      ),
      parsed.skipped.length ? h('div', { class: 'field-hint' }, `${D(parsed.skipped.length)} خط فهمیده نشد (روز یا ساعت نداشت).`) : null,
    );
  };
  ta.addEventListener('input', draw);

  const promptView = h('textarea', { class: 'input', rows: 7, readOnly: true, style: { fontSize: '12px', lineHeight: '1.7' } });
  promptView.value = AI_PROMPT;

  const example = h(
    'div',
    { class: 'pinned-example' },
    h('div', { class: 'small bold' }, '✍️ فرمت: هر خط یک درس'),
    h('div', { class: 'example-lines', dir: 'auto' }, EXAMPLE_LINES.map((l) => h('div', null, l))),
    h('div', { class: 'xs muted' }, 'روزها + ساعت شروع-پایان + اسم. برای کار، اول خط «کار:» بنویس.'),
  );

  const body = h(
    'div',
    { class: 'form' },
    example,
    h('div', { class: 'small bold' }, '۱) پرامپت رو کپی کن و همراه برنامه‌ات (متن، عکس یا PDF) به یه هوش مصنوعی بده'),
    h(
      'button',
      {
        class: 'btn primary block',
        onClick: async () => {
          const ok = await copyText(AI_PROMPT);
          haptic(ok ? 'success' : 'error');
          toast(ok ? 'پرامپت کپی شد ✓ ببرش پیش ChatGPT، Gemini یا Claude' : 'کپی نشد؛ متن رو از «دیدن پرامپت» انتخاب و کپی کن', ok ? {} : { kind: 'error' });
        },
      },
      '📋 کپی پرامپت',
    ),
    h('details', null, h('summary', { class: 'small muted' }, 'دیدن متن پرامپت'), promptView),
    h('div', { class: 'small bold' }, '۲) جواب هوش مصنوعی رو اینجا بچسبون'),
    ta,
    h(
      'button',
      {
        class: 'btn soft block sm',
        onClick: async () => {
          const text = await readClipboard();
          if (!text) {
            toast('کلیپ‌بورد خونده نشد؛ داخل کادر بزن و «چسباندن» رو انتخاب کن.', { kind: 'error' });
            return;
          }
          ta.value = text;
          draw();
        },
      },
      '📥 چسباندن از کلیپ‌بورد',
    ),
    out,
    firstRun ? h('button', { class: 'btn ghost block', onClick: () => sheet.close() }, 'بعداً، خودم وارد می‌کنم') : null,
  );

  const sheet = openSheet({
    title: firstRun ? 'برنامه‌ات رو بساز ✨' : 'ساخت برنامه با هوش مصنوعی',
    full: true,
    body,
    onClose: finish,
    primary: {
      text: firstRun ? 'تأیید و ساخت برنامه' : 'افزودن به برنامه',
      onClick: async () => {
        const existing = new Set(S.data.courses.map((c) => c.name.trim()));
        const fresh = parsed.courses.filter((c) => !existing.has(c.name));
        if (!fresh.length) {
          haptic('error');
          toast(ta.value.trim() ? 'برنامه‌ی تازه‌ای پیدا نشد؛ فرمت رو با مثال بالا مقایسه کن.' : 'هنوز چیزی نچسبوندی. اگه نمی‌خوای الان، «بعداً» رو بزن.', { kind: 'error' });
          return;
        }
        if (!firstRun && !(await confirmSheet({ title: `${D(fresh.length)} مورد اضافه بشه؟`, text: fresh.map((c) => c.name).join('، '), confirmText: 'اضافه کن' }))) return;
        sheet.setBusy(true);
        let n = 0;
        try {
          for (const c of fresh) {
            await api('POST', '/courses', { name: c.name, kind: c.kind, color: COURSE_COLORS[(S.data.courses.length + n) % COURSE_COLORS.length], sessions: c.sessions });
            n++;
          }
          haptic('success');
          toast(`${D(n)} مورد اضافه شد ✓`);
        } catch (e) {
          errorToast(e);
        }
        if (n) await refresh();
        sheet.setBusy(false);
        if (n) sheet.close();
      },
    },
  });
}


// ------------------------------------------------------------------ sessions with their category
/** Every timed and focus session (CSV), and a monthly total per category. */
export async function openActivityExports() {
  let rows;
  try {
    rows = (await api('GET', '/export/study')).rows;
  } catch (e) {
    errorToast(e);
    return;
  }
  if (!rows.length) { toast('هنوز جلسه‌ای ثبت نشده.', { kind: 'error' }); return; }
  const tz = S.data.tz;
  const jal = (iso) => { try { const [jy, jm, jd] = isoToJalali(iso); return `${jy}/${String(jm).padStart(2, '0')}/${String(jd).padStart(2, '0')}`; } catch { return iso; } };
  const sessions = () =>
    csv([
      ['تاریخ', 'تاریخ شمسی', 'شروع', 'پایان', 'دقیقه', 'دسته', 'کار', 'یادداشت', 'نوع'],
      ...rows.map((r) => [r.date, jal(r.date), r.started_at ? hmOf(r.started_at, tz) : '', r.ended_at ? hmOf(r.ended_at, tz) : '', r.minutes, r.category || '', r.task || '', r.note || '', r.type === 'focus' ? 'تمرکز' : 'تایمر']),
    ]);
  const monthly = () => {
    const sum = new Map();
    for (const r of rows) {
      const j = jal(r.date).slice(0, 7); // شمسی: YYYY/MM
      const key = `${j}|${r.category || '—'}`;
      sum.set(key, (sum.get(key) || 0) + r.minutes);
    }
    const out = [...sum.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, m]) => { const [month, cat] = k.split('|'); return [month, cat, m, Math.round((m / 60) * 10) / 10]; });
    return csv([['ماه شمسی', 'دسته', 'دقیقه', 'ساعت'], ...out]);
  };
  const sheet = openSheet({
    title: 'خروجی جلسه‌ها',
    body: h(
      'div',
      { class: 'form' },
      h('button', { class: 'btn soft block', onClick: () => { sheet.close(); openExport({ title: 'همه‌ی جلسه‌ها (CSV)', filename: 'sessions.csv', mime: 'text/csv', content: sessions() }); } }, 'همه‌ی جلسه‌ها (CSV)'),
      h('button', { class: 'btn soft block', onClick: () => { sheet.close(); openExport({ title: 'جمع ماهانه به تفکیک دسته (CSV)', filename: 'monthly.csv', mime: 'text/csv', content: monthly() }); } }, 'جمع ماهانه به تفکیک دسته (CSV)'),
    ),
  });
}
