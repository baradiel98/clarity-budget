import {
  addDays, diffDays, type Account, type Cents, type ColumnMapping, type DateFormat, type DecimalSeparator, type ID, type ISODate,
  type ImportBatch, type OccurrenceException, type RecurringItem, type SignConvention, type Transaction,
} from '@clarity/shared';
import {
  accountBalance, buildMerchantMemory, cleanMerchant, expandOccurrences, merchantKey, normalizeDescription, similarity,
  suggestOccurrenceMatch, type Occurrence,
} from '@clarity/engine';
import { CARD_PAYMENT_RE, REFUND_RE, TRANSFER_RE, suggestCategory, type CategorySource } from './categorize';
import { dataRows } from './mapping';
import { parseStatementAmount, parseStatementDate } from './normalize';
import { MAX_IMPORT_ROWS, type RawTable } from './parsers';

export type CandidateKind = 'expense' | 'income' | 'refund' | 'transfer';
export type Confidence = 'high' | 'medium' | 'low';

export interface ImportCandidate {
  rowNumber: number;
  date: ISODate;
  /** Signed effect on the target account (after sign convention). */
  amountCents: Cents;
  rawDescription: string;
  merchant: string;
  balanceCents: Cents | null;
  externalId: string | null;
  kind: CandidateKind;
  /** Suggested; the user picks the other account in review before it can be imported as a transfer. */
  looksLikeTransfer: boolean;
  categoryId: ID | null;
  categorySource: CategorySource;
  confidence: Confidence;
  reasons: string[];
  duplicate: { level: 'exact' | 'likely'; txId: ID; reason: string } | null;
  repeatInFile: boolean;
  occurrenceMatch: { key: string; recurringId: ID; originalDate: ISODate; name: string } | null;
  /** Default decision for the review screen. The user can change it. */
  include: boolean;
}

export interface ImportRowError {
  rowNumber: number;
  raw: string;
  reason: string;
}

export interface ImportSettings {
  hasHeader: boolean;
  columns: ColumnMapping;
  dateFormat: DateFormat;
  decimalSeparator: DecimalSeparator;
  signConvention: SignConvention;
}

export interface PreviewContext {
  account: Account;
  accounts: readonly Account[];
  transactions: readonly Transaction[];
  recurring: readonly RecurringItem[];
  exceptions: readonly OccurrenceException[];
  importBatches: readonly ImportBatch[];
  fileHash: string;
  today: ISODate;
}

export interface ReconciliationPreview {
  statementBalanceCents: Cents;
  statementDate: ISODate;
  /** App balance on that date if the included rows are imported. */
  appBalanceCents: Cents;
  differenceCents: Cents;
  /** Whether the file's running balance column agrees with its amounts. */
  runningBalanceConsistent: boolean | null;
  note?: string;
}

export interface ImportPreview {
  candidates: ImportCandidate[];
  errors: ImportRowError[];
  skippedBlank: number;
  fileAlreadyImported: ImportBatch | null;
  dateRange: { from: ISODate; to: ISODate } | null;
  runningBalanceConsistent: boolean | null;
  truncated: boolean;
}

const cell = (cells: readonly string[], i: number | undefined) => (i === undefined ? '' : (cells[i] ?? '').trim());

/** Amount as written in the file: signed column, or credit − debit. */
function rawAmount(cells: readonly string[], c: ColumnMapping, dec: DecimalSeparator): Cents | null | 'empty' {
  if (c.amount !== undefined) {
    const v = cell(cells, c.amount);
    return v === '' ? 'empty' : parseStatementAmount(v, dec);
  }
  const d = cell(cells, c.debit);
  const cr = cell(cells, c.credit);
  if (d === '' && cr === '') return 'empty';
  const dv = d === '' ? 0 : parseStatementAmount(d, dec);
  const cv = cr === '' ? 0 : parseStatementAmount(cr, dec);
  if (dv === null || cv === null) return null;
  return Math.abs(cv) - Math.abs(dv);
}

