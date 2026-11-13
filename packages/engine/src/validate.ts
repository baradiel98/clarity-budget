import { isValidISO, type Account, type Category, type Transaction } from '@clarity/shared';

export interface ValidationIssue {
  field: string;
  message: string;
}

/** Validate one transaction against the sign rules in docs/calculation-rules.md. */
export function validateTransaction(
  tx: Transaction,
  accounts: readonly Account[],
  categories: readonly Category[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const acct = accounts.find((a) => a.id === tx.accountId);
  if (!acct) issues.push({ field: 'accountId', message: 'Choose an account.' });
  if (!isValidISO(tx.date)) issues.push({ field: 'date', message: 'Enter a valid date.' });
  if (!Number.isSafeInteger(tx.amountCents)) issues.push({ field: 'amount', message: 'Amount must be whole cents.' });
  if (tx.amountCents === 0) issues.push({ field: 'amount', message: 'Amount cannot be zero.' });
  switch (tx.kind) {
    case 'expense':
      if (tx.amountCents > 0) issues.push({ field: 'amount', message: 'An expense must reduce the account balance.' });
      break;
    case 'income':
    case 'refund':
      if (tx.amountCents < 0) issues.push({ field: 'amount', message: `${tx.kind === 'income' ? 'Income' : 'A refund'} must increase the account balance.` });
      break;
    case 'transfer':
      if (!tx.transferGroupId) issues.push({ field: 'kind', message: 'A transfer needs both accounts.' });
      break;
    case 'adjustment':
      if (!tx.adjustmentReason) issues.push({ field: 'notes', message: 'Balance adjustments need a reason.' });
      break;
  }
  if (tx.categoryId && !categories.some((c) => c.id === tx.categoryId)) {
    issues.push({ field: 'categoryId', message: 'Unknown category.' });
  }
  if (tx.splits && tx.splits.length > 0) {
    if (tx.kind === 'transfer' || tx.kind === 'adjustment') issues.push({ field: 'splits', message: 'Transfers and adjustments cannot be split.' });
    if (tx.splits.length < 2) issues.push({ field: 'splits', message: 'A split needs at least two parts.' });
    let sum = 0;
    for (const s of tx.splits) {
      if (!Number.isSafeInteger(s.amountCents) || s.amountCents === 0) issues.push({ field: 'splits', message: 'Each split needs a non-zero amount.' });
      if (Math.sign(s.amountCents) !== Math.sign(tx.amountCents)) issues.push({ field: 'splits', message: 'Split parts must have the same sign as the total.' });
      if (!categories.some((c) => c.id === s.categoryId)) issues.push({ field: 'splits', message: 'Each split needs a category.' });
      sum += s.amountCents;
    }
    if (sum !== tx.amountCents) issues.push({ field: 'splits', message: 'Split parts must add up exactly to the total.' });
  }
  return issues;
}

/** Both legs of a transfer: two different accounts, same date, same currency, amounts cancel. */
export function validateTransferPair(legs: readonly Transaction[], accounts: readonly Account[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (legs.length !== 2) return [{ field: 'transfer', message: 'A transfer must have exactly two sides.' }];
  const [a, b] = legs as [Transaction, Transaction];
  if (a.transferGroupId !== b.transferGroupId || !a.transferGroupId) issues.push({ field: 'transfer', message: 'Transfer sides are not linked.' });
  if (a.accountId === b.accountId) issues.push({ field: 'transfer', message: 'Choose two different accounts.' });
  if (a.amountCents + b.amountCents !== 0 || a.amountCents === 0) issues.push({ field: 'amount', message: 'Transfer sides must cancel out exactly.' });
  if (a.date !== b.date) issues.push({ field: 'date', message: 'Both sides of a transfer must have the same date.' });
  if (a.kind !== 'transfer' || b.kind !== 'transfer') issues.push({ field: 'kind', message: 'Both sides must be transfers.' });
  const ca = accounts.find((x) => x.id === a.accountId)?.currency;
  const cb = accounts.find((x) => x.id === b.accountId)?.currency;
  if (ca && cb && ca !== cb) issues.push({ field: 'transfer', message: 'Transfers between currencies are not supported yet.' });
  return issues;
}

/** Workspace-level integrity: every transfer group has exactly two legs. */
export function findOrphanTransferLegs(transactions: readonly Transaction[]): string[] {
  const groups = new Map<string, number>();
  for (const t of transactions) if (t.transferGroupId) groups.set(t.transferGroupId, (groups.get(t.transferGroupId) ?? 0) + 1);
  return [...groups].filter(([, n]) => n !== 2).map(([g]) => g);
}

export function assertSameCurrency(accounts: readonly Account[], baseCurrency: string): void {
  const bad = accounts.filter((a) => !a.archived && a.currency !== baseCurrency);
  if (bad.length) throw new Error(`Cannot combine currencies: ${bad.map((a) => a.currency).join(', ')} ≠ ${baseCurrency}`);
}
