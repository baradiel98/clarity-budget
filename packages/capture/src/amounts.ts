import type { Cents } from '@clarity/shared';

/** A money amount found in the text. Parsed with string operations only (no floating point). */
export interface AmountMatch {
  start: number;
  end: number;
  text: string;
  cents: Cents;
  approximate: boolean;
  /** Currency code when the user wrote one (symbol, code or word); null when only a number was written. */
  currency: string | null;
  /** "$40-50", "40 to 50": a range, so there is no single amount to use. */
  range: boolean;
}

const SYMBOLS: Record<string, string> = { $: 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY' };
const WORDS: Record<string, string> = {
  dollar: 'USD', dollars: 'USD', bucks: 'USD', usd: 'USD', euro: 'EUR', euros: 'EUR', eur: 'EUR',
  pound: 'GBP', pounds: 'GBP', gbp: 'GBP', peso: 'MXN', pesos: 'MXN', mxn: 'MXN', cad: 'CAD', jpy: 'JPY', yen: 'JPY',
};

// approx? symbol? number word/code?
// The number may not start or end inside other digits or separators: "1.234,56" is never read as $1.00.
const MONEY = /(\b(?:about|around|approximately|approx\.?|roughly|nearly|almost|maybe|like|~)\s*)?(?:(\$|€|£|¥|\b(?:USD|EUR|GBP|MXN|CAD)\b)\s?)?(?<![\d]|\d[.,])(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)(?:(k)(?![a-z]))?(?![\d/]|[.,]\d)(?:\s*(dollars?|bucks|usd|euros?|eur|pounds?|gbp|pesos?|mxn|cad|yen|jpy)\b)?/gi;
/** "50ish", "50 or so" */
const APPROX_AFTER = /^(?:\s*-?ish\b|\s+or\s+so\b)/i;
/** "$40-50", "$40 to $50" */
const RANGE_AFTER = /^\s*(?:-|–|to)\s*[$€£]?\d[\d,]*(?:\.\d{1,2})?k?\b/i;
/** "3 shirts": a count before a noun, not money (only dropped when another amount is present) */
const COUNT_AFTER = /^\s+(?!dollars|bucks|euros|pounds|pesos)[a-z]{2,}s\b/i;

/** Words right after a bare number that mean it is not money ("2 days ago", "3 coffees" stays money only with a currency). */
const NOT_MONEY_AFTER = /^\s*(?:%|am\b|pm\b|days?\b|weeks?\b|months?\b|years?\b|times\b|x\b|items?\b|people\b|of\b|st\b|nd\b|rd\b|th\b|:\d)/i;

function toCents(num: string): Cents | null {
  const plain = num.replace(/,/g, '');
  const [whole, frac = ''] = plain.split('.');
  if (!whole || frac.length > 2) return null;
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}

/**
 * Money amounts outside the given excluded ranges (date phrases). A bare number counts as money only
 * when no amount in the same text carries a currency marker, and it is not followed by a unit.
 */
export function findAmounts(text: string, excluded: readonly { start: number; end: number }[]): AmountMatch[] {
  const out: (AmountMatch & { marked: boolean; count: boolean })[] = [];
  MONEY.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MONEY.exec(text))) {
    const numStart = m.index + m[0].indexOf(m[3]!, m[1]?.length ?? 0);
    const start = m.index;
    let end = start + m[0].length;
    if (excluded.some((r) => numStart < r.end && numStart + m![3]!.length > r.start)) continue;
    const marked = !!(m[2] || m[5]);
    if (!marked && NOT_MONEY_AFTER.test(text.slice(end))) continue;
    const base = toCents(m[3]!);
    const cents = base === null ? null : m[4] ? base * 1000 : base; // integer cents × 1000: exact
    if (cents === null || cents <= 0 || !Number.isSafeInteger(cents)) continue;
    let approximate = !!m[1];
    const ish = APPROX_AFTER.exec(text.slice(end));
    if (ish) { approximate = true; end += ish[0].length; }
    const range = RANGE_AFTER.exec(text.slice(end));
    if (range) { end += range[0].length; MONEY.lastIndex = end; }
    const count = !marked && !range && COUNT_AFTER.test(text.slice(end));
    const sym = m[2] ? SYMBOLS[m[2]] ?? m[2].toUpperCase() : null;
    const word = m[5] ? WORDS[m[5].toLowerCase()] ?? null : null;
    out.push({ start, end, text: text.slice(start, end).trim(), cents, approximate, currency: sym ?? word, range: !!range, marked, count });
  }
  const anyMarked = out.some((a) => a.marked);
  const kept = out.filter((a) => a.marked || !anyMarked);
  const withoutCounts = kept.length > 1 ? kept.filter((a) => !a.count) : kept;
  return withoutCounts.map(({ marked: _m, count: _c, ...a }) => a);
}