/** Does the running-balance column agree with the amounts (in file order, either direction)? */
export function runningBalanceCheck(rows: readonly { amount: Cents; balance: Cents | null; date: ISODate }[]): boolean | null {
  const withBal = rows.filter((r) => r.balance !== null) as { amount: Cents; balance: Cents; date: ISODate }[];
  if (withBal.length < 3) return null;
  const ascending = withBal[0]!.date <= withBal[withBal.length - 1]!.date;
  let ok = 0;
  let total = 0;
  for (let i = 1; i < withBal.length; i++) {
    const prev = withBal[i - 1]!;
    const cur = withBal[i]!;
    total++;
    if (ascending ? cur.balance === prev.balance + cur.amount : prev.balance === cur.balance + prev.amount) ok++;
  }
  return ok / total >= 0.9;
}

/** Choose the sign convention: running balance first, then account-type heuristics. */
export function suggestSignConvention(table: RawTable, s: Omit<ImportSettings, 'signConvention'>, account: Account): { convention: SignConvention; reason: string } {
  const rows: { amount: Cents; balance: Cents | null; date: ISODate }[] = [];
  for (const { cells } of dataRows(table, s.hasHeader)) {
    const a = rawAmount(cells, s.columns, s.decimalSeparator);
    const d = parseStatementDate(cell(cells, s.columns.date), s.dateFormat);
    const b = s.columns.balance !== undefined ? parseStatementAmount(cell(cells, s.columns.balance), s.decimalSeparator) : null;
    if (typeof a === 'number' && d) rows.push({ amount: a, balance: b, date: d });
  }
  if (s.columns.balance !== undefined) {
    if (runningBalanceCheck(rows)) return { convention: 'as_is', reason: 'The running balance in the file matches the amounts as written.' };
    if (runningBalanceCheck(rows.map((r) => ({ ...r, amount: -r.amount })))) {
      return { convention: 'invert', reason: 'The running balance only matches if amounts are reversed, so purchases are shown as positive in this file.' };
    }
  }
  if (account.type === 'credit_card' && rows.length > 0) {
    const positive = rows.filter((r) => r.amount > 0).length;
    if (positive / rows.length >= 0.6) return { convention: 'invert', reason: 'Most amounts are positive, which on a card statement usually means purchases. Check a few rows.' };
  }
  return { convention: 'as_is', reason: 'Negative amounts are treated as money out.' };
}

