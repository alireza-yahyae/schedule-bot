// Pure helper functions (no DOM). Weekday numbers: 0 = Saturday ... 6 = Friday.

export const WEEKDAYS = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه\u200cشنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];
export const WEEKDAYS_SHORT = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];
export const MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];

const FA = '۰۱۲۳۴۵۶۷۸۹';

/** Returns a function that formats digits as Persian ("fa") or Latin ("en"). */
export function makeD(mode) {
  if (mode === 'en') return (v) => String(v);
  return (v) => String(v).replace(/[0-9]/g, (d) => FA[Number(d)]);
}

export function enDigits(v) {
  return String(v)
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

// ------------------------------------------------------------------ Jalali calendar
export function gregorianToJalali(gy, gm, gd) {
  const gdm = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days =
    355666 + 365 * gy + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100) + Math.floor((gy2 + 399) / 400) + gd + gdm[gm - 1];
  let jy = -1595 + 33 * Math.floor(days / 12053);
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    jy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  let jm, jd;
  if (days < 186) {
    jm = 1 + Math.floor(days / 31);
    jd = 1 + (days % 31);
  } else {
    jm = 7 + Math.floor((days - 186) / 30);
    jd = 1 + ((days - 186) % 30);
  }
  return [jy, jm, jd];
}

export function jalaliToGregorian(jy, jm, jd) {
  jy += 1595;
  let days =
    -355668 + 365 * jy + Math.floor(jy / 33) * 8 + Math.floor(((jy % 33) + 3) / 4) + jd + (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186);
  let gy = 400 * Math.floor(days / 146097);
  days %= 146097;
  if (days > 36524) {
    days--;
    gy += 100 * Math.floor(days / 36524);
    days %= 36524;
    if (days >= 365) days++;
  }
  gy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    gy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  let gd = days + 1;
  const leap = (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0;
  const months = [0, 31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gm = 0;
  while (gm < 13 && gd > months[gm]) {
    gd -= months[gm];
    gm++;
  }
  return [gy, gm, gd];
}

const pad = (n) => (n < 10 ? '0' + n : String(n));

/** Number of days in a Jalali month (Esfand is 30 days in leap years). */
export function jalaliMonthLength(jy, jm) {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  // Esfand: find out by converting day 30 back and forth
  const [gy, gm, gd] = jalaliToGregorian(jy, 12, 30);
  const [, m2, d2] = gregorianToJalali(gy, gm, gd);
  return m2 === 12 && d2 === 30 ? 30 : 29;
}

export function isoToJalali(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return gregorianToJalali(y, m, d);
}
export function jalaliToIso(jy, jm, jd) {
  const [y, m, d] = jalaliToGregorian(jy, jm, jd);
  return `${y}-${pad(m)}-${pad(d)}`;
}
/** "1405/10/21" */
export function jalaliSlash(iso) {
  const [jy, jm, jd] = isoToJalali(iso);
  return `${jy}/${pad(jm)}/${pad(jd)}`;
}
/** "۲۱ دی ۱۴۰۵" */
export function jalaliText(iso, D) {
  const [jy, jm, jd] = isoToJalali(iso);
  return `${D(jd)} ${MONTHS[jm - 1]} ${D(jy)}`;
}

// ------------------------------------------------------------------ plain dates (Gregorian "YYYY-MM-DD")
export function weekdayOf(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 1) % 7;
}
export function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
export function daysBetween(a, b) {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

// ------------------------------------------------------------------ times
export function toMin(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}
export function fromMin(min) {
  return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
}

/** Local "HH:MM" of an epoch-seconds timestamp in a timezone. */
export function hmOf(ts, tz) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).formatToParts(
    new Date(ts * 1000),
  );
  const h = parts.find((p) => p.type === 'hour').value;
  const m = parts.find((p) => p.type === 'minute').value;
  return `${h === '24' ? '00' : h}:${m}`;
}

/** Seconds -> "۱:۲۵:۰۰" or "۲۵:۰۰". */
export function clock(sec, D) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return D(h > 0 ? `${h}:${pad(m)}:${pad(r)}` : `${pad(m)}:${pad(r)}`);
}

