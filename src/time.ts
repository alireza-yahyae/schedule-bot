// Time helpers: timezone-aware conversions without any library.
// Weekday numbering used everywhere in this project: 0 = Saturday ... 6 = Friday.

const dtfCache = new Map<string, Intl.DateTimeFormat>();

interface Parts {
  y: number;
  m: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

function getParts(ms: number, tz: string): Parts {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    dtfCache.set(tz, f);
  }
  const out: Record<string, number> = {};
  for (const p of f.formatToParts(new Date(ms))) {
    if (p.type !== 'literal') out[p.type] = parseInt(p.value, 10);
  }
  return {
    y: out.year,
    m: out.month,
    d: out.day,
    h: out.hour === 24 ? 0 : out.hour,
    mi: out.minute,
    s: out.second,
  };
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function offsetMs(ms: number, tz: string): number {
  const p = getParts(ms, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** Local date + local time in a timezone -> epoch seconds. */
export function zonedToEpoch(date: string, time: string, tz: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm, 0);
  const o1 = offsetMs(guess, tz);
  let ts = guess - o1;
  const o2 = offsetMs(ts, tz);
  if (o2 !== o1) ts = guess - o2;
  return Math.floor(ts / 1000);
}

/** Epoch seconds -> local date "YYYY-MM-DD". */
export function localDate(tsSec: number, tz: string): string {
  const p = getParts(tsSec * 1000, tz);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

/** Epoch seconds -> local time "HH:MM". */
export function localHM(tsSec: number, tz: string): string {
  const p = getParts(tsSec * 1000, tz);
  return `${pad(p.h)}:${pad(p.mi)}`;
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** 0 = Saturday, 1 = Sunday, ... 6 = Friday. */
export function iranWeekday(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 1) % 7;
}

export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

export const WEEKDAY_FA = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه\u200cشنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

/** 0-9 -> ۰-۹ */
export function faDigits(v: string | number): string {
  return String(v).replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)]);
}

/** ۰-۹ and ٠-٩ -> 0-9 */
export function enDigits(v: string): string {
  return v
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

export function makeDigits(mode: 'fa' | 'en'): (v: string | number) => string {
  return mode === 'fa' ? faDigits : (v) => String(v);
}