export function buildPreview(table: RawTable, s: ImportSettings, ctx: PreviewContext): ImportPreview {
  const { account } = ctx;
  const flip = s.signConvention === 'invert' ? -1 : 1;
  const errors: ImportRowError[] = [];
  const parsed: Omit<ImportCandidate, 'kind' | 'looksLikeTransfer' | 'categoryId' | 'categorySource' | 'confidence' | 'reasons' | 'duplicate' | 'repeatInFile' | 'occurrenceMatch' | 'include'>[] = [];
  let skippedBlank = 0;
  const rows = dataRows(table, s.hasHeader);
  const truncated = rows.length > MAX_IMPORT_ROWS;

  for (const { line, cells } of rows.slice(0, MAX_IMPORT_ROWS)) {
    if (cells.every((c) => c === '')) {
      skippedBlank++;
      continue;
    }
    const raw = cells.join(' | ');
    const dateText = cell(cells, s.columns.date);
    const date = parseStatementDate(dateText, s.dateFormat);
    const amt = rawAmount(cells, s.columns, s.decimalSeparator);
    const desc = cell(cells, s.columns.description);
    if (!date) {
      errors.push({ rowNumber: line, raw, reason: dateText ? `Date "${dateText}" doesn't match ${s.dateFormat}.` : 'Missing date.' });
      continue;
    }
    if (amt === 'empty') {
      errors.push({ rowNumber: line, raw, reason: 'Missing amount.' });
      continue;
    }
    if (amt === null) {
      errors.push({ rowNumber: line, raw, reason: 'Amount could not be read.' });
      continue;
    }
    if (amt === 0) {
      errors.push({ rowNumber: line, raw, reason: 'Amount is zero.' });
      continue;
    }
    const balText = s.columns.balance !== undefined ? cell(cells, s.columns.balance) : '';
    const bal = balText ? parseStatementAmount(balText, s.decimalSeparator) : null;
    parsed.push({
      rowNumber: line,
      date,
      amountCents: amt * flip,
      rawDescription: desc,
      merchant: desc ? cleanMerchant(desc) : '',
      balanceCents: bal === null ? null : bal * flip,
      externalId: cell(cells, s.columns.externalId) || null,
    });
  }

  const memory = buildMerchantMemory(ctx.transactions, merchantKey);
  const acctTx = ctx.transactions.filter((t) => t.accountId === account.id);
  const sortedAbs = parsed.map((p) => Math.abs(p.amountCents)).sort((a, b) => a - b);
  const median = sortedAbs[Math.floor(sortedAbs.length / 2)] ?? 0;

  // Duplicate bookkeeping: exact matches consume an existing tx so two identical coffees stay two.
  const consumed = new Set<ID>();
  const fileKeyCount = new Map<string, number>();
  for (const p of parsed) {
    const k = `${p.date}|${p.amountCents}|${normalizeDescription(p.rawDescription)}`;
    fileKeyCount.set(k, (fileKeyCount.get(k) ?? 0) + 1);
  }

  const dates = parsed.map((p) => p.date).sort();
  const range = dates.length ? { from: dates[0]!, to: dates[dates.length - 1]! } : null;
  const occurrences: Occurrence[] = range
    ? expandOccurrences(ctx.recurring, ctx.exceptions, ctx.transactions, { from: addDays(range.from, -10), to: addDays(range.to, 10), today: ctx.today })
    : [];
  const usedOcc = new Set<string>();

  const candidates: ImportCandidate[] = parsed.map((p) => {
    const reasons: string[] = [];
    let confidence: Confidence = 'high';
    const inflow = p.amountCents > 0;
    let kind: CandidateKind = inflow ? 'income' : 'expense';
    let looksLikeTransfer = TRANSFER_RE.test(p.rawDescription);
    if (account.type === 'credit_card') {
      if (inflow && CARD_PAYMENT_RE.test(p.rawDescription)) looksLikeTransfer = true;
      else if (inflow) kind = 'refund';
    } else {
      if (inflow && REFUND_RE.test(p.rawDescription)) kind = 'refund';
      if (!inflow && CARD_PAYMENT_RE.test(p.rawDescription)) looksLikeTransfer = true;
    }
    const cat = suggestCategory(p.rawDescription, kind === 'income', memory, merchantKey(p.merchant));

    if (!p.rawDescription) {
      confidence = 'medium';
      reasons.push('No description in the file.');
    }
    if (p.date > addDays(ctx.today, 31) || p.date < addDays(ctx.today, -366 * 5)) {
      confidence = 'low';
      reasons.push('Date is far from today. Check the date format.');
    }
    if (median > 0 && Math.abs(p.amountCents) >= 100000 && Math.abs(p.amountCents) >= median * 20) {
      if (confidence === 'high') confidence = 'medium';
      reasons.push('Much larger than the other amounts in this file.');
    }
    if (p.date < account.openingDate) reasons.push('Before the account’s opening date: kept as history, does not change the balance.');
    if (looksLikeTransfer) reasons.push('Looks like a transfer between your accounts. Choose the other account to import it as a transfer.');

    // Duplicates
    let duplicate: ImportCandidate['duplicate'] = null;
    const norm = normalizeDescription(p.rawDescription);
    const exact = acctTx.find(
      (t) =>
        !consumed.has(t.id) &&
        ((p.externalId && t.provenance.externalId === p.externalId) ||
          (t.provenance.source === 'import' && t.date === p.date && t.amountCents === p.amountCents && normalizeDescription(t.provenance.rawDescription ?? '') === norm)),
    );
    if (exact) {
      consumed.add(exact.id);
      duplicate = { level: 'exact', txId: exact.id, reason: p.externalId && exact.provenance.externalId === p.externalId ? 'Same transaction ID was already imported.' : 'Already imported from a previous statement.' };
    } else {
      const likely = acctTx.find(
        (t) =>
          !consumed.has(t.id) &&
          t.amountCents === p.amountCents &&
          Math.abs(diffDays(t.date, p.date)) <= 2 &&
          (t.kind === 'transfer' || similarity(t.merchant, p.rawDescription) >= 0.5 || similarity(t.provenance.rawDescription ?? t.merchant, p.rawDescription) >= 0.5 || (norm !== '' && normalizeDescription(t.merchant) !== '' && norm.includes(normalizeDescription(t.merchant)))),
      );
      if (likely) {
        consumed.add(likely.id);
        duplicate = { level: 'likely', txId: likely.id, reason: `Possible duplicate of “${likely.merchant || 'a transaction'}” on ${likely.date}.` };
      }
    }

    const k = `${p.date}|${p.amountCents}|${norm}`;
    const repeatInFile = (fileKeyCount.get(k) ?? 0) > 1;

    const occ = suggestOccurrenceMatch({ accountId: account.id, date: p.date, amountCents: p.amountCents, merchant: p.merchant }, occurrences.filter((o) => !usedOcc.has(o.key)));
    if (occ) usedOcc.add(occ.key);

    const include = !duplicate && confidence !== 'low' && !looksLikeTransfer;
    if (looksLikeTransfer && !duplicate) reasons.push('Not selected until you confirm the other account.');
    return {
      ...p,
      kind,
      looksLikeTransfer,
      categoryId: kind === 'refund' ? suggestCategory(p.rawDescription, false, memory, merchantKey(p.merchant)).categoryId : cat.categoryId,
      categorySource: cat.source,
      confidence,
      reasons,
      duplicate,
      repeatInFile,
      occurrenceMatch: occ ? { key: occ.key, recurringId: occ.recurringId, originalDate: occ.originalDate, name: occ.name } : null,
      include,
    };
  });

  const already = ctx.importBatches.find((b) => b.fileHash === ctx.fileHash && b.accountId === account.id && !b.undoneAt) ?? null;
  return {
    candidates,
    errors,
    skippedBlank,
    fileAlreadyImported: already,
    dateRange: range,
    runningBalanceConsistent: runningBalanceCheck(parsed.map((p) => ({ amount: p.amountCents, balance: p.balanceCents, date: p.date }))),
    truncated,
  };
}

