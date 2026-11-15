import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createNobleProvider } from '@clarity/security/noble';
import { expandOccurrences, occurrenceLinkProblem } from '@clarity/engine';
import type { ID } from '@clarity/shared';
import {
  addTransaction, applyOps, createRecurring, deleteRecurring, linkCandidateLabel, linkCandidatesForOccurrence, linkedOccurrenceState, linkTransactionToOccurrence, MemoryAdapter,
  setOccurrenceException, StaleDataError, unlinkTransactionFromOccurrence, updateRecurring, WorkspaceStore,
} from '../src';
import { Book, errorOf } from './fixtures/settlement-harness';

/**
 * Phase 4A.11 (audit of 4A.10, D1 and D2). Checking $1,000; Rent $300 on the 15th; no income. Expected values by hand.
 *
 * D1 (overdue, late payment). Rent set up Jul 1; today Sep 20. Overdue bills are those up to 62 days back (Jul 20 on):
 * Aug 15 and Sep 15, plus Oct 15 to come. A $300 rent payment on Sep 18 paid the Aug 15 rent (34 days late).
 * - not linked: Checking 700 − 300 − 300 − 300 = −$200 (understated by $300);
 * - linked to Aug 15: Checking 700 (unchanged), Sep 15 + Oct 15 due → $100;
 * - Skip Aug 15 instead: also $100 (no link); a NEW payment instead: Checking 400, still −$200 (the duplicate).
 */
const ref = (rid: ID, d: string) => ({ recurringId: rid, originalDate: d });
const rent = (b: Book, c: ID, day = 15) => { const r = createRecurring(b.ctx(), { name: 'Rent', kind: 'bill', accountId: c, categoryId: null, schedule: { freq: 'monthly', interval: 1, day: day as never, anchor: '2026-01-01' }, amount: { type: 'fixed', cents: 30000 } }); b.data = applyOps(b.data, r.ops); return r.item.id; };
const pay = (b: Book, c: ID, date: string, merchant = 'RENT OAKWOOD', cents = 30000, status: 'pending' | 'confirmed' = 'confirmed') => { const r = addTransaction(b.ctx(), { kind: 'expense', accountId: c, date, amountCents: cents, merchant, categoryId: null, status }); b.data = applyOps(b.data, r.ops); return r.txs[0]!; };
const status = (b: Book, d: string) => expandOccurrences(b.data.recurring, b.data.exceptions, b.data.transactions, { from: '2026-07-01', to: '2026-10-31', today: b.today }).find((o) => o.originalDate === d)?.status;
const same = (b: Book) => JSON.stringify([b.data.transactions, b.data.recurring, b.data.exceptions, b.data.accounts]);
const lateSetup = () => {
  const b = new Book();
  b.at('2026-07-01');
  const c = b.acct('Checking', 'checking', 100000);
  const rid = rent(b, c);
  b.at('2026-09-20');
  return { b, c, rid };
};

