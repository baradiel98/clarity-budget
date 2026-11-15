import { expandOccurrences, occurrenceKey, type Occurrence } from '@clarity/engine';
import { addDays, endOfMonth, startOfMonth, type ID, type ISODate, type RecurringKind, type Transaction, type WorkspaceData } from '@clarity/shared';
import { transferSettlement } from './commands';

/**
 * Phase 4B.3: one scheduled occurrence that a linked transaction settled ("Paid this month" in Planning, both apps).
 * Nothing here is a new record or a new calculation: the occurrence comes from the engine's own expansion (status
 * "confirmed" and the transaction it chose, `matchedTxId`), and every amount, date and status is the transaction's.
 */
export interface PaidEntry {
  /** The occurrence key (item + original date): each occurrence appears once. */
  key: string;
  recurringId: ID;
  name: string;
  kind: RecurringKind;
  /** The date the occurrence was due on the schedule (weekend rule and any move applied, as Planning shows it). */
  dueDate: ISODate;
  /** The transaction that settled it: for a transfer, its sending side (the side the link stands for). */
  tx: Transaction;
  /** The transaction's own date: when it was paid or received. */
  paidDate: ISODate;
  /** The transaction's signed amount and its account's currency. */
  amountCents: number;
  currency: string;
  accountName: string;
  /** A transfer's other account (a card payment's card, a savings account). */
  toAccountName: string | null;
  /** The transaction's own status; a pending payment hasn't cleared. */
  pending: boolean;
  /** Exact words for the status: "Posted", "Pending", or the existing transfer wording (Transactions list). */
  statusLabel: string;
}

/**
 * Phase 4B.3: occurrences settled by a linked transaction dated in the month of `today` (by the transaction's date,
 * not the due date), oldest first. Rules:
 * - one entry per occurrence, using the transaction the engine counts as paying it (`matchedTxId`); a second, legacy
 *   link to the same occurrence (data from before Phase 4A.9) is not listed again;
 * - a skipped occurrence is never listed as paid; a deleted transaction is no longer linked, so it isn't listed;
 * - an occurrence the schedule no longer has (item deleted, paused or changed) isn't listed: its transaction's Edit
 *   form explains the link (Phase 4A.11);
 * - pending stays pending: the status is the transaction's own (for a transfer, its existing settlement wording).
 */
export function paidThisMonth(data: WorkspaceData, today: ISODate): { from: ISODate; to: ISODate; entries: PaidEntry[] } {
  const from = startOfMonth(today);
  const to = endOfMonth(today);
  const linked = data.transactions.filter((t) => t.occurrenceRef && t.date >= from && t.date <= to);
  if (linked.length === 0) return { from, to, entries: [] };
  const ids = new Set(linked.map((t) => t.id));
  // the occurrences these links name (a few days either side, so a weekend shift or a move is still found)
  const dates = linked.map((t) => t.occurrenceRef!.originalDate).sort();
  const occurrences = expandOccurrences(data.recurring, data.exceptions, data.transactions, { from: addDays(dates[0]!, -7), to: addDays(dates[dates.length - 1]!, 7), today });
  const skipped = new Set(data.exceptions.filter((e) => e.action === 'skip').map((e) => occurrenceKey(e.recurringId, e.originalDate)));
  const account = (id: ID) => data.accounts.find((a) => a.id === id);
  const seen = new Set<string>();
  const entries: PaidEntry[] = [];
  for (const o of occurrences as Occurrence[]) {
    if (o.status !== 'confirmed' || !o.matchedTxId || !ids.has(o.matchedTxId) || skipped.has(o.key) || seen.has(o.key)) continue;
    seen.add(o.key);
    const tx = data.transactions.find((t) => t.id === o.matchedTxId)!;
    const other = tx.transferGroupId ? data.transactions.find((t) => t.transferGroupId === tx.transferGroupId && t.id !== tx.id) : undefined;
    const acct = account(tx.accountId);
    entries.push({
      key: o.key,
      recurringId: o.recurringId,
      name: o.name,
      kind: o.kind,
      dueDate: o.date,
      tx,
      paidDate: tx.date,
      amountCents: tx.amountCents,
      currency: acct?.currency ?? data.settings.baseCurrency,
      accountName: acct?.name ?? 'Deleted account',
      toAccountName: other ? account(other.accountId)?.name ?? null : null,
      pending: tx.status === 'pending',
      statusLabel: transferSettlement(tx, data.transactions, data.accounts) ?? (tx.status === 'pending' ? 'Pending' : 'Posted'),
    });
  }
  entries.sort((a, b) => (a.paidDate < b.paidDate ? -1 : a.paidDate > b.paidDate ? 1 : a.name.localeCompare(b.name)));
  return { from, to, entries };
}