/**
 * Compare the statement's closing balance with what the app's balance would be after importing
 * the included rows. Never applies an adjustment itself.
 */
export function reconcilePreview(preview: ImportPreview, included: readonly ImportCandidate[], ctx: Pick<PreviewContext, 'account' | 'transactions'>): ReconciliationPreview | null {
  const withBal = preview.candidates.filter((c) => c.balanceCents !== null);
  if (withBal.length === 0) return null;
  const ascending = withBal[0]!.date <= withBal[withBal.length - 1]!.date;
  const closing = ascending ? withBal[withBal.length - 1]! : withBal[0]!;
  const date = closing.date;
  if (date < ctx.account.openingDate) {
    return {
      statementBalanceCents: closing.balanceCents!,
      statementDate: date,
      appBalanceCents: ctx.account.openingBalanceCents,
      differenceCents: 0,
      runningBalanceConsistent: preview.runningBalanceConsistent,
      note: 'The statement ends before this account’s opening date, so it does not change the current balance.',
    };
  }
  const simulated: Transaction[] = [
    ...ctx.transactions,
    ...included.map((c, i) => ({
      id: `sim${i}`, accountId: ctx.account.id, date: c.date, amountCents: c.amountCents, kind: 'expense', status: 'confirmed', merchant: '',
      categoryId: null, notes: '', provenance: { source: 'import' }, createdAt: 0, updatedAt: 0,
    }) as Transaction),
  ];
  const app = accountBalance(ctx.account, simulated, date);
  return {
    statementBalanceCents: closing.balanceCents!,
    statementDate: date,
    appBalanceCents: app,
    differenceCents: closing.balanceCents! - app,
    runningBalanceConsistent: preview.runningBalanceConsistent,
  };
}
