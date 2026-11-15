import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createNobleProvider } from '@clarity/security/noble';
import { expandOccurrences, periodTotals } from '@clarity/engine';
import type { ID, RecurringAmount, Schedule } from '@clarity/shared';
import {
  addTransaction, applyOps, createRecurring, deleteRecurring, deleteTransaction, deleteTransactions, inverseOps, linkCandidatesForOccurrence, linkCandidateLabel, linkTransactionToOccurrence,
  MemoryAdapter, setOccurrenceException, setRecurringPaused, StaleDataError, unlinkTransactionFromOccurrence, updateTransaction, WorkspaceStore, type TxInput,
} from '../src';
import { Book, errorOf, type Line } from './fixtures/settlement-harness';

/**
 * Phase 4A.10: linking an EXISTING transaction to an unpaid scheduled occurrence (instead of Mark paid adding a second
 * one). Checking $1,000; Rent $300 due Sep 15 and Oct 15; no income; today Sat Sep 12, 2026. By hand:
 * - nothing paid: Safe to Spend 1,000 − 300 − 300 = $400;
 * - a $300 rent payment recorded but not linked: Checking 700, both rents still counted → $100 (understated by $300);
 * - the same payment linked to the Sep 15 rent: Checking 700 (unchanged), Oct 15 only → $400;
 * - the old Mark paid (a second $300 transaction): Checking 400, spending $600 → $100 (the defect).
 */
const setup = () => {
  const b = new Book();
  const c = b.acct('Checking', 'checking', 100000);
  b.at('2026-09-12');
  return { b, c };
};
const monthly = (day: number): Schedule => ({ freq: 'monthly', interval: 1, day: day as never, anchor: '2026-01-01' });
const rec = (b: Book, acct: ID, name: string, amount: RecurringAmount, schedule: Schedule = monthly(15), kind: 'bill' | 'income' | 'transfer' = 'bill', toAccountId?: ID) => {
  const r = createRecurring(b.ctx(), { name, kind, accountId: acct, categoryId: null, schedule, amount, ...(toAccountId ? { toAccountId } : {}) });
  b.data = applyOps(b.data, r.ops);
  return r.item.id;
};
const status = (b: Book, name: string, date: string) => expandOccurrences(b.data.recurring, b.data.exceptions, b.data.transactions, { from: '2026-09-01', to: '2026-10-31', today: b.today }).find((o) => o.name === name && o.originalDate === date)?.status;
const spent = (b: Book) => periodTotals(b.data.transactions, '2026-09-01', '2026-09-30').spendingCents;
const same = (b: Book) => JSON.stringify([b.data.transactions, b.data.importBatches, b.data.recurring, b.data.exceptions, b.data.accounts]);
const importRow = (b: Book, c: ID, line: Line) => { const r = b.commit(b.review(c, [line], undefined, { schedules: true })); return r; };
const expense = (b: Book, acct: ID, merchant: string, cents: number, date = '2026-09-11', extra: Partial<TxInput> = {}) => {
  const r = addTransaction(b.ctx(), { kind: 'expense', accountId: acct, date, amountCents: cents, merchant, categoryId: null, ...extra });
  b.data = applyOps(b.data, r.ops);
  return r.txs[0]!;
};
const link = (b: Book, txId: ID, rid: ID, date = '2026-09-15', opts: { replace?: boolean } = {}) => { b.data = applyOps(b.data, linkTransactionToOccurrence(b.ctx(), txId, { recurringId: rid, originalDate: date }, opts)); };

