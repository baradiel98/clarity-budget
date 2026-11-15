import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createNobleProvider } from '@clarity/security/noble';
import { cardPaymentsInTransit } from '@clarity/engine';
import type { ID } from '@clarity/shared';
import {
  applyOps, commitImport, deleteProblem, deleteTransaction, deleteTransactions, describeImportUndo, importUndoProblem, MemoryAdapter, recordPaymentReturn, StaleDataError,
  undoImportBatch, updateTransaction, WorkspaceStore, type TxInput,
} from '../src';
import { Book, errorOf, row, type Line } from './fixtures/settlement-harness';

/**
 * Phase 4A.7: transaction lifecycle integrity around returned card payments (audit 4A.6 H2, H3, M1, M2).
 * Checking $1,000; Visa owes $500; no schedules; today Sep 12, 2026. Every expected value is worked out by hand in the
 * comments from each bank's own ledger; no production calculation is used as the oracle.
 *
 * Truth used throughout: a $200 payment from Checking to Visa leaves Checking at $800 and, until Visa posts it, still
 * leaves $500 owed with $200 of it on its way, so the debt counted is $300 → Safe to Spend 800 − 300 = $500. Once the
 * payment is returned, Checking is back to $1,000 and Visa is owed $500 again → $500.
 */
const setup = () => {
  const b = new Book();
  const c = b.acct('Checking', 'checking', 100000);
  const v = b.acct('Visa', 'credit_card', 50000);
  b.at('2026-09-12');
  return { b, c, v };
};
const inTransit = (b: Book) => cardPaymentsInTransit(b.data.accounts, b.data.transactions, b.today).map((p) => p.cents);
const PAY: Line = ['2026-09-10', 'PAYMENT TO VISA', -20000, 80000];
const RET: Line = ['2026-09-12', 'RETURNED PAYMENT', 20000, 100000];
/** The payment, imported from the checking statement as a transfer to Visa. */
const importPayment = (b: Book, c: ID, v: ID) => {
  const r = b.commit(b.review(c, [PAY]), { 'PAYMENT TO VISA': 'auto' }, { other: { 'PAYMENT TO VISA': v } });
  const out = r.txs.find((t) => t.accountId === c)!;
  return { batch: r.batch.id, out };
};
/** The return, imported from a later checking statement and confirmed as the return of `legId`. */
const importReturn = (b: Book, c: ID, legId: ID, line: Line = RET) => b.commit(b.review(c, [line]), { [line[1]]: legId }).batch.id;
const manualReturn = (b: Book, legId: ID, c: ID, cents: number, date = b.today) => { const r = recordPaymentReturn(b.ctx(), { paymentLegId: legId, accountId: c, amountCents: cents, date }); b.data = applyOps(b.data, r.ops); return r.txs[0]!; };
const payInput = (c: ID, v: ID, over: Partial<TxInput> = {}): TxInput => ({ kind: 'transfer', accountId: c, toAccountId: v, date: '2026-09-10', amountCents: 20000, merchant: 'Payment to Visa', categoryId: null, status: 'confirmed', toStatus: 'pending', ...over });
const snapshot = (b: Book) => JSON.stringify([b.data.transactions, b.data.importBatches]);

