import { buildMerchantMemory, merchantKey } from '@clarity/engine';
import { suggestCategory } from '@clarity/import';
import type { Account, Category, ID, ISODate } from '@clarity/shared';
import { findAmounts, type AmountMatch } from './amounts';
import { findDates, type DateMatch } from './dates';
import { CATEGORY_WORDS, KNOWN_MERCHANTS, MERCHANT_STOP } from './lexicon';
import type { CaptureContext, CaptureDraft, DraftKind, DraftSplit, Interpreter, Source, TransferRole } from './types';

/**
 * The on-device interpreter. Deterministic rules, no network, no model: the same words always give
 * the same drafts. Anything it is not sure about is left empty or flagged for the user, never guessed.
 */
export interface LocalResult {
  drafts: CaptureDraft[];
  /** Sentences with no amount that Capture could not turn into anything. */
  notUnderstood: string[];
}

export const localInterpreter: Interpreter = {
  id: 'clarity-local-v1',
  runsOn: 'device',
  interpret: async (text, ctx) => interpretLocal(text, ctx),
};

interface Sentence { text: string }
interface Chunk { text: string; amount: AmountMatch; dates: DateMatch[]; split?: { parts: { amount: AmountMatch; label: string }[] } }

const SEP = /,|;|\band\b|\bthen\b|\bplus\b|\balso\b|&/gi;

function sentences(text: string): Sentence[] {
  // Split on . ! ? ; or new lines, but not on the decimal point in "45.50".
  return text.split(/(?<=[!?;])\s+|(?<=\.)\s+(?=\S)|\n+/).map((t) => ({ text: t.trim() })).filter((s) => s.text.length > 0);
}

/** Split one sentence into one chunk per amount (or one split chunk for "$120 at Costco: $70 …, $30 …"). */
function chunksOf(s: string, today: ISODate): Chunk[] {
  const dates = findDates(s, today);
  const amounts = findAmounts(s, dates);
  if (amounts.length === 0) return [];
  // Split purchase: a total, then a colon / "split" / "between", then two or more parts.
  const splitAt = s.search(/:|\bsplit\b|\bbetween\b|\bbroken down\b|\bdivided\b|—|\(/i);
  if (amounts.length >= 3 && splitAt > amounts[0]!.start) {
    const parts = amounts.slice(1).filter((a) => a.start > splitAt);
    if (parts.length >= 2 && parts.length === amounts.length - 1) {
      return [{ text: s, amount: amounts[0]!, dates, split: { parts: parts.map((a, i) => ({ amount: a, label: partLabel(s, a, parts[i + 1]?.start ?? s.length) })) } }];
    }
  }
  const out: Chunk[] = [];
  let from = 0;
  amounts.forEach((a, i) => {
    const next = amounts[i + 1];
    let to = s.length;
    if (next) {
      // last separator between this amount and the next one
      to = next.start;
      SEP.lastIndex = a.end;
      let m: RegExpExecArray | null;
      while ((m = SEP.exec(s)) && m.index < next.start) to = m.index;
    }
    const text = s.slice(from, to);
    out.push({ text, amount: { ...a, start: a.start - from, end: a.end - from }, dates: dates.filter((d) => d.start >= from && d.end <= to).map((d) => ({ ...d, start: d.start - from, end: d.end - from })) });
    from = to;
  });
  return out;
}

function partLabel(s: string, a: AmountMatch, limit: number): string {
  const after = s.slice(a.end, limit).split(/,|;|\band\b|\.|\)/i)[0]!.replace(/^\s*(?:on|for|of|in)\s+/i, '').trim();
  if (after) return after;
  const before = s.slice(0, a.start).split(/,|;|\band\b|:/i).pop()!.trim();
  return before;
}

