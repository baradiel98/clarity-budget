import { describe, expect, it } from 'vitest';
import { addTransaction, applyOps, createRecurring, deleteTransaction, linkTransactionToOccurrence, paidThisMonth, setOccurrenceException, unlinkTransactionFromOccurrence } from '../src';
import { Book } from './fixtures/settlement-harness';

/**
 * Phase 4B.3: "Paid this month" in Planning. Every row is an occurrence the engine already counts as settled by a linked
 * transaction; nothing is calculated or recorded. Expected values are worked out by hand from the setup below.
 *
 * Accounts (opened Oct 1): Checking $2,000; Savings $0; Visa owes $400.
 * Schedule (created Oct 1, so October occurrences can be overdue):
 *   Rent $300 monthly on the 15th · Cleaner $50 weekly on Mondays (Nov 2, 9, 16, 23, 30) · Paycheck $500 monthly on the 20th
 *   Savings $100 monthly on the 25th (Checking → Savings) · Visa payment $200 monthly on the 27th (Checking → Visa)
 */
function setup() {
  const b = new Book(); b.at('2026-10-01');
  const C = b.acct('Checking', 'checking', 200000);
  const S = b.acct('Savings', 'savings', 0);
  const V = b.acct('Visa', 'credit_card', 40000);
  const rec = (name: string, kind: 'bill' | 'income' | 'transfer' | 'savings', cents: number, schedule: object, extra: object = {}) => {
    const r = createRecurring(b.ctx(), { name, kind, accountId: C, categoryId: null, schedule: schedule as never, amount: { type: 'fixed', cents }, ...extra } as never);
    b.data = applyOps(b.data, r.ops); return r.item.id;
  };
  const ids = {
    rent: rec('Rent', 'bill', 30000, { freq: 'monthly', interval: 1, day: 15, anchor: '2026-01-01' }),
    cleaner: rec('Cleaner', 'bill', 5000, { freq: 'weekly', interval: 1, anchor: '2026-11-02' }),
    pay: rec('Paycheck', 'income', 50000, { freq: 'monthly', interval: 1, day: 20, anchor: '2026-01-01' }),
    save: rec('Savings', 'savings', 10000, { freq: 'monthly', interval: 1, day: 25, anchor: '2026-01-01' }, { toAccountId: S }),
    visa: rec('Visa payment', 'transfer', 20000, { freq: 'monthly', interval: 1, day: 27, anchor: '2026-01-01' }, { toAccountId: V }),
  };
  const pay = (at: string, i: Record<string, unknown>, ref?: [string, string]) => {
    b.at(at);
    const r = addTransaction(b.ctx(), { accountId: C, categoryId: null, date: at, ...(ref ? { occurrenceRef: { recurringId: ref[0], originalDate: ref[1] } } : {}), ...i } as never);
    b.data = applyOps(b.data, r.ops); return r.txs;
  };
  return { b, C, S, V, ids, pay };
}
const rows = (b: Book) => paidThisMonth(b.data, b.today).entries.map((e) => [e.name, e.paidDate, e.dueDate, e.amountCents, e.accountName, e.toAccountName, e.statusLabel]);