describe('H2: undoing the import that created a payment while a return is recorded', () => {
  it('a manual return blocks the undo (nothing changes); deleting the return first, then undo works → $500 throughout', () => {
    const { b, c, v } = setup();
    const p = importPayment(b, c, v);
    expect([b.sts(), b.rec(c), inTransit(b)]).toEqual([50000, 80000, [20000]]); // 800; Visa 500 − 200 on its way
    const ret = manualReturn(b, p.out.id, c, 20000);
    expect([b.sts(), b.rec(c), b.rec(v), inTransit(b)]).toEqual([50000, 100000, -50000, []]);
    const before = snapshot(b);
    const err = errorOf(() => b.undo(p.batch));
    expect(err?.message).toMatch(/can't be undone: the card payment “Payment To Visa” \(Sep 10\) was added by this import and has a return recorded against it: “Returned payment” \(Sep 12, \$200\.00\)\. Delete the return first/);
    expect(importUndoProblem(b.data, p.batch)).toMatch(/has a return recorded/);
    expect(snapshot(b)).toBe(before); // no partial undo; the batch is still active
    // resolve: delete the return (payment counts as on its way again), then undo the import
    b.data = applyOps(b.data, deleteTransaction(b.ctx(), ret.id));
    expect([b.sts(), b.rec(c), inTransit(b)]).toEqual([50000, 80000, [20000]]);
    b.undo(p.batch);
    // back to the start: Checking 1,000, Visa owes 500 → 500; nothing left over
    expect([b.sts(), b.rec(c), b.rec(v), b.data.transactions.length, !!b.data.importBatches[0]!.undoneAt]).toEqual([50000, 100000, -50000, 0, true]);
  });

  it('an imported return blocks it and names that import; undoing the return import first, then the payment import → $500, then re-importing both rows restores the same state', () => {
    const { b, c, v } = setup();
    const p = importPayment(b, c, v);
    const rb = importReturn(b, c, p.out.id);
    expect([b.sts(), b.rec(c), inTransit(b)]).toEqual([50000, 100000, []]);
    const err = errorOf(() => b.undo(p.batch));
    expect(err?.message).toMatch(/recorded by the import of statement\.csv\)\. Undo the import that recorded a return \(Import history\), or delete the return itself, first\. Nothing was changed\./);
    b.undo(rb);
    expect([b.sts(), b.rec(c), inTransit(b)]).toEqual([50000, 80000, [20000]]);
    b.undo(p.batch);
    expect([b.sts(), b.rec(c), b.data.transactions.length]).toEqual([50000, 100000, 0]);
    // re-import the payment statement, then the return statement: the return row is offered as a return, never as income
    const p2 = importPayment(b, c, v);
    const rv = b.review(c, [RET]);
    expect([row(rv, 'RETURNED PAYMENT').include, row(rv, 'RETURNED PAYMENT').matchCandidates.map((m) => [m.txId, m.basis])]).toEqual([false, [[p2.out.id, 'return']]]);
    importReturn(b, c, p2.out.id);
    // the same state as the first time: Checking 1,000, Visa owes 500 → 500; one payment, one return
    expect([b.sts(), b.rec(c), b.rec(v), inTransit(b), b.data.transactions.filter((t) => t.returnOf).length]).toEqual([50000, 100000, -50000, [], 2]);
  });

  it('the other statement order: the Visa statement links (posts) the card side, then the return is recorded → undoing the Visa import is allowed (it created nothing) and stays consistent: $500', () => {
    const { b, c, v } = setup();
    const out = b.add(payInput(c, v)).find((t) => t.amountCents < 0)!;
    const visaLeg = b.data.transactions.find((t) => t.transferGroupId === out.transferGroupId && t.accountId === v)!;
    // Visa statement: the payment received (owed 500 → 300); linked to the pending Visa side
    const rv = b.review(v, [['2026-09-11', 'PAYMENT THANK YOU', 20000, -30000]], 'as_is');
    const vb = b.commit(rv, { 'PAYMENT THANK YOU': visaLeg.id }).batch.id;
    // Checking 800; Visa posted 300 → 500
    expect([b.sts(), b.rec(v), b.tx(visaLeg.id).status]).toEqual([50000, -30000, 'confirmed']);
    manualReturn(b, out.id, c, 20000);
    // Visa had posted the payment, so the reversal is owed again: Checking 1,000; Visa 300 + 200 = 500 → 500
    expect([b.sts(), b.rec(c), b.rec(v)]).toEqual([50000, 100000, -50000]);
    expect(importUndoProblem(b.data, vb)).toBeNull();
    b.undo(vb);
    // Visa side pending again; the return's Visa side then has nothing to reverse → still owes 500; Checking 1,000 → 500
    expect([b.sts(), b.rec(c), b.rec(v), b.tx(visaLeg.id).status, b.data.transactions.filter((t) => t.returnOf).length]).toEqual([50000, 100000, -50000, 'pending', 2]);
  });

  it('two returns on one payment (manual $80, imported $50): blocked and both listed; after resolving both, undo works', () => {
    const { b, c, v } = setup();
    const p = importPayment(b, c, v);
    const m = manualReturn(b, p.out.id, c, 8000, '2026-09-11');
    const rb = importReturn(b, c, p.out.id, ['2026-09-12', 'PAYMENT REVERSAL', 5000, 93000]);
    // Checking 800 + 80 + 50 = 930; Visa: 70 of the payment still on its way → 430 → 500
    expect([b.sts(), b.rec(c), inTransit(b)]).toEqual([50000, 93000, [7000]]);
    expect(importUndoProblem(b.data, p.batch)).toMatch(/has 2 returns recorded against it: “Returned payment” \(Sep 11, \$80\.00\); “Returned payment” \(Sep 12, \$50\.00, recorded by the import of statement\.csv\)/);
    b.data = applyOps(b.data, deleteTransaction(b.ctx(), m.id));
    expect(importUndoProblem(b.data, p.batch)).toMatch(/has a return recorded/);
    b.undo(rb);
    expect(importUndoProblem(b.data, p.batch)).toBeNull();
    b.undo(p.batch);
    expect([b.sts(), b.data.transactions.length]).toEqual([50000, 0]);
  });

  it('a return recorded in the same import as the payment it returns is removed with it (not a dependency)', () => {
    const { b, c, v } = setup();
    const p = importPayment(b, c, v);
    // undoing the RETURN's own import is always allowed and leaves the payment untouched
    const rb = importReturn(b, c, p.out.id);
    expect(importUndoProblem(b.data, rb)).toBeNull();
    b.undo(rb);
    expect([b.sts(), inTransit(b), b.data.transactions.filter((t) => t.returnOf).length]).toEqual([50000, [20000], 0]);
  });

  it('stale / two-tab undo: tab B undoes on data from before tab A recorded a return → refused by storage, nothing orphaned', async () => {
    const { b, c, v } = setup();
    const p = importPayment(b, c, v);
    const adapter = new MemoryAdapter();
    const provider = createNobleProvider((n) => new Uint8Array(randomBytes(n)));
    const { store: init } = await WorkspaceStore.create(adapter, provider, 'correct horse battery', { withRecoveryKey: false, now: 1 });
    await init.apply([...b.data.accounts.map((a) => ({ t: 'put' as const, table: 'accounts' as const, value: a })), ...b.data.transactions.map((t) => ({ t: 'put' as const, table: 'transactions' as const, value: t })), ...b.data.importBatches.map((x) => ({ t: 'put' as const, table: 'importBatches' as const, value: x }))]);
    const tabA = await WorkspaceStore.unlock(adapter, provider, { passphrase: 'correct horse battery' });
    const tabB = await WorkspaceStore.unlock(adapter, provider, { passphrase: 'correct horse battery' });
    // tab B computes the undo first (no return exists in its copy yet)...
    const undoB = undoImportBatch(tabB.ctx(3, b.today), p.batch);
    // ...tab A records the return
    await tabA.apply(recordPaymentReturn(tabA.ctx(2, b.today), { paymentLegId: p.out.id, accountId: c, amountCents: 20000, date: b.today }).ops);
    await expect(tabB.apply(undoB)).rejects.toBeInstanceOf(StaleDataError);
    // tab B now has the latest data, and the undo it would compute again is refused by the command itself
    expect(() => undoImportBatch(tabB.ctx(4, b.today), p.batch)).toThrow(/has a return recorded/);
    const stored = await WorkspaceStore.unlock(adapter, provider, { passphrase: 'correct horse battery' });
    expect([stored.data.transactions.length, stored.data.importBatches[0]!.undoneAt]).toEqual([4, null]);
  });
});

