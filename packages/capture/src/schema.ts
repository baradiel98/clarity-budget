import { isValidISO, type ISODate } from '@clarity/shared';
import type { TxInput } from '@clarity/data';
import type { CaptureContext, CaptureDraft, DraftKind, DraftSplit, IssueCode, TransferRole } from './types';
import { reviewDraft } from './review';

/**
 * Interpreter output is untrusted (today it is the local interpreter; later it could be a cloud model).
 * Every field is checked here before anything is shown as a draft:
 * - wrong types are rejected;
 * - unknown category or account ids are dropped (and then flagged by review);
 * - amounts must be positive whole cents.
 */
export type ParseResult = { ok: true; drafts: CaptureDraft[] } | { ok: false; error: string };

const KINDS: readonly DraftKind[] = ['expense', 'income', 'refund', 'transfer'];
const ROLES: readonly TransferRole[] = ['transfer', 'card_payment', 'savings'];
const MAX_DRAFTS = 50;
const MAX_TEXT = 200;

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const str = (x: unknown, max = MAX_TEXT): string | null => (typeof x === 'string' ? x.slice(0, max) : null);
const cents = (x: unknown): number | null => (typeof x === 'number' && Number.isSafeInteger(x) && x > 0 ? x : null);

export function parseDrafts(raw: unknown, ctx: CaptureContext): ParseResult {
  if (!isObj(raw) || !Array.isArray(raw.drafts)) return { ok: false, error: 'The interpreter returned something Clarity could not read.' };
  if (raw.drafts.length > MAX_DRAFTS) return { ok: false, error: `That is more than ${MAX_DRAFTS} items at once. Split it into smaller messages.` };
  const catIds = new Set(ctx.categories.filter((c) => !c.archived).map((c) => c.id));
  const acctIds = new Set(ctx.accounts.filter((a) => !a.archived).map((a) => a.id));
  const drafts: CaptureDraft[] = [];
  for (const [i, d] of raw.drafts.entries()) {
    if (!isObj(d)) return { ok: false, error: `Item ${i + 1} is not valid.` };
    const kind = KINDS.includes(d.kind as DraftKind) ? (d.kind as DraftKind) : null;
    if (!kind) return { ok: false, error: `Item ${i + 1} has an unknown type.` };
    if (d.amountCents !== null && cents(d.amountCents) === null) return { ok: false, error: `Item ${i + 1} has an invalid amount.` };
    const date = d.date === null ? null : str(d.date, 10);
    if (date !== null && !isValidISO(date)) return { ok: false, error: `Item ${i + 1} has an invalid date.` };
    const splitsRaw = Array.isArray(d.splits) ? d.splits : [];
    const splits: DraftSplit[] = [];
    for (const s of splitsRaw) {
      if (!isObj(s) || cents(s.amountCents) === null) return { ok: false, error: `Item ${i + 1} has an invalid split.` };
      splits.push({ label: str(s.label) ?? '', amountCents: s.amountCents as number, categoryId: typeof s.categoryId === 'string' && catIds.has(s.categoryId) ? s.categoryId : null });
    }
    const acct = (x: unknown) => (typeof x === 'string' && acctIds.has(x) ? x : null);
    const catId = typeof d.categoryId === 'string' && catIds.has(d.categoryId) ? d.categoryId : null;
    drafts.push({
      id: str(d.id, 40) ?? `d${i + 1}`,
      kind,
      role: kind === 'transfer' ? (ROLES.includes(d.role as TransferRole) ? (d.role as TransferRole) : 'transfer') : null,
      amountCents: d.amountCents === null ? null : (d.amountCents as number),
      approximate: d.approximate === true,
      currency: (str(d.currency, 3) ?? ctx.currency).toUpperCase(),
      currencyWritten: d.currencyWritten === true,
      merchant: (str(d.merchant, 80) ?? '').trim(),
      merchantSource: d.merchantSource === 'description' ? 'description' : str(d.merchant) ? 'words' : null,
      date: date as ISODate | null,
      dateSource: (['words', 'carried', 'later', 'none'] as const).find((x) => x === d.dateSource) ?? (date ? 'none' : null),
      dateText: str(d.dateText, 60),
      dateAmbiguous: d.dateAmbiguous === true,
      categoryId: kind === 'transfer' ? null : catId,
      categorySource: catId ? ((['words', 'memory', 'rule', 'default'] as const).find((x) => x === d.categorySource) ?? 'rule') : null,
      categoryWords: str(d.categoryWords, 60),
      accountId: acct(d.accountId),
      accountSource: acct(d.accountId) ? ((['words', 'memory', 'rule', 'default'] as const).find((x) => x === d.accountSource) ?? 'default') : null,
      accountWords: str(d.accountWords, 60),
      toAccountId: kind === 'transfer' ? acct(d.toAccountId) : null,
      toAccountWords: str(d.toAccountWords, 60),
      splits: kind === 'expense' ? splits : [],
      kindUnclear: d.kindUnclear === true,
      sourceText: str(d.sourceText, 500) ?? '',
      acknowledged: [] as IssueCode[],
    });
  }
  return { ok: true, drafts };
}

/**
 * An approved draft → the same input manual entry uses. Returns null if anything still blocks it,
 * so a draft with open questions can never be saved.
 */
export function toTxInput(d: CaptureDraft, ctx: CaptureContext): TxInput | null {
  if (reviewDraft(d, ctx).some((i) => i.blocking)) return null;
  const provenance = { source: 'capture' as const, rawDescription: d.sourceText.slice(0, 500) };
  const base = { accountId: d.accountId!, date: d.date!, amountCents: d.amountCents!, provenance };
  if (d.kind === 'transfer') {
    const to = ctx.accounts.find((a) => a.id === d.toAccountId)!;
    const label = d.role === 'card_payment' ? `Payment to ${to.name}` : `Transfer to ${to.name}`;
    return { ...base, kind: 'transfer', toAccountId: to.id, merchant: d.merchant.trim() || label, categoryId: null };
  }
  if (d.kind === 'expense' && d.splits.length) {
    return { ...base, kind: 'expense', merchant: d.merchant.trim(), categoryId: null, splits: d.splits.map((s) => ({ categoryId: s.categoryId!, amountCents: s.amountCents })) };
  }
  return { ...base, kind: d.kind, merchant: d.merchant.trim(), categoryId: d.categoryId };
}
