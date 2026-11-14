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
}

const SYMBOLS: Record<string, string> = { $: 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY' };
const WORDS: Record<string, string> = {
  dollar: 'USD', dollars: 'USD', bucks: 'USD', usd: 'USD', euro: 'EUR', euros: 'EUR', eur: 'EUR',
  pound: 'GBP', pounds: 'GBP', gbp: 'GBP', peso: 'MXN', pesos: 'MXN', mxn: 'MXN', cad: 'CAD', jpy: 'JPY', yen: 'JPY',
};

// approx? symbol? number word/code?
const MONEY = /(\b(?:about|around|approximately|approx\.?|roughly|nearly|almost|maybe|like|~)\s*)?(?:(\$|€|£|¥|\b(?:USD|EUR|GBP|MXN|CAD)\b)\s?)?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)(?![\d/])(?:\s*(dollars?|bucks|usd|euros?|eur|pounds?|gbp|pesos?|mxn|cad|yen|jpy)\b)?/gi;

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
  const out: (AmountMatch & { marked: boolean })[] = [];
  MONEY.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MONEY.exec(text))) {
    const numStart = m.index + m[0].indexOf(m[3]!, m[1]?.length ?? 0);
    const start = m.index;
    const end = start + m[0].length;
    if (excluded.some((r) => numStart < r.end && numStart + m![3]!.length > r.start)) continue;
    const marked = !!(m[2] || m[4]);
    if (!marked && NOT_MONEY_AFTER.test(text.slice(end))) continue;
    const cents = toCents(m[3]!);
    if (cents === null || cents <= 0) continue;
    const sym = m[2] ? SYMBOLS[m[2]] ?? m[2].toUpperCase() : null;
    const word = m[4] ? WORDS[m[4].toLowerCase()] ?? null : null;
    out.push({ start, end, text: m[0].trim(), cents, approximate: !!m[1], currency: sym ?? word, marked });
  }
  const anyMarked = out.some((a) => a.marked);
  return out.filter((a) => a.marked || !anyMarked).map(({ marked: _m, ...a }) => a);
}