describe('D1: a late payment of an overdue bill (Show older transactions)', () => {
  it('the audit case: not in the default list; listed (with 34 days) only when asked; linking adds nothing → $100', () => {
    const { b, c, rid } = lateSetup();
    const t = pay(b, c, '2026-09-18');
    expect([b.rec(c), b.sts(), status(b, '2026-08-15'), status(b, '2026-09-15')]).toEqual([70000, -20000, 'overdue', 'overdue']);
    expect(linkCandidatesForOccurrence(b.data, ref(rid, '2026-08-15'), b.today).candidates).toEqual([]);
    const older = linkCandidatesForOccurrence(b.data, ref(rid, '2026-08-15'), b.today, { older: true }).candidates;
    expect(older.map((x) => [x.tx.id, x.daysAfterDue])).toEqual([[t.id, 34]]);
    expect(linkCandidateLabel(older[0]!, b.data, { showDays: true })).toBe('Sep 18 · RENT OAKWOOD · −$300.00 · Checking · posted · the description names it · 34 days after the due date');
    // without the explicit choice, the command refuses (and says how)
    expect(errorOf(() => linkTransactionToOccurrence(b.ctx(), t.id, ref(rid, '2026-08-15')))?.message).toBe('It is dated more than 31 days from the due date. Use “Show older transactions” to link a late payment.');
    b.data = applyOps(b.data, linkTransactionToOccurrence(b.ctx(), t.id, ref(rid, '2026-08-15'), { older: true }));
    const after = b.tx(t.id);
    expect([b.data.transactions.length, after.amountCents, after.date, after.status, after.accountId, after.kind, b.rec(c), b.sts(), status(b, '2026-08-15'), status(b, '2026-09-15')]).toEqual([1, -30000, '2026-09-18', 'confirmed', c, 'expense', 70000, 10000, 'confirmed', 'overdue']);
  });

  it('Skip vs a new payment, for comparison: Skip → $100 with no new transaction; a new payment → Checking 400, −$200 (the duplicate the hint warns about)', () => {
    const { b, c, rid } = lateSetup();
    pay(b, c, '2026-09-18');
    const skip = new Book(); skip.data = applyOps(b.data, setOccurrenceException(b.ctx(), ref(rid, '2026-08-15'), 'skip')); skip.today = b.today;
    expect([skip.rec(c), skip.sts(), skip.data.transactions.length]).toEqual([70000, 10000, 1]);
    const dup = new Book(); dup.data = applyOps(b.data, addTransaction(b.ctx(), { kind: 'expense', accountId: c, date: '2026-09-20', amountCents: 30000, merchant: 'Rent', categoryId: null, occurrenceRef: ref(rid, '2026-08-15') }).ops); dup.today = b.today;
    expect([dup.rec(c), dup.sts(), dup.data.transactions.length]).toEqual([40000, -20000, 2]);
  });

  it('older transactions are only listed, never chosen: an unrelated $300 Target purchase appears too, with its days; nothing is linked until the user picks', () => {
    const { b, c, rid } = lateSetup();
    const r = pay(b, c, '2026-09-18');
    const tgt = pay(b, c, '2026-09-17', 'TARGET 0917');
    const older = linkCandidatesForOccurrence(b.data, ref(rid, '2026-08-15'), b.today, { older: true }).candidates;
    expect(older.map((x) => x.tx.id)).toEqual([r.id, tgt.id]);
    expect(b.data.transactions.filter((t) => t.occurrenceRef).length).toBe(0);
    // Checking 400; Aug 15, Sep 15, Oct 15 still due → 400 − 900 = −500
    expect(b.sts()).toBe(-50000);
  });

  it('limits: more than 62 days after, or "older" for a bill that isn\'t overdue, is refused; a pending late payment stays pending', () => {
    const { b, c, rid } = lateSetup();
    const o = expandOccurrences(b.data.recurring, b.data.exceptions, b.data.transactions, { from: '2026-08-01', to: '2026-10-31', today: b.today });
    const aug = o.find((x) => x.originalDate === '2026-08-15')!;
    const oct = o.find((x) => x.originalDate === '2026-10-15')!;
    const tx = (date: string) => ({ id: 'x', accountId: c, date, amountCents: -30000, kind: 'expense' as const, merchant: 'RENT' });
    expect([occurrenceLinkProblem(tx('2026-10-16'), aug, { older: true }), occurrenceLinkProblem(tx('2026-10-17'), aug, { older: true }), occurrenceLinkProblem(tx('2026-11-20'), oct, { older: true })]).toEqual([null, 'It is dated more than 62 days after the due date.', 'It is dated more than 31 days from the due date.']);
    const p = pay(b, c, '2026-09-18', 'RENT OAKWOOD', 30000, 'pending');
    b.data = applyOps(b.data, linkTransactionToOccurrence(b.ctx(), p.id, ref(rid, '2026-08-15'), { older: true }));
    expect([b.tx(p.id).status, b.rec(c), b.sts()]).toEqual(['pending', 70000, 10000]);
  });

  it('one-to-one and stale data still hold: a second payment for the same occurrence, the same payment for a second occurrence, a skip after the list opened, two tabs', async () => {
    const { b, c, rid } = lateSetup();
    const t1 = pay(b, c, '2026-09-18');
    const t2 = pay(b, c, '2026-09-19', 'RENT AGAIN');
    const skipped = new Book(); skipped.data = applyOps(b.data, setOccurrenceException(b.ctx(), ref(rid, '2026-08-15'), 'skip')); skipped.today = b.today;
    expect(errorOf(() => linkTransactionToOccurrence(skipped.ctx(), t1.id, ref(rid, '2026-08-15'), { older: true }))?.message).toMatch(/was skipped/);
    b.data = applyOps(b.data, linkTransactionToOccurrence(b.ctx(), t1.id, ref(rid, '2026-08-15'), { older: true }));
    const before = same(b);
    expect(errorOf(() => linkTransactionToOccurrence(b.ctx(), t2.id, ref(rid, '2026-08-15'), { older: true }))?.message).toMatch(/already recorded by another transaction/);
    expect(errorOf(() => linkTransactionToOccurrence(b.ctx(), t1.id, ref(rid, '2026-09-15')))?.message).toMatch(/already records another scheduled payment/);
    expect(same(b)).toBe(before);
    // two tabs
    const adapter = new MemoryAdapter();
    const provider = createNobleProvider((n) => new Uint8Array(randomBytes(n)));
    const { store: init } = await WorkspaceStore.create(adapter, provider, 'correct horse battery', { withRecoveryKey: false, now: 1 });
    const fresh = lateSetup(); const a1 = pay(fresh.b, fresh.c, '2026-09-18'); const a2 = pay(fresh.b, fresh.c, '2026-09-19', 'RENT AGAIN');
    await init.apply([...fresh.b.data.accounts.map((a) => ({ t: 'put' as const, table: 'accounts' as const, value: a })), ...fresh.b.data.recurring.map((r) => ({ t: 'put' as const, table: 'recurring' as const, value: r })), ...fresh.b.data.transactions.map((t) => ({ t: 'put' as const, table: 'transactions' as const, value: t }))]);
    const tabA = await WorkspaceStore.unlock(adapter, provider, { passphrase: 'correct horse battery' });
    const tabB = await WorkspaceStore.unlock(adapter, provider, { passphrase: 'correct horse battery' });
    const opsB = linkTransactionToOccurrence(tabB.ctx(3, fresh.b.today), a2.id, ref(fresh.rid, '2026-08-15'), { older: true });
    await tabA.apply(linkTransactionToOccurrence(tabA.ctx(2, fresh.b.today), a1.id, ref(fresh.rid, '2026-08-15'), { older: true }));
    await expect(tabB.apply(opsB)).rejects.toBeInstanceOf(StaleDataError);
    const stored = await WorkspaceStore.unlock(adapter, provider, { passphrase: 'correct horse battery' });
    expect(stored.data.transactions.filter((t) => t.occurrenceRef).map((t) => t.id)).toEqual([a1.id]);
  });
});

