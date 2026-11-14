import { addDays, daysInMonth, isValidISO, parseISO, toISO, weekday, type ISODate } from '@clarity/shared';

/**
 * Natural date expressions, resolved against the user's local "today" (a calendar date, so no
 * time-zone arithmetic). Anything unclear is reported as unclear, never guessed.
 */
export interface DateMatch {
  start: number;
  end: number;
  text: string;
  date: ISODate | null; // null = recognised as a date phrase, but not precise enough ("last week")
  ambiguous: boolean; // e.g. 10/11: October 11 or 10 November
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const WEEKDAYS: Record<string, number> = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6, sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6 };
const SMALL: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, couple: 2, 'a couple': 2, 'a couple of': 2 };

const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?';
const DAY_RE = '(\\d{1,2})(?:st|nd|rd|th)?';
const WD_RE = '(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tues?|wed|thu(?:rs?)?|fri|sat|sun)';

type Rule = { re: RegExp; resolve: (m: RegExpExecArray, today: ISODate) => { date: ISODate | null; ambiguous?: boolean } };

/** Most recent `wd` strictly before today ("last Friday") or on/before today ("on Friday"). */
function pastWeekday(today: ISODate, wd: number, strict: boolean): ISODate {
  let d = strict ? addDays(today, -1) : today;
  while (weekday(d) !== wd) d = addDays(d, -1);
  return d;
}

/** A month/day without a year: this year, unless that is more than a month ahead (then last year). */
function monthDay(today: ISODate, m: number, d: number, y?: number): ISODate | null {
  const t = parseISO(today);
  let year = y ?? t.y;
  if (y !== undefined && y < 100) year = 2000 + y;
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(year, m)) return null;
  let iso = toISO(year, m, d);
  if (y === undefined && iso > addDays(today, 31)) {
    if (d > daysInMonth(year - 1, m)) return null;
    iso = toISO(year - 1, m, d);
  }
  return isValidISO(iso) ? iso : null;
}

const RULES: Rule[] = [
  { re: /\b(?:the\s+)?day\s+before\s+yesterday\b/gi, resolve: (_m, t) => ({ date: addDays(t, -2) }) },
  { re: /\b(?:yesterday(?:\s+(?:morning|afternoon|evening|night))?|last\s+night)\b/gi, resolve: (_m, t) => ({ date: addDays(t, -1) }) },
  { re: /\b(?:today|tonight|this\s+(?:morning|afternoon|evening)|earlier\s+today|just\s+now)\b/gi, resolve: (_m, t) => ({ date: t }) },
  {
    re: /\b(\d{1,2}|a couple of|a couple|couple|one|two|three|four|five|six|seven|eight|nine|ten|a|an)\s+(days?|weeks?)\s+ago\b/gi,
    resolve: (m, t) => {
      const n = /^\d+$/.test(m[1]!) ? Number(m[1]) : SMALL[m[1]!.toLowerCase()] ?? NaN;
      if (!Number.isFinite(n)) return { date: null };
      return { date: addDays(t, -n * (m[2]!.toLowerCase().startsWith('week') ? 7 : 1)) };
    },
  },
  { re: new RegExp(`\\b(?:last|this\\s+past)\\s+${WD_RE}\\b`, 'gi'), resolve: (m, t) => ({ date: pastWeekday(t, WEEKDAYS[m[1]!.toLowerCase()]!, true) }) },
  { re: new RegExp(`\\bon\\s+${WD_RE}\\b`, 'gi'), resolve: (m, t) => ({ date: pastWeekday(t, WEEKDAYS[m[1]!.toLowerCase()]!, false) }) },
  // A bare full weekday name ("Friday I spent…"): the most recent one, today included.
  { re: /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi, resolve: (m, t) => ({ date: pastWeekday(t, WEEKDAYS[m[1]!.toLowerCase()]!, false) }) },
  // ISO 2026-10-15
  { re: /\b(\d{4})-(\d{2})-(\d{2})\b/g, resolve: (m, t) => ({ date: monthDay(t, Number(m[2]), Number(m[3]), Number(m[1])) }) },
  // October 15, October 15th 2026, Oct. 15
  { re: new RegExp(`\\b${MONTH_RE}\\s+${DAY_RE}(?:,?\\s+(\\d{4}))?\\b`, 'gi'), resolve: (m, t) => ({ date: monthDay(t, MONTHS[m[1]!.toLowerCase()]!, Number(m[2]), m[3] ? Number(m[3]) : undefined) }) },
  // 15 October, 15th of October 2026
  { re: new RegExp(`\\b${DAY_RE}\\s+(?:of\\s+)?${MONTH_RE}(?:,?\\s+(\\d{4}))?\\b`, 'gi'), resolve: (m, t) => ({ date: monthDay(t, MONTHS[m[2]!.toLowerCase()]!, Number(m[1]), m[3] ? Number(m[3]) : undefined) }) },
  // 10/15, 10/15/2026, 10/15/26 — read as month/day (US) and flagged when it could be read the other way
  {
    re: /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?\b/g,
    resolve: (m, t) => {
      const a = Number(m[1]);
      const b = Number(m[2]);
      const y = m[3] ? Number(m[3]) : undefined;
      return { date: monthDay(t, a, b, y), ambiguous: a <= 12 && b <= 12 && a !== b };
    },
  },
  // "the 15th" — this month, or last month if that is still ahead
  {
    re: /\bthe\s+(\d{1,2})(?:st|nd|rd|th)\b/gi,
    resolve: (m, t) => {
      const d = Number(m[1]);
      const { y, m: mo } = parseISO(t);
      const here = d <= daysInMonth(y, mo) ? toISO(y, mo, d) : null;
      if (here && here <= t) return { date: here };
      const py = mo === 1 ? y - 1 : y;
      const pm = mo === 1 ? 12 : mo - 1;
      return { date: d <= daysInMonth(py, pm) ? toISO(py, pm, d) : null };
    },
  },
  // Too vague to pick a day: flagged for the user.
  { re: /\b(?:last|this|next)\s+(?:week|month|weekend|year)\b|\brecently\b|\bthe other day\b/gi, resolve: () => ({ date: null }) },
];

/** All date phrases in `text`, earliest first, without overlaps. */
export function findDates(text: string, today: ISODate): DateMatch[] {
  const found: DateMatch[] = [];
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.re.exec(text))) {
      const start = m.index;
      const end = start + m[0].length;
      if (found.some((f) => start < f.end && end > f.start)) continue;
      const r = rule.resolve(m, today);
      found.push({ start, end, text: m[0], date: r.date, ambiguous: !!r.ambiguous });
    }
  }
  return found.sort((a, b) => a.start - b.start);
}