describe('the original defect and the fix', () => {
  it('$300 rent imported unlinked; linking it to the Sep 15 rent: no second transaction, Checking unchanged at $700, Safe to Spend $100 → $400, spending stays $300', () => {
    const { b, c } = setup();
    const rid = rec(b, c, 'Rent', { type: 'fixed', cents: 30000 });
    expect(b.sts()).toBe(40000);
    importRow(b, c, ['2026-09-11', 'OAKWOOD MGMT 0911', -30000, 70000]);
    const t = b.data.transactions[0]!;
    expect([b.rec(c), b.sts(), spent(b), status(b, 'Rent', '2026-09-15'), t.occurrenceRef]).toEqual([70000, 10000, 30000, 'expected', undefined]);
    const { candidates } = linkCandidatesForOccurrence(b.data, { recurringId: rid, originalDate: '2026-09-15' }, b.today);
    expect(candidates.map((x) => [x.tx.id, x.evidence, x.amountDifferenceCents, x.daysFromDue])).toEqual([[t.id, null, 0, 4]]);
    expect(linkCandidateLabel(candidates[0]!, b.data)).toBe('Sep 11 · Oakwood Mgmt 0911 · −$300.00 · Checking · posted');
    link(b, t.id, rid);
    const after = b.tx(t.id);
    // only the link was added: amount, date, status, provenance (statement identity) unchanged
    expect([after.amountCents, after.date, after.status, after.provenance, after.occurrenceRef]).toEqual([t.amountCents, t.date, t.status, t.provenance, { recurringId: rid, originalDate: '2026-09-15' }]);
    expect([b.data.transactions.length, b.rec(c), b.sts(), spent(b), status(b, 'Rent', '2026-09-15'), status(b, 'Rent', '2026-10-15')]).toEqual([1, 70000, 40000, 30000, 'confirmed', 'expected']);
    // the statement still recognises the row
    expect(b.review(c, [['2026-09-11', 'OAKWOOD MGMT 0911', -30000, 70000]]).preview.candidates[0]!.duplicate?.level).toBe('exact');
  });

  it('a genuine rent payment ("ACH RENT OAKWOOD") is listed first, with its evidence; an unrelated $300 Target purchase is listed too but never chosen for the user', () => {
    const { b, c } = setup();
    const rid = rec(b, c, 'Rent', { type: 'fixed', cents: 30000 });
    const target = expense(b, c, 'TARGET 0910', 30000, '2026-09-10');
    const rent = expense(b, c, 'ACH RENT OAKWOOD', 30000, '2026-09-11');
    const { candidates } = linkCandidatesForOccurrence(b.data, { recurringId: rid, originalDate: '2026-09-15' }, b.today);
    expect(candidates.map((x) => [x.tx.id, x.evidence])).toEqual([[rent.id, 'name'], [target.id, null]]);
    // nothing linked until the user chooses: Checking 400, both rents due → 1,000 − 600 − 600 = −200
    expect([b.sts(), status(b, 'Rent', '2026-09-15')]).toEqual([-20000, 'expected']);
    link(b, rent.id, rid);
    // Checking 400; Oct 15 rent → 100
    expect(b.sts()).toBe(10000);
  });

  it('only payments whose amount fits (or that name the bill) are offered: a $48 gas purchase isn\'t; a $320 "RENT OAKWOOD" is (with the difference shown)', () => {
    const { b, c } = setup();
    const rid = rec(b, c, 'Rent', { type: 'fixed', cents: 30000 });
    expense(b, c, 'SHELL', 4800);
    const named = expense(b, c, 'RENT OAKWOOD', 32000);
    const { candidates } = linkCandidatesForOccurrence(b.data, { recurringId: rid, originalDate: '2026-09-15' }, b.today);
    expect(candidates.map((x) => [x.tx.id, x.evidence, x.amountDifferenceCents])).toEqual([[named.id, 'name', 2000]]);
    expect(linkCandidateLabel(candidates[0]!, b.data)).toBe('Sep 11 · RENT OAKWOOD · −$320.00 · Checking · posted · the description names it · differs from the scheduled amount by +$20.00');
  });

  it('not offered and refused: a payment from another account, a refund, income, a transfer, or one more than 31 days from the due date', () => {
    const { b, c } = setup();
    const s = b.acct('Savings', 'savings', 50000);
    const rid = rec(b, c, 'Rent', { type: 'fixed', cents: 30000 });
    const fromSavings = expense(b, s, 'RENT OAKWOOD', 30000);
    const refund = addTransaction(b.ctx(), { kind: 'refund', accountId: c, date: '2026-09-11', amountCents: 30000, merchant: 'RENT REFUND', categoryId: null });
    b.data = applyOps(b.data, refund.ops);
    const income = addTransaction(b.ctx(), { kind: 'income', accountId: c, date: '2026-09-11', amountCents: 30000, merchant: 'RENT', categoryId: null });
    b.data = applyOps(b.data, income.ops);
    const xfer = b.transfer(c, s, '2026-09-11', 30000, 'confirmed', 'confirmed');
    const old = expense(b, c, 'RENT OAKWOOD', 30000, '2026-08-10');
    expect(linkCandidatesForOccurrence(b.data, { recurringId: rid, originalDate: '2026-09-15' }, b.today).candidates).toEqual([]);
    const before = same(b);
    for (const [id, msg] of [[fromSavings.id, /different account/], [refund.txs[0]!.id, /A refund can't be the payment/], [income.txs[0]!.id, /money coming in/], [xfer.out.id, /Only an expense can pay this bill/], [old.id, /more than 31 days from the due date/]] as const) {
      expect(errorOf(() => linkTransactionToOccurrence(b.ctx(), id, { recurringId: rid, originalDate: '2026-09-15' })), String(msg)).toMatchObject({ field: 'occurrence', message: expect.stringMatching(msg) });
    }
    expect(same(b)).toBe(before);
  });

  it('a pending payment can be linked; it stays pending (Checking still counts it) → $400', () => {
    const { b, c } = setup();
    const rid = rec(b, c, 'Rent', { type: 'fixed', cents: 30000 });
    const t = expense(b, c, 'RENT PORTAL', 30000, '2026-09-11', { status: 'pending' });
    link(b, t.id, rid);
    expect([b.tx(t.id).status, b.rec(c), b.sts()]).toEqual(['pending', 70000, 40000]);
  });

  it('a scheduled transfer: only a transfer to the same account can be it', () => {
    const { b, c } = setup();
    const s = b.acct('Savings', 'savings', 0);
    const other = b.acct('Brokerage', 'savings', 0);
    const rid = rec(b, c, 'Save', { type: 'fixed', cents: 10000 }, monthly(15), 'transfer', s);
    const good = b.transfer(c, s, '2026-09-11', 10000, 'confirmed', 'confirmed');
    const wrong = b.transfer(c, other, '2026-09-11', 10000, 'confirmed', 'confirmed');
    expect(linkCandidatesForOccurrence(b.data, { recurringId: rid, originalDate: '2026-09-15' }, b.today).candidates.map((x) => x.tx.id)).toEqual([good.out.id]);
    expect(errorOf(() => linkTransactionToOccurrence(b.ctx(), wrong.out.id, { recurringId: rid, originalDate: '2026-09-15' }))?.message).toMatch(/transfer to a different account/);
    link(b, good.in.id, rid); // either leg: the link goes on both
    expect(b.data.transactions.filter((t) => t.transferGroupId === good.out.transferGroupId).map((t) => t.occurrenceRef?.originalDate)).toEqual(['2026-09-15', '2026-09-15']);
  });
});

describe('one transaction ↔ one occurrence', () => {
  it('an occurrence already recorded can\'t take a second transaction; a linked transaction can\'t settle a second occurrence (unless moved explicitly)', () => {
    const { b, c } = setup();
    const water = rec(b, c, 'Water', { type: 'fixed', cents: 8000 }, monthly(14));
    const net = rec(b, c, 'Internet', { type: 'fixed', cents: 8000 }, monthly(14));
    const t1 = expense(b, c, 'PAYMENT 0911', 8000);
    const t2 = expense(b, c, 'PAYMENT 0912', 8000, '2026-09-12');
    link(b, t1.id, water, '2026-09-14');
    // the Internet list doesn't offer t1 any more; the Water list is empty (paid)
    expect([linkCandidatesForOccurrence(b.data, { recurringId: net, originalDate: '2026-09-14' }, b.today).candidates.map((x) => x.tx.id), linkCandidatesForOccurrence(b.data, { recurringId: water, originalDate: '2026-09-14' }, b.today).candidates]).toEqual([[t2.id], []]);
    const before = same(b);
    expect(errorOf(() => linkTransactionToOccurrence(b.ctx(), t2.id, { recurringId: water, originalDate: '2026-09-14' }))?.message).toMatch(/Water due Sep 14 is already recorded by another transaction/);
    expect(errorOf(() => linkTransactionToOccurrence(b.ctx(), t1.id, { recurringId: water, originalDate: '2026-09-14' }))?.message).toMatch(/already records Water due Sep 14/);
    expect(errorOf(() => linkTransactionToOccurrence(b.ctx(), t1.id, { recurringId: net, originalDate: '2026-09-14' }))?.message).toMatch(/already records another scheduled payment\. Unlink it first/);
    expect(same(b)).toBe(before);
    // moved explicitly: Water due again, Internet paid; Checking 840; Water Sep 14 + Oct 14 + Internet Oct 14 = 240 → 600
    link(b, t1.id, net, '2026-09-14', { replace: true });
    expect([status(b, 'Water', '2026-09-14'), status(b, 'Internet', '2026-09-14'), b.sts()]).toEqual(['expected', 'confirmed', 60000]);
    // a new transaction (Mark paid → "record a new payment") for the paid Internet occurrence is refused too
    expect(errorOf(() => addTransaction(b.ctx(), { kind: 'expense', accountId: c, date: '2026-09-14', amountCents: 8000, merchant: 'Internet', categoryId: null, occurrenceRef: { recurringId: net, originalDate: '2026-09-14' } }))?.message).toMatch(/already recorded by/);
  });

  it('two occurrences of the same bill (Sep 15, Oct 15): a Sep 11 payment can be the Sep 15 one, not the Oct 15 one (34 days away)', () => {
    const { b, c } = setup();
    const rid = rec(b, c, 'Rent', { type: 'fixed', cents: 30000 });
    const t = expense(b, c, 'RENT', 30000);
    expect(linkCandidatesForOccurrence(b.data, { recurringId: rid, originalDate: '2026-10-15' }, b.today).candidates).toEqual([]);
    link(b, t.id, rid);
    expect([status(b, 'Rent', '2026-09-15'), status(b, 'Rent', '2026-10-15')]).toEqual(['confirmed', 'expected']);
  });

  it('the item deleted, paused or the occurrence skipped after the list opened: refused, nothing changes', () => {
    for (const change of ['delete', 'pause', 'skip'] as const) {
      const { b, c } = setup();
      const rid = rec(b, c, 'Rent', { type: 'fixed', cents: 30000 });
      const t = expense(b, c, 'RENT', 30000);
      expect(linkCandidatesForOccurrence(b.data, { recurringId: rid, originalDate: '2026-09-15' }, b.today).candidates.length).toBe(1);
      if (change === 'delete') b.data = applyOps(b.data, deleteRecurring(b.ctx(), rid));
      if (change === 'pause') b.data = applyOps(b.data, setRecurringPaused(b.ctx(), rid, true));
      if (change === 'skip') b.data = applyOps(b.data, setOccurrenceException(b.ctx(), { recurringId: rid, originalDate: '2026-09-15' }, 'skip'));
      const before = same(b);
      expect(errorOf(() => linkTransactionToOccurrence(b.ctx(), t.id, { recurringId: rid, originalDate: '2026-09-15' }))?.message, change).toMatch(change === 'delete' ? /no longer exists/ : change === 'pause' ? /no longer scheduled/ : /was skipped/);
      expect(same(b), change).toBe(before);
    }
  });

  it('two tabs link different payments to the same rent: the second is refused by storage; the rent is recorded once', async () => {
    const { b, c } = setup();
    const rid = rec(b, c, 'Rent', { type: 'fixed', cents: 30000 });
    const t1 = expense(b, c, 'RENT A', 30000);
    const t2 = expense(b, c, 'RENT B', 30000, '2026-09-12');
    const adapter = new MemoryAdapter();
    const provider = createNobleProvider((n) => new Uint8Array(randomBytes(n)));
    const { store: init } = await WorkspaceStore.create(adapter, provider, 'correct horse battery', { withRecoveryKey: false, now: 1 });
    await init.apply([...b.data.accounts.map((a) => ({ t: 'put' as const, table: 'accounts' as const, value: a })), ...b.data.recurring.map((r) => ({ t: 'put' as const, table: 'recurring' as const, value: r })), ...b.data.transactions.map((t) => ({ t: 'put' as const, table: 'transactions' as const, value: t }))]);
    const tabA = await WorkspaceStore.unlock(adapter, provider, { passphrase: 'correct horse battery' });
    const tabB = await WorkspaceStore.unlock(adapter, provider, { passphrase: 'correct horse battery' });
    const opsB = linkTransactionToOccurrence(tabB.ctx(3, b.today), t2.id, { recurringId: rid, originalDate: '2026-09-15' });
    await tabA.apply(linkTransactionToOccurrence(tabA.ctx(2, b.today), t1.id, { recurringId: rid, originalDate: '2026-09-15' }));
    await expect(tabB.apply(opsB)).rejects.toBeInstanceOf(StaleDataError);
    expect(() => linkTransactionToOccurrence(tabB.ctx(4, b.today), t2.id, { recurringId: rid, originalDate: '2026-09-15' })).toThrow(/already recorded by another transaction/);
    const stored = await WorkspaceStore.unlock(adapter, provider, { passphrase: 'correct horse battery' });
    expect(stored.data.transactions.filter((t) => t.occurrenceRef).map((t) => t.id)).toEqual([t1.id]);
  });
});

describe('editing, unlinking, deleting and undo', () => {
  const linked = () => {
    const { b, c } = setup();
    const rid = rec(b, c, 'Rent', { type: 'fixed', cents: 30000 });
    const t = expense(b, c, 'RENT OAKWOOD', 30000);
    link(b, t.id, rid);
    return { b, c, rid, t };
  };
  const input = (c: ID, over: Partial<TxInput> = {}): TxInput => ({ kind: 'expense', accountId: c, date: '2026-09-11', amountCents: 30000, merchant: 'RENT OAKWOOD', categoryId: null, ...over });
  it('unlink: the rent is due again → $100; nothing else changes', () => {
    const { b, c, t } = linked();
    b.data = applyOps(b.data, unlinkTransactionFromOccurrence(b.ctx(), t.id));
    expect([b.tx(t.id).occurrenceRef, b.rec(c), b.sts(), status(b, 'Rent', '2026-09-15')]).toEqual([undefined, 70000, 10000, 'expected']);
    expect(errorOf(() => unlinkTransactionFromOccurrence(b.ctx(), t.id))?.message).toMatch(/isn't linked/);
  });
  it('edit the description: the link stays; edit the amount to $320: still the rent (what was paid) → Checking 680, $380', () => {
    const { b, c, rid, t } = linked();
    b.data = applyOps(b.data, updateTransaction(b.ctx(), t.id, input(c, { merchant: 'Oakwood rent' })).ops);
    expect(b.tx(t.id).occurrenceRef).toEqual({ recurringId: rid, originalDate: '2026-09-15' });
    b.data = applyOps(b.data, updateTransaction(b.ctx(), t.id, input(c, { amountCents: 32000 })).ops);
    expect([b.tx(t.id).occurrenceRef?.originalDate, b.rec(c), b.sts()]).toEqual(['2026-09-15', 68000, 38000]);
  });
  it('edit the account, or make it a refund: refused while linked (unlink first); nothing changes', () => {
    const { b, c, t } = linked();
    const s = b.acct('Savings', 'savings', 50000);
    const before = same(b);
    expect(errorOf(() => updateTransaction(b.ctx(), t.id, input(s)))).toMatchObject({ field: 'occurrence', message: expect.stringMatching(/recorded as paying a scheduled item.*scheduled from Checking, not this account\. Unlink it first/) });
    expect(errorOf(() => updateTransaction(b.ctx(), t.id, input(c, { kind: 'refund' })))?.message).toMatch(/a refund can't record it\. Unlink it first/);
    expect(same(b)).toBe(before);
  });
  it('delete the linked payment (single or bulk): the rent is due again, never left paid by a missing transaction; undoing the delete restores both', () => {
    for (const how of ['single', 'bulk'] as const) {
      const { b, c, t } = linked();
      const before = b.data;
      const ops = how === 'single' ? deleteTransaction(b.ctx(), t.id) : deleteTransactions(b.ctx(), [t.id]);
      b.data = applyOps(b.data, ops);
      // Checking 1,000; both rents due → 400
      expect([b.rec(c), b.sts(), status(b, 'Rent', '2026-09-15')], how).toEqual([100000, 40000, 'expected']);
      b.data = applyOps(b.data, inverseOps(before, ops));
      expect([b.tx(t.id).occurrenceRef?.originalDate, b.sts(), status(b, 'Rent', '2026-09-15')], how).toEqual(['2026-09-15', 40000, 'confirmed']);
    }
  });
  it('import undo of a payment linked later: the payment and its link go → $400 (1,000 − 600); re-importing offers the row unlinked again', () => {
    const { b, c } = setup();
    const rid = rec(b, c, 'Rent', { type: 'fixed', cents: 30000 });
    const r = importRow(b, c, ['2026-09-11', 'OAKWOOD MGMT 0911', -30000, 70000]);
    link(b, b.data.transactions[0]!.id, rid);
    expect(b.sts()).toBe(40000);
    b.undo(r.batch.id);
    expect([b.data.transactions.length, b.rec(c), b.sts(), status(b, 'Rent', '2026-09-15')]).toEqual([0, 100000, 40000, 'expected']);
    importRow(b, c, ['2026-09-11', 'OAKWOOD MGMT 0911', -30000, 70000]);
    expect([b.data.transactions[0]!.occurrenceRef, b.sts()]).toEqual([undefined, 10000]);
  });
});
