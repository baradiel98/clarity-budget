import type { ISODate, Weekday } from './types';

/**
 * Calendar-date math on 'YYYY-MM-DD' strings using pure integer algorithms
 * (days-from-civil, H. Hinnant). No Date objects or time zones are involved,
 * so results are identical on every platform and never drift across DST.
 */

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface YMD {
  y: number;
  m: number; // 1-12
  d: number; // 1-31
}

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, m: number): number {
  if (m === 2) return isLeapYear(y) ? 29 : 28;
  return [4, 6, 9, 11].includes(m) ? 30 : 31;
}

export function parseISO(date: ISODate): YMD {
  const match = ISO_RE.exec(date);
  if (!match) throw new Error(`Invalid date: ${date}`);
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) throw new Error(`Invalid date: ${date}`);
  return { y, m, d };
}

export function isValidISO(date: string): boolean {
  try {
    parseISO(date);
    return true;
  } catch {
    return false;
  }
}

export function toISO(y: number, m: number, d: number): ISODate {
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) throw new Error(`Invalid date parts ${y}-${m}-${d}`);
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Days since 1970-01-01 for a civil date. */
export function toDayNumber(date: ISODate): number {
  const { y: yy, m, d } = parseISO(date);
  const y = m <= 2 ? yy - 1 : yy;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = (m + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

export function fromDayNumber(n: number): ISODate {
  const z = n + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const y0 = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  const y = m <= 2 ? y0 + 1 : y0;
  return toISO(y, m, d);
}

export function addDays(date: ISODate, days: number): ISODate {
  return fromDayNumber(toDayNumber(date) + days);
}

export function diffDays(a: ISODate, b: ISODate): number {
  return toDayNumber(a) - toDayNumber(b);
}

export function compareISO(a: ISODate, b: ISODate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export const minISO = (a: ISODate, b: ISODate): ISODate => (a <= b ? a : b);
export const maxISO = (a: ISODate, b: ISODate): ISODate => (a >= b ? a : b);

/** 0 = Sunday ... 6 = Saturday. 1970-01-01 was a Thursday. */
export function weekday(date: ISODate): Weekday {
  const n = toDayNumber(date);
  return (((n + 4) % 7) + 7) % 7 as Weekday;
}

/** Day-of-month with clamping: 31 in a 30-day month → 30; 'last' → last day. */
export function clampDay(y: number, m: number, day: number | 'last'): ISODate {
  const dim = daysInMonth(y, m);
  const d = day === 'last' ? dim : Math.min(day, dim);
  return toISO(y, m, d);
}

export function addMonths(y: number, m: number, months: number): { y: number; m: number } {
  const idx = y * 12 + (m - 1) + months;
  return { y: Math.floor(idx / 12), m: (idx % 12 + 12) % 12 + 1 };
}

/** Months between the month of a and the month of b (b - a). */
export function monthIndex(date: ISODate): number {
  const { y, m } = parseISO(date);
  return y * 12 + (m - 1);
}

export function startOfMonth(date: ISODate): ISODate {
  const { y, m } = parseISO(date);
  return toISO(y, m, 1);
}

export function endOfMonth(date: ISODate): ISODate {
  const { y, m } = parseISO(date);
  return toISO(y, m, daysInMonth(y, m));
}

export function monthKey(date: ISODate): string {
  return date.slice(0, 7);
}

const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTHS_SHORT = MONTHS_LONG.map((m) => m.slice(0, 3));
const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const monthNameLong = (m: number): string => MONTHS_LONG[m - 1] ?? '';
export const monthNameShort = (m: number): string => MONTHS_SHORT[m - 1] ?? '';

/** "Sep 15" */
export function formatShortDate(date: ISODate): string {
  const { m, d } = parseISO(date);
  return `${monthNameShort(m)} ${d}`;
}

/** "Mon, Sep 15" */
export function formatWeekdayDate(date: ISODate): string {
  return `${WEEKDAYS_SHORT[weekday(date)]}, ${formatShortDate(date)}`;
}

/** "September 2025" */
export function formatMonthYear(date: ISODate): string {
  const { y, m } = parseISO(date);
  return `${monthNameLong(m)} ${y}`;
}

/**
 * Local calendar date for a JS Date. This is the ONLY place a Date object is used;
 * apps call it once to obtain "today" and pass the string into the engine.
 */
export function localISODate(now: Date): ISODate {
  return toISO(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export { MONTHS_SHORT, WEEKDAYS_SHORT };