describe('Paid this month (Phase 4B.3)', () => {
  it('early, on time, late, pending vs posted, several occurrences of one item, a transfer and a card payment', () => {
    const { b, S, V, ids, pay } = setup();
    pay('2026-10-30', { kind: 'expense', amountCents: 5000, merchant: 'Cleaner' }, [ids.cleaner, '2026-11-02']); // paid in October: not this month
    pay('2026-11-03', { kind: 'expense', amountCents: 30000, merchant: 'Rent' }, [ids.rent, '2026-10-15']); // October rent, 19 days late
    pay('2026-11-09', { kind: 'expense', amountCents: 5000, merchant: 'Cleaner' }, [ids.cleaner, '2026-11-09']); // on its due date
    pay('2026-11-12', { kind: 'expense', amountCents: 30000, merchant: 'Rent' }, [ids.rent, '2026-11-15']); // 3 days early
    pay('2026-11-16', { kind: 'expense', amountCents: 5000, merchant: 'Cleaner', status: 'pending' }, [ids.cleaner, '2026-11-16']); // pending
    pay('2026-11-20', { kind: 'income', amountCents: 50000, merchant: 'Payroll' }, [ids.pay, '2026-11-20']);
    pay('2026-11-25', { kind: 'transfer', toAccountId: S, amountCents: 10000, merchant: 'Savings' }, [ids.save, '2026-11-25']);
    pay('2026-11-26', { kind: 'transfer', toAccountId: V, amountCents: 20000, merchant: 'Visa payment', status: 'confirmed', toStatus: 'pending' }, [ids.visa, '2026-11-27']);
    b.at('2026-11-29');
    const before = JSON.stringify(b.data);
    const sts = b.sts();
    expect(rows(b)).toEqual([
      ['Rent', '2026-11-03', '2026-10-15', -30000, 'Checking', null, 'Posted'],
      ['Cleaner', '2026-11-09', '2026-11-09', -5000, 'Checking', null, 'Posted'],
      ['Rent', '2026-11-12', '2026-11-15', -30000, 'Checking', null, 'Posted'],
      ['Cleaner', '2026-11-16', '2026-11-16', -5000, 'Checking', null, 'Pending'],
      ['Paycheck', '2026-11-20', '2026-11-20', 50000, 'Checking', null, 'Posted'],
      ['Savings', '2026-11-25', '2026-11-25', -10000, 'Checking', 'Savings', 'Posted'],
      ['Visa payment', '2026-11-26', '2026-11-27', -20000, 'Checking', 'Visa', 'Sent · awaiting posting by Visa'],
    ]);
    // the Nov 2 Cleaner (paid Oct 30) and the unpaid Nov 23 / Nov 30 Cleaners are not listed; each occurrence once
    const keys = paidThisMonth(b.data, b.today).entries.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
    // a pending payment is reported as pending; reading the history changes nothing
    expect(paidThisMonth(b.data, b.today).entries.find((e) => e.paidDate === '2026-11-16')!.pending).toBe(true);
    expect(JSON.stringify(b.data)).toBe(before);
    expect(b.sts()).toBe(sts);
    // the transfer is listed once, by its sending side, even though both legs carry the link
    expect(b.data.transactions.filter((t) => t.occurrenceRef?.recurringId === ids.save)).toHaveLength(2);
    expect(paidThisMonth(b.data, b.today).entries.filter((e) => e.recurringId === ids.save)).toHaveLength(1);
    // in December the November payments are no longer "this month"
    expect(paidThisMonth(b.data, '2026-12-02').entries).toEqual([]);
  });

  it('unlink, delete and skip remove an entry; nothing else changes', () => {
    const { b, ids, pay } = setup();
    const [r] = pay('2026-11-12', { kind: 'expense', amountCents: 30000, merchant: 'Rent' }, [ids.rent, '2026-11-15']);
    const [c] = pay('2026-11-09', { kind: 'expense', amountCents: 5000, merchant: 'Cleaner' }, [ids.cleaner, '2026-11-09']);
    b.at('2026-11-20');
    expect(rows(b).map((x) => x[0])).toEqual(['Cleaner', 'Rent']);
    // unlink the rent: it leaves the history (the transaction stays, $300 still out of Checking)
    const bal = b.rec(b.data.accounts.find((a) => a.name === 'Checking')!.id);
    b.data = applyOps(b.data, unlinkTransactionFromOccurrence(b.ctx(), r!.id));
    expect(rows(b).map((x) => x[0])).toEqual(['Cleaner']);
    expect(b.rec(b.data.accounts.find((a) => a.name === 'Checking')!.id)).toBe(bal);
    // relink, then delete the transaction: gone from the history
    b.data = applyOps(b.data, linkTransactionToOccurrence(b.ctx(), r!.id, { recurringId: ids.rent, originalDate: '2026-11-15' }));
    expect(rows(b).map((x) => x[0])).toEqual(['Cleaner', 'Rent']);
    b.data = applyOps(b.data, deleteTransaction(b.ctx(), r!.id));
    expect(rows(b).map((x) => x[0])).toEqual(['Cleaner']);
    // a skipped occurrence is never shown as paid, even if a link to it is left in the data
    b.data = applyOps(b.data, setOccurrenceException(b.ctx(), { recurringId: ids.cleaner, originalDate: '2026-11-09' }, 'skip'));
    expect(b.data.transactions.find((t) => t.id === c!.id)!.occurrenceRef).toBeDefined();
    expect(rows(b)).toEqual([]);
  });

  it('a legacy duplicate link (before Phase 4A.9) lists the occurrence once, with the transaction the engine counts', () => {
    const { b, ids, pay } = setup();
    const [first] = pay('2026-11-12', { kind: 'expense', amountCents: 30000, merchant: 'Rent' }, [ids.rent, '2026-11-15']);
    const [second] = pay('2026-11-13', { kind: 'expense', amountCents: 30000, merchant: 'RENT AGAIN' });
    b.data = { ...b.data, transactions: b.data.transactions.map((t) => (t.id === second!.id ? { ...t, occurrenceRef: { recurringId: ids.rent, originalDate: '2026-11-15' } } : t)) };
    b.at('2026-11-20');
    const e = paidThisMonth(b.data, b.today).entries;
    expect(e).toHaveLength(1);
    expect([first!.id, second!.id]).toContain(e[0]!.tx.id);
  });

  it('an imported payment linked to its bill, then the import undone: listed, then gone', () => {
    const { b, ids } = setup();
    void ids;
    b.at('2026-11-14'); // imported on the day it posted, before the Nov 15 due date
    const C = b.data.accounts.find((a) => a.name === 'Checking')!.id;
    const rv = b.review(C, [['2026-11-14', 'OAKWOOD RENT', -30000, 170000]], undefined, { schedules: true });
    const decisions = b.decisions(rv, {}).map((d) => ({ ...d, linkOccurrence: !!d.candidate.occurrenceMatch }));
    expect(decisions[0]!.candidate.occurrenceMatch).toMatchObject({ name: 'Rent', originalDate: '2026-11-15' });
    const res = b.commit(rv, {}, { decisions });
    expect(rows(b)).toEqual([['Rent', '2026-11-14', '2026-11-15', -30000, 'Checking', null, 'Posted']]);
    b.undo(res.batch.id);
    expect(rows(b)).toEqual([]);
  });

  it('nothing linked this month: an empty list', () => {
    const { b } = setup();
    b.at('2026-11-20');
    expect(paidThisMonth(b.data, b.today)).toEqual({ from: '2026-11-01', to: '2026-11-30', entries: [] });
  });
});