// ───────────── cues ─────────────
const CUE = {
  transfer: /\b(?:transferr?(?:ed|ing)?|moved?|moving)\b/i,
  savings: /\b(?:saved|save|put|added|contributed|deposited|stash(?:ed)?)\b.*\b(?:savings|emergency fund)\b|\b(?:to|into)\s+(?:my\s+)?savings\b/i,
  card: /\b(?:paid|pay|paying)\s+(?:off\s+)?(?:my|the)\s+(?:[\w-]+\s+)?(?:credit\s+card|card|visa|mastercard|amex|discover)\b|\b(?:toward|towards|to|off)\s+(?:my|the)\s+(?:[\w-]+\s+)?(?:credit\s+card|card|visa|mastercard|amex|discover)(?:\s+bill)?\b|\bcard\s+(?:payment|bill)\b/i,
  refund: /\b(?:refund(?:ed)?|reimburs\w*|returned|money\s+back|got\b.*\bback|credit\s+from)\b/i,
  income: /\b(?:received|receive|got\s+paid|paycheck|pay\s?check|salary|payroll|earned|earn|income|bonus|sold|selling|deposit(?:ed)?|paid\s+me|venmo(?:ed)?\s+me|tips?|made|got)\b/i,
  expense: /\b(?:spent|spend|paid|pay|bought|buy|purchased|cost|charged|ordered|grabbed|got\s+charged)\b/i,
  paycheck: /\b(?:paycheck|pay\s?check|salary|payroll|wages?)\b/i,
};

function kindOf(t: string, cardNames: RegExp | null): { kind: DraftKind; role: TransferRole | null } | null {
  if (CUE.transfer.test(t) && !CUE.card.test(t)) return { kind: 'transfer', role: 'transfer' };
  if (CUE.savings.test(t)) return { kind: 'transfer', role: 'savings' };
  if (CUE.card.test(t) || (cardNames && /\b(?:paid|pay|paying|payment)\b/i.test(t) && /\b(?:toward|towards|to|off|on)\b/i.test(t) && cardNames.test(t))) return { kind: 'transfer', role: 'card_payment' };
  if (CUE.transfer.test(t)) return { kind: 'transfer', role: 'transfer' };
  if (CUE.refund.test(t)) return { kind: 'refund', role: null };
  if (CUE.income.test(t) && !/\b(?:spent|bought|paid\s+(?!me))\b/i.test(t)) return { kind: 'income', role: null };
  if (CUE.expense.test(t)) return { kind: 'expense', role: null };
  return null;
}

// ───────────── accounts ─────────────
interface AccountHit { account: Account | null; words: string; start: number }

function accountAliases(a: Account, accounts: readonly Account[]): string[] {
  const names = [a.name.toLowerCase()];
  const one = (t: Account['type']) => accounts.filter((x) => !x.archived && x.type === t).length === 1;
  if (a.type === 'checking' && one('checking')) names.push('checking', 'checking account', 'debit card', 'debit', 'bank account', 'bank');
  if (a.type === 'savings' && one('savings')) names.push('savings', 'savings account');
  if (a.type === 'cash' && one('cash')) names.push('cash', 'wallet');
  if (a.type === 'credit_card') {
    if (one('credit_card')) names.push('credit card', 'card');
    // A brand word only means this card if the card's name says so ("Amex" never means "Chase Visa").
    for (const brand of ['visa', 'mastercard', 'amex', 'discover']) if (a.name.toLowerCase().includes(brand)) names.push(brand);
  }
  return names;
}

const ACCOUNT_WORD = /\b(checking(?: account)?|savings(?: account)?|cash|debit(?: card)?|credit card|card|visa|mastercard|amex|discover|bank(?: account)?)\b/i;

