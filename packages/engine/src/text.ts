/** Deterministic text helpers for merchants and statement descriptions. */

const NOISE = [
  /\b(pos|debit|credit|card|purchase|recurring|payment|pmt|ach|visa|mastercard|mc|checkcard|chk|web|online|transaction|txn|ref|auth|preauthorized|electronic|withdrawal|deposit)\b/g,
  /\b\d{2}\/\d{2}(\/\d{2,4})?\b/g, // dates
  /#\s?\d+/g, // store numbers
  /\b[x*]{2,}\d*\b/g, // masked card numbers
  /\b\d{4,}\b/g, // long digit runs
];

/** Lowercase, strip noise words / numbers / punctuation. Used for matching only, never displayed. */
export function normalizeDescription(text: string): string {
  let s = text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
  for (const re of NOISE) s = s.replace(re, ' ');
  return s.replace(/[^a-z0-9& ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Clean merchant name for display: keeps original words, trims bank noise conservatively. */
export function cleanMerchant(raw: string): string {
  let s = raw.trim().replace(/\s+/g, ' ');
  s = s.replace(/^(pos|debit card purchase|debit purchase|purchase|checkcard|card purchase|recurring payment)\s*[-:]?\s*/i, '');
  s = s.replace(/\s+#\s?\d+.*$/, '');
  s = s.replace(/\s+\d{2}\/\d{2}(\/\d{2,4})?.*$/, '');
  s = s.replace(/\s+[x*]{2,}\d*.*$/i, '');
  s = s.trim();
  if (!s) return raw.trim();
  // Title-case ALL CAPS descriptions for readability; leave mixed case alone.
  if (s === s.toUpperCase()) {
    s = s.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase());
  }
  return s;
}

export function tokens(text: string): Set<string> {
  return new Set(normalizeDescription(text).split(' ').filter((t) => t.length > 1));
}

/** Jaccard similarity of normalized tokens, 0..1. */
export function similarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 && tb.size === 0) return normalizeDescription(a) === normalizeDescription(b) ? 1 : 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Key used for merchant memory (category suggestions). */
export function merchantKey(text: string): string {
  return normalizeDescription(text).split(' ').slice(0, 3).join(' ');
}