/**
 * D2 (orphaned links). Rent set up today (Sep 12): Sep 15 and Oct 15. A $300 payment on Sep 11 linked to Sep 15:
 * Checking 700, Oct 15 due → $400.
 */
const linkedSetup = () => {
  const b = new Book();
  const c = b.acct('Checking', 'checking', 100000);
  b.at('2026-09-12');
  const rid = rent(b, c);
  const t = pay(b, c, '2026-09-11', 'RENT');
  b.data = applyOps(b.data, linkTransactionToOccurrence(b.ctx(), t.id, ref(rid, '2026-09-15')));
  expect([b.sts(), linkedOccurrenceState(b.data, t.id, b.today)?.state]).toEqual([40000, 'ok']);
  return { b, c, rid, t };
};
const unchanged = (b: Book, t: { id: ID; amountCents: number; date: string; status: string; accountId: ID; kind: string; provenance: unknown }) => {
  const x = b.tx(t.id);
  return [x.amountCents, x.date, x.status, x.accountId, x.kind, x.provenance].every((v, i) => JSON.stringify(v) === JSON.stringify([t.amountCents, t.date, t.status, t.accountId, t.kind, t.provenance][i]));
};

describe('D2: links whose occurrence or item is gone are recoverable', () => {
  it('the schedule moves to the 20th: the link is shown as stale (not moved); Unlink leaves the payment unchanged and the forecast follows the current schedule; then it can be linked to Sep 20', () => {
    const { b, c, rid, t } = linkedSetup();
    b.data = applyOps(b.data, updateRecurring(b.ctx(), rid, { name: 'Rent', kind: 'bill', accountId: c, categoryId: null, schedule: { freq: 'monthly', interval: 1, day: 20 as never, anchor: '2026-01-01' }, amount: { type: 'fixed', cents: 30000 } }));
    // Checking 700; Sep 20 and Oct 20 due → 100; the link still names Sep 15 (never moved silently)
    expect([linkedOccurrenceState(b.data, t.id, b.today), b.sts(), status(b, '2026-09-20'), b.tx(t.id).occurrenceRef]).toEqual([{ state: 'occurrence_missing', ref: ref(rid, '2026-09-15'), name: 'Rent' }, 10000, 'expected', ref(rid, '2026-09-15')]);
    expect(linkCandidatesForOccurrence(b.data, ref(rid, '2026-09-20'), b.today).candidates).toEqual([]);
    b.data = applyOps(b.data, unlinkTransactionFromOccurrence(b.ctx(), t.id));
    expect([unchanged(b, t), b.tx(t.id).occurrenceRef, b.rec(c), b.sts()]).toEqual([true, undefined, 70000, 10000]);
    b.data = applyOps(b.data, linkTransactionToOccurrence(b.ctx(), t.id, ref(rid, '2026-09-20')));
    expect([b.sts(), status(b, '2026-09-20')]).toEqual([40000, 'confirmed']);
  });

  it('the bill is deleted: shown as missing; a re-created Rent doesn\'t inherit the link (its Sep 15 is due: $100); Unlink, then link to the new bill → $400', () => {
    const { b, c, rid, t } = linkedSetup();
    b.data = applyOps(b.data, deleteRecurring(b.ctx(), rid));
    expect([linkedOccurrenceState(b.data, t.id, b.today)?.state, b.sts()]).toEqual(['item_missing', 70000]);
    const rid2 = rent(b, c);
    // Checking 700; the new Sep 15 and Oct 15 are due → 100; the old link doesn't count for the new bill
    expect([b.sts(), status(b, '2026-09-15'), linkCandidatesForOccurrence(b.data, ref(rid2, '2026-09-15'), b.today).candidates]).toEqual([10000, 'expected', []]);
    expect(errorOf(() => linkTransactionToOccurrence(b.ctx(), t.id, ref(rid2, '2026-09-15')))?.message).toMatch(/Unlink it first/);
    b.data = applyOps(b.data, unlinkTransactionFromOccurrence(b.ctx(), t.id));
    expect([unchanged(b, t), b.rec(c), b.sts()]).toEqual([true, 70000, 10000]);
    expect(linkCandidatesForOccurrence(b.data, ref(rid2, '2026-09-15'), b.today).candidates.map((x) => x.tx.id)).toEqual([t.id]);
    b.data = applyOps(b.data, linkTransactionToOccurrence(b.ctx(), t.id, ref(rid2, '2026-09-15')));
    expect(b.sts()).toBe(40000);
  });

  it('the link no longer fits (the bill moved to another account): shown as invalid; Unlink recovers it', () => {
    const { b, c, rid, t } = linkedSetup();
    const s = b.acct('Savings', 'savings', 50000);
    b.data = applyOps(b.data, updateRecurring(b.ctx(), rid, { name: 'Rent', kind: 'bill', accountId: s, categoryId: null, schedule: { freq: 'monthly', interval: 1, day: 15 as never, anchor: '2026-01-01' }, amount: { type: 'fixed', cents: 30000 } }));
    expect(linkedOccurrenceState(b.data, t.id, b.today)?.state).toBe('invalid');
    b.data = applyOps(b.data, unlinkTransactionFromOccurrence(b.ctx(), t.id));
    expect([unchanged(b, t), b.tx(t.id).occurrenceRef, b.rec(c)]).toEqual([true, undefined, 70000]);
  });
});