/** "from my checking", "with my Visa", "to savings": which account, and was it one that exists? */
function findAccount(t: string, prepositions: string, accounts: readonly Account[]): AccountHit | null {
  const active = accounts.filter((a) => !a.archived);
  const re = new RegExp(`\\b(?:${prepositions})\\s+(?:my\\s+|the\\s+|our\\s+)?([\\w'&-]+(?:\\s+[\\w'&-]+){0,3})`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const words = m[1]!.toLowerCase();
    let best: { a: Account; len: number } | null = null;
    for (const a of active) for (const alias of accountAliases(a, active)) {
      if ((words === alias || words.startsWith(`${alias} `)) && (!best || alias.length > best.len)) best = { a, len: alias.length };
    }
    if (best) return { account: best.a, words: m[1]!.slice(0, best.len), start: m.index };
    const generic = ACCOUNT_WORD.exec(words);
    if (generic && words.startsWith(generic[0])) return { account: null, words: m[1]!.slice(0, generic[0].length), start: m.index };
  }
  return null;
}

// ───────────── merchant ─────────────
function titleCase(w: string): string {
  return w.split(/\s+/).map((x) => (x === x.toLowerCase() ? x.charAt(0).toUpperCase() + x.slice(1) : x)).join(' ');
}

const mkey = (x: string) => x.toLowerCase().replace(/['’]/g, '');

function canonicalMerchant(raw: string, known: readonly string[]): string {
  const k = mkey(raw);
  return known.find((m) => mkey(m) === k) ?? KNOWN_MERCHANTS.find((m) => mkey(m) === k) ?? titleCase(raw);
}

function knownMerchant(raw: string, known: readonly string[]): string | null {
  const k = mkey(raw);
  return known.find((m) => mkey(m) === k) ?? KNOWN_MERCHANTS.find((m) => mkey(m) === k) ?? null;
}

const FILLER = /^(?:i|we|you|just|also|and|then|so|have|had|has|spent|spend|paid|pay|bought|buy|purchased|got|get|grabbed|ordered|for|on|at|the|a|an|my|our|some|was|were|is|it|of)$/i;

/** "Coffee $4.50", "Paid rent $1,400", "$120 electric bill": the user's own words around the amount. */
function wordsAroundAmount(words: string, amountStart: number, amountEnd: number): string {
  const take = (seg: string) => {
    const toks = seg.split(/\s+/).map((t) => t.replace(/[.,;:!?()]+$/g, '')).filter(Boolean);
    while (toks.length && FILLER.test(toks[0]!)) toks.shift();
    const out: string[] = [];
    for (const t of toks) {
      if (MERCHANT_STOP.test(t) || !/^[a-z][\w'’&-]*$/i.test(t)) break;
      out.push(t);
      if (out.length >= 3) break;
    }
    return out.join(' ');
  };
  return take(words.slice(0, amountStart)) || take(words.slice(amountEnd));
}

/** Words after a keyword, up to a stop word, punctuation, a number or a date. */
function wordsAfter(t: string, idx: number): string {
  const tokens = t.slice(idx).split(/\s+/);
  const out: string[] = [];
  for (const raw of tokens) {
    const tok = raw.replace(/^[("']+/, '');
    if (!tok) continue;
    const clean = tok.replace(/[.,;:!?)]+$/, '');
    if (out.length === 0 && /^(?:my|the|a|an|our)$/i.test(clean)) continue;
    if (!clean || MERCHANT_STOP.test(clean) || /^[$€£¥]|\d/.test(clean)) break;
    out.push(clean);
    if (clean !== tok || out.length >= 4) break; // punctuation ends the name
  }
  return out.join(' ');
}

function findMerchant(t: string, kind: DraftKind, known: readonly string[]): string {
  const patterns: RegExp[] =
    kind === 'refund' ? [/\brefund(?:ed)?\s+from\s+/i, /\bfrom\s+/i, /\bat\s+/i]
      : kind === 'income' ? [/\bfrom\s+(?!selling)/i]
        : [/\bat\s+/i, /@\s*/, /\bfrom\s+/i, /\bto\s+(?!my\b|the\b|savings\b|checking\b)/i];
  for (const p of patterns) {
    const m = p.exec(t);
    if (!m) continue;
    const w = wordsAfter(t, m.index + m[0].length);
    if (w) return canonicalMerchant(w, known);
  }
  // A known merchant or one the user has used before, anywhere in the text ("walmart $45").
  const lower = mkey(t);
  const hit = [...known, ...KNOWN_MERCHANTS].filter((m) => m.length > 2 && new RegExp(`\\b${mkey(m).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lower)).sort((a, b) => b.length - a.length)[0];
  if (hit) return hit;
  if (kind === 'refund') {
    const before = /\b([A-Z][\w'&-]*(?:\s+[A-Z][\w'&-]*){0,2})\s+refund/.exec(t);
    if (before) return before[1]!;
  }
  return '';
}

// ───────────── categories ─────────────
function categoryPhrase(t: string): string | null {
  const m = /\b(?:on|for)\s+(?!(?:my|the|a|an|with|using|at|from|via|by|to|in|on|our)\b)([a-z][a-z' -]*?)(?=\s+(?:at|from|with|using|today|yesterday|this|last|and|on)\b|[,.;:]|$)/i.exec(t);
  return m ? m[1]!.trim().toLowerCase() : null;
}

function singular(w: string): string {
  return w.replace(/ies$/, 'y').replace(/s$/, '');
}

function matchCategory(words: string, cats: readonly Category[]): Category | null {
  const w = singular(words.toLowerCase().trim());
  if (!w) return null;
  const exact = cats.find((c) => singular(c.name.toLowerCase()) === w);
  if (exact) return exact;
  const contains = cats.filter((c) => {
    const n = singular(c.name.toLowerCase());
    return n.length > 2 && (w.includes(n) || n.split(/\s*&\s*|\s+and\s+/).some((part) => part.length > 2 && w === singular(part)));
  });
  if (contains.length === 1) return contains[0]!;
  for (const [re, id] of CATEGORY_WORDS) if (re.test(words)) return cats.find((c) => c.id === id) ?? null;
  return null;
}

// ───────────── main ─────────────
export function interpretLocal(text: string, ctx: CaptureContext): LocalResult {
  const drafts: CaptureDraft[] = [];
  const notUnderstood: string[] = [];
  const known = [...new Set(ctx.transactions.map((t) => t.merchant).filter((m) => m && m.length > 1))];
  const memory = buildMerchantMemory(ctx.transactions, merchantKey);
  const activeCats = ctx.categories.filter((c) => !c.archived);
  const cardAccounts = ctx.accounts.filter((a) => !a.archived && a.type === 'credit_card');
  const cardNames = cardAccounts.length ? new RegExp(`\\b(?:${cardAccounts.map((a) => a.name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i') : null;
  const active = ctx.accounts.filter((a) => !a.archived);
  const cashDefault = (): Account | null => {
    const d = active.find((a) => a.id === ctx.defaultAccountId && a.type !== 'credit_card');
    return d ?? active.find((a) => a.type === 'checking') ?? active.find((a) => a.type !== 'credit_card') ?? null;
  };

  let carriedDate: ISODate | null = null;
  for (const s of sentences(text)) {
    const chunks = chunksOf(s.text, ctx.today);
    if (chunks.length === 0) {
      if (/[a-z]{3}/i.test(s.text)) notUnderstood.push(s.text);
      continue;
    }
    let carriedKind: { kind: DraftKind; role: TransferRole | null } | null = null;
    chunks.forEach((c, i) => {
      // Text without the amount and date phrases, for finding words.
      let words = c.text;
      for (const r of [c.amount, ...c.dates, ...(c.split?.parts.map((p) => p.amount) ?? [])].sort((a, b) => b.start - a.start)) {
        if (r.start >= 0 && r.end <= words.length) words = `${words.slice(0, r.start)} ${' '.repeat(Math.max(0, r.end - r.start - 1))}${words.slice(r.end)}`;
      }
      const lower = words.toLowerCase();

      // Date
      const own = c.dates[0];
      let date: ISODate | null = null;
      let dateSource: CaptureDraft['dateSource'] = 'none';
      let dateText: string | null = null;
      let dateAmbiguous = false;
      if (own) {
        date = own.date;
        dateSource = 'words';
        dateText = own.text;
        dateAmbiguous = own.ambiguous;
      } else if (carriedDate) {
        date = carriedDate;
        dateSource = 'carried';
      } else {
        const later = chunks.slice(i + 1).flatMap((x) => x.dates).find((d) => d.date);
        if (later) {
          date = later.date;
          dateSource = 'later';
          dateText = later.text;
        } else {
          date = ctx.today;
          dateSource = 'none';
        }
      }
      if (own?.date) carriedDate = own.date;

      // Kind
      const k = kindOf(lower, cardNames) ?? carriedKind;
      carriedKind = k;
      const kind: DraftKind = k?.kind ?? 'expense';
      const role = k?.role ?? null;

      // Merchant / description
      let merchant = kind === 'transfer' ? '' : findMerchant(words, kind, known);
      let merchantSource: CaptureDraft['merchantSource'] = merchant ? 'words' : null;
      if (kind === 'income' && !merchant) {
        const sold = /\b(?:from\s+)?(?:selling|sold)\s+(?:my\s+|the\s+|an?\s+)?([a-z][\w' -]*?)(?=\s+(?:on|for|to|today|yesterday)\b|[,.;]|$)/i.exec(words);
        if (sold) { merchant = `Sold ${sold[1]!.trim()}`; merchantSource = 'words'; }
        else if (CUE.paycheck.test(lower)) { merchant = 'Paycheck'; merchantSource = 'words'; }
      }
      const phrase = c.split ? null : categoryPhrase(words);
      if (!merchant && kind !== 'transfer' && !c.split) {
        const around = wordsAroundAmount(words, c.amount.start, c.amount.end);
        const named = around ? knownMerchant(around, known) : null;
        if (named) { merchant = named; merchantSource = 'words'; }
        else if (phrase) { merchant = titleCase(phrase); merchantSource = 'description'; }
        else if (around) { merchant = around.charAt(0).toUpperCase() + around.slice(1); merchantSource = 'description'; }
      }

      // Category
      let categoryId: ID | null = null;
      let categorySource: Source = null;
      let categoryWords: string | null = null;
      const pool = activeCats.filter((x) => x.kind === (kind === 'income' ? 'income' : 'expense'));
      if (kind === 'income') {
        const id = CUE.paycheck.test(lower) ? 'cat_paycheck' : 'cat_other_income';
        if (pool.some((x) => x.id === id)) { categoryId = id; categorySource = CUE.paycheck.test(lower) ? 'words' : 'rule'; }
      } else if (kind !== 'transfer' && !c.split) {
        const byPhrase = phrase ? matchCategory(phrase, pool) : null;
        const byWords = byPhrase ?? (() => {
          const rest = lower.replace(merchant.toLowerCase(), '');
          const own = pool.find((x) => x.name.length > 3 && new RegExp(`\\b${singular(x.name.toLowerCase()).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(rest));
          if (own) return own;
          for (const [re, id] of CATEGORY_WORDS) if (re.test(rest)) return pool.find((x) => x.id === id) ?? null;
          return null;
        })();
        if (byWords) { categoryId = byWords.id; categorySource = 'words'; }
        else {
          if (phrase && merchantSource !== 'description') categoryWords = phrase;
          if (phrase && merchantSource === 'description') categoryWords = phrase;
          const mem = merchant ? memory.get(merchantKey(merchant)) : undefined;
          if (mem?.categoryId && pool.some((x) => x.id === mem.categoryId)) { categoryId = mem.categoryId; categorySource = 'memory'; categoryWords = null; }
          else if (merchant) {
            const r = suggestCategory(merchant, false, new Map(), '');
            if (r.categoryId && pool.some((x) => x.id === r.categoryId)) { categoryId = r.categoryId; categorySource = 'rule'; }
          }
        }
      }

      // Splits
      const splits: DraftSplit[] = c.split ? c.split.parts.map((p) => ({ label: p.label, amountCents: p.amount.cents, categoryId: matchCategory(p.label, pool)?.id ?? null })) : [];

      // Accounts
      let accountId: ID | null = null;
      let accountSource: Source = null;
      let accountWords: string | null = null;
      let toAccountId: ID | null = null;
      let toAccountWords: string | null = null;
      if (kind === 'transfer') {
        const fromHit = findAccount(lower, 'from', ctx.accounts);
        const toHit = findAccount(lower, 'to|into|toward|towards|off|on', ctx.accounts);
        if (role === 'card_payment') {
          const card = toHit?.account?.type === 'credit_card' ? toHit.account : cardAccounts.length === 1 ? cardAccounts[0]! : (cardNames && cardAccounts.find((a) => new RegExp(`\\b${a.name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lower))) || null;
          toAccountId = card?.id ?? null;
          if (!card) toAccountWords = toHit?.words ?? 'credit card';
        } else if (role === 'savings') {
          const savings = toHit?.account ?? (active.filter((a) => a.type === 'savings').length === 1 ? active.find((a) => a.type === 'savings')! : null);
          toAccountId = savings?.id ?? null;
          if (!savings) toAccountWords = toHit?.words ?? 'savings';
        } else {
          toAccountId = toHit?.account?.id ?? null;
          if (toHit && !toHit.account) toAccountWords = toHit.words;
        }
        if (fromHit?.account) { accountId = fromHit.account.id; accountSource = 'words'; }
        else if (fromHit) { accountWords = fromHit.words; }
        else {
          const d = cashDefault();
          if (d && d.id !== toAccountId) { accountId = d.id; accountSource = 'default'; }
        }
      } else {
        const hit = findAccount(lower, 'with|using|on|via|from|by|in|into|to', ctx.accounts);
        if (hit?.account) { accountId = hit.account.id; accountSource = 'words'; }
        else {
          if (hit && !hit.account) accountWords = hit.words;
          const mem = merchant ? memory.get(merchantKey(merchant)) : undefined;
          const memAcct = mem && active.find((a) => a.id === mem.accountId);
          const def = active.find((a) => a.id === ctx.defaultAccountId) ?? cashDefault();
          if (memAcct && !accountWords) { accountId = memAcct.id; accountSource = 'memory'; }
          else if (def) { accountId = def.id; accountSource = 'default'; }
        }
      }

      const hasCue = !!kindOf(lower, cardNames);
      const kindUnclear = kind === 'expense' && !merchant && !categoryId && !c.split && (!hasCue || /^\W*(?:i\s+)?(?:paid|pay)\b/i.test(words.trim()));

      drafts.push({
        id: `d${drafts.length + 1}`,
        kind,
        role,
        amountCents: c.amount.cents,
        approximate: c.amount.approximate,
        currency: c.amount.currency ?? ctx.currency,
        currencyWritten: c.amount.currency !== null,
        merchant,
        merchantSource,
        date,
        dateSource,
        dateText,
        dateAmbiguous,
        categoryId: c.split ? null : categoryId,
        categorySource: c.split ? null : categorySource,
        categoryWords: c.split ? null : categoryWords,
        accountId,
        accountSource,
        accountWords,
        toAccountId,
        toAccountWords,
        splits,
        kindUnclear,
        sourceText: c.text.trim().replace(/^(?:,|and|then|plus|also|&|;)\s+/i, ''),
        acknowledged: [],
      });
    });
  }
  return { drafts, notUnderstood };
}
