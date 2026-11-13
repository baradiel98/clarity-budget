import { isValidISO, toISO, type Cents, type DateFormat, type DecimalSeparator, type ISODate } from '@clarity/shared';

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  ene: 1, abr: 4, ago: 8, dic: 12,
};

export const DATE_FORMATS: readonly DateFormat[] = [
  'YYYY-MM-DD', 'YYYY/MM/DD', 'MM/DD/YYYY', 'DD/MM/YYYY', 'MM/DD/YY', 'DD/MM/YY', 'DD.MM.YYYY', 'DD-MM-YYYY', 'MM-DD-YYYY', 'D MMM YYYY', 'MMM D YYYY',
];

const safeISO = (y: number, m: number, d: number): ISODate | null => {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  try {
    const iso = toISO(y, m, d);
    return isValidISO(iso) ? iso : null;
  } catch {
    return null;
  }
};

/** Parse a statement date in an explicit format. Time portions ("T10:00", " 10:00:00") are ignored. */
export function parseStatementDate(value: string, format: DateFormat): ISODate | null {
  const v = value.trim().replace(/[T ]\d{1,2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?\s*(am|pm)?$/i, '').trim();
  if (!v) return null;
  let m: RegExpExecArray | null;
  const yy = (s: string) => 2000 + Number(s);
  switch (format) {
    case 'YYYY-MM-DD':
      m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v);
      return m ? safeISO(+m[1]!, +m[2]!, +m[3]!) : null;
    case 'YYYY/MM/DD':
      m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(v);
      return m ? safeISO(+m[1]!, +m[2]!, +m[3]!) : null;
    case 'MM/DD/YYYY':
      m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
      return m ? safeISO(+m[3]!, +m[1]!, +m[2]!) : null;
    case 'DD/MM/YYYY':
      m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
      return m ? safeISO(+m[3]!, +m[2]!, +m[1]!) : null;
    case 'MM/DD/YY':
      m = /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/.exec(v);
      return m ? safeISO(yy(m[3]!), +m[1]!, +m[2]!) : null;
    case 'DD/MM/YY':
      m = /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/.exec(v);
      return m ? safeISO(yy(m[3]!), +m[2]!, +m[1]!) : null;
    case 'DD.MM.YYYY':
      m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(v);
      return m ? safeISO(+m[3]!, +m[2]!, +m[1]!) : null;
    case 'DD-MM-YYYY':
      m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(v);
      return m ? safeISO(+m[3]!, +m[2]!, +m[1]!) : null;
    case 'MM-DD-YYYY':
      m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(v);
      return m ? safeISO(+m[3]!, +m[1]!, +m[2]!) : null;
    case 'D MMM YYYY': {
      m = /^(\d{1,2})[\s\-/]([A-Za-z]{3,9})\.?[\s\-/,]+(\d{2}|\d{4})$/.exec(v);
      if (!m) return null;
      const mon = MONTHS[m[2]!.toLowerCase().slice(0, m[2]!.toLowerCase().startsWith('sept') ? 4 : 3)];
      const y = m[3]!.length === 2 ? yy(m[3]!) : +m[3]!;
      return mon ? safeISO(y, mon, +m[1]!) : null;
    }
    case 'MMM D YYYY': {
      m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(v);
      if (!m) return null;
      const mon = MONTHS[m[1]!.toLowerCase().slice(0, 3)];
      return mon ? safeISO(+m[3]!, mon, +m[2]!) : null;
    }
  }
}

/**
 * Formats that parse the most values (at least 80% of non-empty values; unparseable rows are
 * reported later as errors). More than one result means the user must choose (e.g. MM/DD vs DD/MM).
 */
export function detectDateFormats(values: readonly string[]): DateFormat[] {
  const nonEmpty = values.map((v) => v.trim()).filter(Boolean);
  if (nonEmpty.length === 0) return [];
  const scored = DATE_FORMATS.map((f) => ({ f, n: nonEmpty.filter((v) => parseStatementDate(v, f) !== null).length }));
  const max = Math.max(...scored.map((s) => s.n));
  if (max < Math.ceil(nonEmpty.length * 0.8)) return [];
  return scored.filter((s) => s.n === max).map((s) => s.f);
}

export function looksLikeDate(value: string): boolean {
  return DATE_FORMATS.some((f) => parseStatementDate(value, f) !== null);
}

/** Guess the decimal separator from amount-looking values ("1.234,56" → ','). */
export function detectDecimalSeparator(values: readonly string[]): DecimalSeparator {
  let comma = 0;
  let dot = 0;
  for (const raw of values) {
    const v = raw.replace(/[^\d.,]/g, '');
    if (/,\d{1,2}$/.test(v)) comma++;
    else if (/\.\d{1,2}$/.test(v)) dot++;
  }
  return comma > dot ? ',' : '.';
}

/**
 * Parse a statement amount into signed cents (as written in the file, before any sign convention).
 * Handles: -12.30, (12.30), 12.30-, 12.30 DR / CR, −12.30, $1,234.56, 1.234,56, 1 234,56, USD 12.
 * Returns null when the value is not a valid amount (more than 2 decimals, letters, etc.).
 */
export function parseStatementAmount(text: string, dec: DecimalSeparator): Cents | null {
  let v = text.trim();
  if (!v) return null;
  let negative = false;
  if (/\bDR\.?$/i.test(v)) {
    negative = true;
    v = v.replace(/\s*DR\.?$/i, '');
  } else if (/\bCR\.?$/i.test(v)) {
    v = v.replace(/\s*CR\.?$/i, '');
  }
  if (/^\(.*\)$/.test(v)) {
    negative = !negative;
    v = v.slice(1, -1);
  }
  v = v.replace(/^[A-Z]{3}\s*/i, '').replace(/\s*[A-Z]{3}$/i, '');
  v = v.replace(/[$€£¥\s\u00a0']/g, '');
  if (/^[-−]/.test(v)) {
    negative = !negative;
    v = v.slice(1);
  } else if (/^\+/.test(v)) v = v.slice(1);
  if (/[-−]$/.test(v)) {
    negative = !negative;
    v = v.slice(0, -1);
  }
  v = v.replace(/^[$€£¥]/, '');
  const thousands = dec === '.' ? ',' : '.';
  v = v.split(thousands).join('');
  const parts = v.split(dec);
  if (parts.length > 2) return null;
  const whole = parts[0] ?? '';
  const frac = parts[1] ?? '';
  if (!/^\d*$/.test(whole) || !/^\d{0,2}$/.test(frac) || (whole === '' && frac === '')) return null;
  const cents = Number(whole || '0') * 100 + Number(frac.padEnd(2, '0') || '0');
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}

export function looksLikeAmount(value: string): boolean {
  return /\d/.test(value) && (parseStatementAmount(value, '.') !== null || parseStatementAmount(value, ',') !== null) && !looksLikeDate(value);
}
