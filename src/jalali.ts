// Jalali (Persian) calendar conversion (arithmetic 33-year-cycle algorithm).
// All "date" strings elsewhere in the project are Gregorian "YYYY-MM-DD".

import { enDigits } from './time.ts';

export const MONTH_FA = [
  'فروردین',
  'اردیبهشت',
  'خرداد',
  'تیر',
  'مرداد',
  'شهریور',
  'مهر',
  'آبان',
  'آذر',
  'دی',
  'بهمن',
  'اسفند',
];

export function gregorianToJalali(gy: number, gm: number, gd: number): [number, number, number] {
  const gdm = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days =
    355666 +
    365 * gy +
    Math.floor((gy2 + 3) / 4) -
    Math.floor((gy2 + 99) / 100) +
    Math.floor((gy2 + 399) / 400) +
    gd +
    gdm[gm - 1];
  let jy = -1595 + 33 * Math.floor(days / 12053);
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    jy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  let jm: number;
  let jd: number;
  if (days < 186) {
    jm = 1 + Math.floor(days / 31);
    jd = 1 + (days % 31);
  } else {
    jm = 7 + Math.floor((days - 186) / 30);
    jd = 1 + ((days - 186) % 30);
  }
  return [jy, jm, jd];
}

export function jalaliToGregorian(jy: number, jm: number, jd: number): [number, number, number] {
  jy += 1595;
  let days =
    -355668 +
    365 * jy +
    Math.floor(jy / 33) * 8 +
    Math.floor(((jy % 33) + 3) / 4) +
    jd +
    (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186);
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

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** "2027-01-11" -> [1405, 10, 21] */
export function dateToJalali(date: string): [number, number, number] {
  const [y, m, d] = date.split('-').map(Number);
  return gregorianToJalali(y, m, d);
}

/** "2027-01-11" -> "۲۱ دی ۱۴۰۵" */
export function jalaliText(date: string, fmt: (v: string | number) => string): string {
  const [jy, jm, jd] = dateToJalali(date);
  return `${fmt(jd)} ${MONTH_FA[jm - 1]} ${fmt(jy)}`;
}

/** "2027-01-11" -> "۱۴۰۵/۱۰/۲۱" */
export function jalaliSlash(date: string, fmt: (v: string | number) => string): string {
  const [jy, jm, jd] = dateToJalali(date);
  return fmt(`${jy}/${pad(jm)}/${pad(jd)}`);
}

/** "1405/10/21" (Persian or English digits) -> "2027-01-11", or null if invalid. */
export function parseJalali(input: string): string | null {
  const m = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(enDigits(input.trim()));
  if (!m) return null;
  const jy = Number(m[1]);
  const jm = Number(m[2]);
  const jd = Number(m[3]);
  if (jm < 1 || jm > 12 || jd < 1 || jd > 31) return null;
  if (jm > 6 && jd > 30) return null;
  const [gy, gm, gd] = jalaliToGregorian(jy, jm, jd);
  return `${gy}-${pad(gm)}-${pad(gd)}`;
}