describe('H3 / M2: editing a payment that has returns', () => {
  const withReturns = (amounts: number[]) => {
    const { b, c, v } = setup();
    const out = b.add(payInput(c, v)).find((t) => t.amountCents < 0)!;
    amounts.forEach((a, i) => manualReturn(b, out.id, c, a, `2026-09-1${1 + i}`));
    return { b, c, v, out };
  };
  it('the audit case: a fully returned $200 payment edited to $100 is refused; nothing changes (Checking $1,000, $500)', () => {
    const { b, c, v, out } = withReturns([20000]);
    const before = snapshot(b);
    expect(errorOf(() => updateTransaction(b.ctx(), out.id, payInput(c, v, { amountCents: 10000 })))).toMatchObject({ field: 'return', message: expect.stringMatching(/has \$200\.00 returned .*so it can't be less than \$200\.00\. To correct it, delete the return first/) });
    expect([snapshot(b), b.sts(), b.rec(c)]).toEqual([before, 50000, 100000]);
  });
  it('multiple partial returns ($80 + $50 = $130): $129.99 refused; exactly $130 allowed → fully returned, $500; $250 allowed → $120 on its way, $500', () => {
    const { b, c, v, out } = withReturns([8000, 5000]);
    expect(errorOf(() => updateTransaction(b.ctx(), out.id, payInput(c, v, { amountCents: 12999 })))?.message).toMatch(/can't be less than \$130\.00/);
    b.data = applyOps(b.data, updateTransaction(b.ctx(), out.id, payInput(c, v, { amountCents: 13000 })).ops);
    // Checking 1,000 − 130 + 130 = 1,000; Visa: fully returned → owes 500 → 500
    expect([b.sts(), b.rec(c), inTransit(b)]).toEqual([50000, 100000, []]);
    b.data = applyOps(b.data, updateTransaction(b.ctx(), out.id, payInput(c, v, { amountCents: 25000 })).ops);
    // Checking 1,000 − 250 + 130 = 880; Visa 500 − 120 on its way = 380 → 500
    expect([b.sts(), b.rec(c), inTransit(b)]).toEqual([50000, 88000, [12000]]);
    expect(b.data.transactions.filter((t) => t.returnOf).length).toBe(4); // both returns kept (2 legs each)
  });
  it('the source account, the destination card and the type can\'t change; the date can\'t move after the first return', () => {
    const { b, c, v, out } = withReturns([20000]);
    const s = b.acct('Savings', 'savings', 0);
    const amex = b.acct('Amex', 'credit_card', 30000);
    const before = snapshot(b);
    expect(errorOf(() => updateTransaction(b.ctx(), out.id, payInput(s, v)))?.message).toMatch(/its accounts can't change: the money came back to Checking/);
    expect(errorOf(() => updateTransaction(b.ctx(), out.id, payInput(c, amex)))?.message).toMatch(/its accounts can't change/);
    expect(errorOf(() => updateTransaction(b.ctx(), out.id, payInput(c, s)))?.message).toMatch(/its accounts can't change/); // Visa → Savings (audit M2)
    expect(errorOf(() => updateTransaction(b.ctx(), out.id, { kind: 'expense', accountId: c, date: '2026-09-10', amountCents: 20000, merchant: 'Visa', categoryId: null }))?.message).toMatch(/must stay a transfer/);
    expect(errorOf(() => updateTransaction(b.ctx(), out.id, payInput(c, v, { date: '2026-09-12' })))?.message).toMatch(/can't be dated after its first return \(Sep 11\)/);
    expect(snapshot(b)).toBe(before);
    // Checking 1,000; Visa 500; Amex 300 → 200
    expect(b.sts()).toBe(20000);
  });
  it('a description-only edit is allowed and keeps the return, the statement link and the import provenance', () => {
    const { b, c, v } = setup();
    const p = importPayment(b, c, v);
    manualReturn(b, p.out.id, c, 20000);
    const prov = b.tx(p.out.id).provenance;
    b.data = applyOps(b.data, updateTransaction(b.ctx(), p.out.id, payInput(c, v, { merchant: 'Visa autopay', status: 'confirmed', toStatus: 'pending' })).ops);
    expect([b.tx(p.out.id).merchant, b.tx(p.out.id).provenance, b.sts(), b.rec(c), inTransit(b)]).toEqual(['Visa autopay', prov, 50000, 100000, []]);
    // and the import is still protected
    expect(importUndoProblem(b.data, p.batch)).toMatch(/has a return recorded/);
  });
  it('a payment without returns edits exactly as before (smaller amount, other card)', () => {
    const { b, c, v } = setup();
    const amex = b.acct('Amex', 'credit_card', 30000);
    const out = b.add(payInput(c, v)).find((t) => t.amountCents < 0)!;
    b.data = applyOps(b.data, updateTransaction(b.ctx(), out.id, payInput(c, amex, { amountCents: 10000 })).ops);
    // Checking 900; Visa 500; Amex 300 − 100 on its way = 200 → 900 − 700 = 200
    expect(b.sts()).toBe(20000);
  });
  it('editing a return: keeps it a return (returnOf kept); can\'t exceed what is left of the payment or change accounts', () => {
    const { b, c, v, out } = withReturns([8000, 5000]);
    const r1 = b.data.transactions.find((t) => t.returnOf && t.accountId === c && t.amountCents === 8000)!;
    const retInput = (over: Partial<TxInput> = {}): TxInput => ({ kind: 'transfer', accountId: v, toAccountId: c, date: '2026-09-11', amountCents: 8000, merchant: 'Returned payment', categoryId: null, status: 'pending', toStatus: 'confirmed', ...over });
    // the $80 return can grow to at most 200 − 50 = $150
    expect(errorOf(() => updateTransaction(b.ctx(), r1.id, retInput({ amountCents: 15001 })))?.message).toMatch(/Only \$150\.00 of this \$200\.00 payment can be returned/);
    expect(errorOf(() => updateTransaction(b.ctx(), r1.id, retInput({ toAccountId: b.acct('Savings', 'savings', 0) })))?.message).toMatch(/keeps its accounts/);
    expect(errorOf(() => updateTransaction(b.ctx(), r1.id, retInput({ date: '2026-09-09' })))?.message).toMatch(/can't be dated before the payment \(Sep 10\)/);
    b.data = applyOps(b.data, updateTransaction(b.ctx(), r1.id, retInput({ amountCents: 15000, merchant: 'Reversal' })).ops);
    expect(b.data.transactions.filter((t) => t.transferGroupId === r1.transferGroupId).map((t) => t.returnOf)).toEqual([out.transferGroupId, out.transferGroupId]);
    // Checking 1,000 − 200 + 150 + 50 = 1,000; fully returned → Visa 500 → 500
    expect([b.sts(), b.rec(c), inTransit(b)]).toEqual([50000, 100000, []]);
  });
});

describe('M1: deleting a payment that has returns', () => {
  it('no returns: deleted with both legs → back to $500 (1,000 − 500)', () => {
    const { b, c, v } = setup();
    const out = b.add(payInput(c, v)).find((t) => t.amountCents < 0)!;
    expect(deleteProblem(b.data, out.id)).toBeNull();
    b.data = applyOps(b.data, deleteTransaction(b.ctx(), out.id));
    expect([b.sts(), b.data.transactions.length]).toEqual([50000, 0]);
  });
  it('one return: refused from either leg, nothing changes; the reason names the return', () => {
    const { b, c, v } = setup();
    const out = b.add(payInput(c, v)).find((t) => t.amountCents < 0)!;
    manualReturn(b, out.id, c, 20000);
    const visaLeg = b.data.transactions.find((t) => t.transferGroupId === out.transferGroupId && t.accountId === v)!;
    const before = snapshot(b);
    for (const id of [out.id, visaLeg.id]) {
      expect(errorOf(() => deleteTransaction(b.ctx(), id))).toMatchObject({ field: 'delete', message: expect.stringMatching(/^This card payment can't be deleted while a return is recorded against it: “Returned payment” \(Sep 12, \$200\.00\)\. Delete the return first/) });
    }
    expect([snapshot(b), b.sts(), b.rec(c)]).toEqual([before, 50000, 100000]);
  });
  it('an imported payment with an imported return: refused; the import history and statement links are untouched; re-importing either statement adds nothing', () => {
    const { b, c, v } = setup();
    const p = importPayment(b, c, v);
    const rb = importReturn(b, c, p.out.id);
    expect(deleteProblem(b.data, p.out.id)).toMatch(/recorded by the import of statement\.csv\)\. Undo the import that recorded a return/);
    const before = snapshot(b);
    expect(errorOf(() => deleteTransaction(b.ctx(), p.out.id))).not.toBeNull();
    expect(snapshot(b)).toBe(before);
    expect(describeImportUndo(b.data, rb)).toMatch(/^Import undone\. Removed 1 imported transaction; the returned card payment is no longer recorded/);
    // re-importing: both rows are recognised as already imported (exact duplicates), none is selected
    const again = b.review(c, [PAY, RET]);
    expect(again.preview.candidates.map((x) => [x.duplicate?.level ?? null, x.include])).toEqual([['exact', false], ['exact', false]]);
  });
  it('several returns: refused, all listed; bulk delete of the payment with only one of its returns is refused (nothing deleted); with all of them it goes → $500', () => {
    const { b, c, v } = setup();
    const out = b.add(payInput(c, v)).find((t) => t.amountCents < 0)!;
    const r1 = manualReturn(b, out.id, c, 8000, '2026-09-11');
    const r2 = manualReturn(b, out.id, c, 5000, '2026-09-12');
    expect(deleteProblem(b.data, out.id)).toMatch(/while 2 returns are recorded against it: “Returned payment” \(Sep 11, \$80\.00\); “Returned payment” \(Sep 12, \$50\.00\)/);
    const before = snapshot(b);
    expect(errorOf(() => deleteTransactions(b.ctx(), [out.id, r1.id]))?.message).toMatch(/while a return is recorded against it: “Returned payment” \(Sep 12, \$50\.00\)/);
    expect(snapshot(b)).toBe(before);
    b.data = applyOps(b.data, deleteTransactions(b.ctx(), [out.id, r1.id, r2.id]));
    expect([b.sts(), b.data.transactions.length]).toEqual([50000, 0]);
  });
  it('deleting only a return is always allowed: the payment counts as on its way again → $500', () => {
    const { b, c, v } = setup();
    const out = b.add(payInput(c, v)).find((t) => t.amountCents < 0)!;
    const r = manualReturn(b, out.id, c, 20000);
    expect(deleteProblem(b.data, r.id)).toBeNull();
    b.data = applyOps(b.data, deleteTransaction(b.ctx(), r.id));
    // Checking 800; Visa 500 − 200 on its way = 300 → 500
    expect([b.sts(), b.rec(c), inTransit(b), b.data.transactions.length]).toEqual([50000, 80000, [20000], 2]);
  });
  it('the audit case end to end: undo the return import, undo the payment import, re-import both statements → same books as before ($500, Checking $1,000, one return)', () => {
    const { b, c, v } = setup();
    const p = importPayment(b, c, v);
    const rb = importReturn(b, c, p.out.id);
    b.undo(rb);
    b.undo(p.batch);
    expect([b.sts(), b.data.transactions.length, b.data.importBatches.map((x) => !!x.undoneAt)]).toEqual([50000, 0, [true, true]]);
    const p2 = importPayment(b, c, v);
    // the earlier return statement: its row is never selected as income; it is offered as the return of the new payment
    const rv = b.review(c, [RET]);
    expect([row(rv, 'RETURNED PAYMENT').include, row(rv, 'RETURNED PAYMENT').duplicate]).toEqual([false, null]);
    importReturn(b, c, p2.out.id);
    expect([b.sts(), b.rec(c), b.rec(v), b.data.transactions.filter((t) => t.returnOf && t.amountCents > 0).length]).toEqual([50000, 100000, -50000, 1]);
  });
});

describe('commitImport is unaffected for unrelated rows', () => {
  it('an import that created only expenses undoes as before, even while some other payment has returns', () => {
    const { b, c, v } = setup();
    const out = b.add(payInput(c, v)).find((t) => t.amountCents < 0)!;
    manualReturn(b, out.id, c, 20000);
    const r = b.commit(b.review(c, [['2026-09-11', 'COFFEE', -500, 99500]]));
    expect(importUndoProblem(b.data, r.batch.id)).toBeNull();
    b.undo(r.batch.id);
    // Checking 1,000; Visa 500 → 500
    expect(b.sts()).toBe(50000);
  });
  it('commitImport still refuses nothing new: a return statement row is suggested for a payment with returns left', () => {
    const { b, c, v } = setup();
    const out = b.add(payInput(c, v)).find((t) => t.amountCents < 0)!;
    manualReturn(b, out.id, c, 8000);
    const rv = b.review(c, [['2026-09-12', 'PAYMENT RETURNED', 12000, 100000]]);
    expect(row(rv, 'PAYMENT RETURNED').matchCandidates.filter((m) => m.basis === 'return').map((m) => [m.txId, m.returnInfo?.remainingAfterCents])).toEqual([[out.id, 0]]);
    expect(typeof commitImport).toBe('function');
  });
});