/** Seconds -> "۲ ساعت و ۱۵ دقیقه" / "۴۰ دقیقه" / "کمتر از یک دقیقه". */
export function humanDuration(sec, D) {
  const mins = Math.round(sec / 60);
  if (mins < 1) return 'کمتر از یک دقیقه';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${D(m)} دقیقه`;
  if (m === 0) return `${D(h)} ساعت`;
  return `${D(h)} ساعت و ${D(m)} دقیقه`;
}

/** "امروز" / "فردا" / "۳ روز دیگه" / "دیروز" / "۲ روز پیش" */
export function relativeDays(n, D) {
  if (n === 0) return 'امروز';
  if (n === 1) return 'فردا';
  if (n === -1) return 'دیروز';
  return n > 0 ? `${D(n)} روز دیگه` : `${D(-n)} روز پیش`;
}

// ------------------------------------------------------------------ week grid
/**
 * Lays out all weekly sessions for the grid view.
 * Returns { startHour, endHour, days: [ [block, ...] x 7 ] } where every block has
 * top/height in minutes from startHour and a `conflict` flag when it overlaps another one.
 */
export function layoutWeek(courses) {
  const items = [];
  for (const c of courses) {
    for (const s of c.sessions || []) {
      items.push({
        key: `${c.id}:${s.id}`,
        courseId: c.id,
        sessionId: s.id,
        name: c.name,
        color: c.color || '#4F8CFF',
        location: s.location || c.location || '',
        weekday: s.weekday,
        start: s.start_time,
        end: s.end_time,
        startMin: toMin(s.start_time),
        endMin: toMin(s.end_time),
        kind: s.kind,
        conflict: false,
      });
    }
  }
  let minStart = items.length ? Math.min(...items.map((i) => i.startMin)) : 8 * 60;
  let maxEnd = items.length ? Math.max(...items.map((i) => i.endMin)) : 16 * 60;
  const startHour = Math.max(0, Math.floor(minStart / 60) - 0);
  const endHour = Math.min(24, Math.ceil(maxEnd / 60) + 0);
  const days = Array.from({ length: 7 }, () => []);
  for (const it of items) days[it.weekday].push(it);
  for (const list of days) {
    list.sort((a, b) => a.startMin - b.startMin);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (list[i].startMin < list[j].endMin && list[j].startMin < list[i].endMin) {
          list[i].conflict = true;
          list[j].conflict = true;
        }
      }
    }
    for (const it of list) {
      it.top = it.startMin - startHour * 60;
      it.height = it.endMin - it.startMin;
    }
  }
  return { startHour, endHour: Math.max(endHour, startHour + 1), days };
}

// ------------------------------------------------------------------ stats helpers
/** 'ok' | 'warn' (one before the limit) | 'limit' (at the limit) | 'over' */
export function absenceLevel(absences, allowed) {
  if (absences > allowed) return 'over';
  if (absences === allowed && allowed > 0) return 'limit';
  if (allowed > 0 && absences === allowed - 1) return 'warn';
  return 'ok';
}

export function percent(x) {
  return x === null || x === undefined ? null : Math.round(x * 100);
}

/** Shorten a name for tight places. */
export function clip(s, n) {
  s = String(s ?? '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/** Order tasks: open first (by due date, then priority), done last. */
export function sortTasks(tasks) {
  return [...tasks].sort((a, b) => {
    if (a.done !== b.done) return a.done - b.done;
    const ad = a.due_date || '9999-12-31';
    const bd = b.due_date || '9999-12-31';
    if (ad !== bd) return ad < bd ? -1 : 1;
    return (b.priority ?? 1) - (a.priority ?? 1) || a.id - b.id;
  });
}

/** Find the class to show as "next up": running now, else the nearest future one. */
export function findNextUp(occurrences, now) {
  const open = occurrences
    .filter((o) => !o.is_test && ['upcoming', 'awaiting_reason', 'no_response'].includes(o.status) && o.end_ts > now)
    .sort((a, b) => a.start_ts - b.start_ts);
  const running = open.find((o) => o.start_ts <= now && o.end_ts > now);
  return running || open[0] || null;
}

/** How many of today's classes are over (by time or by your answer). */
export function dayProgress(todayOccurrences, now) {
  const list = todayOccurrences.filter((o) => !o.is_test);
  const done = list.filter((o) => o.end_ts <= now || ['attended', 'cancelled', 'skipped'].includes(o.status)).length;
  return { done, total: list.length };
}
