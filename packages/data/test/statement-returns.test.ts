import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createNobleProvider } from '@clarity/security/noble';
import { cardPaymentsInTransit } from '@clarity/engine';
import { cardPaymentEvidence, findMatchCandidates } from '@clarity/import';
import type { ID } from '@clarity/shared';
import { applyOps, commitImport, deleteTransaction, importUndoProblem, matchOptionView, MemoryAdapter, recordPaymentReturn, StaleDataError, WorkspaceStore } from '../src';
import { Book, errorOf, row, type Line } from './fixtures/settlement-harness';

/**
 * Phase 4A.8 (audit 4A.7.1 N1, N2, N4). Checking $1,000; Visa owes $500; no schedules; today Sep 12, 2026. Expected
 * values are worked out by hand from each bank's own ledger (no production calculation is the oracle):
 * - a $200 payment Visa hasn't posted: Checking 800, Visa 500 with 200 on its way → 300 counted → Safe to Spend $500;
 * - that payment returned: Checking 1,000, Visa owes 500 → $500;
 * - the payment imported as a card payment but its return as a separate refund: Checking 1,000, Visa 300 → $700
 *   (the audit's overstatement, only when the user says the money is separate).
 */
const setup = () => {
  const b = new Book();
  const c = b.acct('Checking', 'checking', 100000);
  const v = b.acct('Visa', 'credit_card', 50000);
  b.at('2026-09-12');
  return { b, c, v };
};
const PAY: Line = ['2026-09-10', 'PAYMENT TO VISA', -20000, 80000];
const RET: Line = ['2026-09-12', 'RETURNED PAYMENT', 20000, 100000];
const transit = (b: Book) => cardPaymentsInTransit(b.data.accounts, b.data.transactions, b.today).map((p) => p.cents);
const state = (b: Book, c: ID, v: ID) => ({ checking: b.rec(c), visaOwes: -b.rec(v), sts: b.sts() });
const same = (b: Book) => JSON.stringify([b.data.transactions, b.data.importBatches, b.data.accounts]);
const pairOf = (rv: ReturnType<Book['review']>, raw = 'RETURNED PAYMENT') => `row:${row(rv, raw).statementReturnOf![0]!.paymentRow}`;

describe('N4: card-payment wording', () => {
  const accts = [{ id: 'visa', name: 'Visa', type: 'credit_card' as const, archived: false }, { id: 'freedom', name: 'Chase Freedom', type: 'credit_card' as const, archived: false }, { id: 'chk', name: 'Checking', type: 'checking' as const, archived: false }];
  it.each([
    ['PAYMENT TO VISA', true, 'visa'],
    ['VISA PAYMENT', true, 'visa'],
    ['PAYMENT THANK YOU', true, null],
    ['CHASE FREEDOM PMT 0912', true, 'freedom'],
    ['ONLINE PAYMENT - AMEX', true, null], // a card network the user has no card for: a card payment, card unknown
    ['PAYMENT TO CITY WATER', false, null], // "payment" without a card
    ['ONLINE PAYMENT 1234', false, null], // ambiguous: stays an expense the user can change
    ['VISA GIFT CARD PURCHASE', false, null], // a card word without "payment"
    ['VISA DEBIT PURCHASE SHELL', false, null],
  ])('%s → card payment %s, card %s', (desc, looks, card) => {
    expect(cardPaymentEvidence(desc, accts)).toEqual({ looks, cardId: card });
  });
  it('two cards on the same network: a card payment, but which card is the user\'s choice', () => {
    expect(cardPaymentEvidence('VISA PAYMENT', [{ id: 'a', name: 'Chase Visa', type: 'credit_card', archived: false }, { id: 'b', name: 'Costco Visa', type: 'credit_card', archived: false }])).toEqual({ looks: true, cardId: null });
  });
  it('in the review: "PAYMENT TO VISA" is a transfer with Visa suggested, still unselected until confirmed; "PAYMENT TO CITY WATER" stays an expense', () => {
    const { b, c, v } = setup();
    const rv = b.review(c, [PAY, ['2026-09-11', 'PAYMENT TO CITY WATER', -4000, 76000]]);
    expect([row(rv, 'PAYMENT TO VISA').looksLikeTransfer, row(rv, 'PAYMENT TO VISA').suggestedOtherAccountId, row(rv, 'PAYMENT TO VISA').include]).toEqual([true, v, false]);
    expect([row(rv, 'PAYMENT TO CITY WATER').looksLikeTransfer, row(rv, 'PAYMENT TO CITY WATER').suggestedOtherAccountId, row(rv, 'PAYMENT TO CITY WATER').include]).toEqual([false, undefined, true]);
  });
});

describe('N1: a card payment and its return in the same statement', () => {
  it('first import with both rows: the return is proposed, unselected; confirming it → Checking $1,000, Visa owes $500, $500 (not $700)', () => {
    const { b, c, v } = setup();
    const rv = b.review(c, [PAY, RET]);
    const r = row(rv, 'RETURNED PAYMENT');
    expect([r.include, r.kind, r.statementReturnOf!.map((o) => [o.paymentRow, o.full, o.cardEvidence]), r.reasons.at(-1)]).toEqual([false, 'refund', [[row(rv, 'PAYMENT TO VISA').rowNumber, true, true]], `Could be the return of the card payment in row ${row(rv, 'PAYMENT TO VISA').rowNumber} of this statement. Choose whether it is, or that it's a separate transaction.`]);
    const res = b.commit(rv, { 'PAYMENT TO VISA': 'auto', 'RETURNED PAYMENT': pairOf(rv) }, { other: { 'PAYMENT TO VISA': v } });
    expect(state(b, c, v)).toEqual({ checking: 100000, visaOwes: 50000, sts: 50000 });
    expect([transit(b), res.batch.counts.imported, res.batch.counts.returns, res.batch.counts.awaiting ?? 0]).toEqual([[], 1, 1, 0]);
    // each row is its own account's posted statement row; nothing on the Visa side is posted by this import
    const pay = b.data.transactions.filter((t) => t.transferGroupId && !t.returnOf);
    const ret = b.data.transactions.filter((t) => t.returnOf);
    expect(pay.map((t) => [t.accountId === c ? 'C' : 'V', t.amountCents, t.status])).toEqual([['C', -20000, 'confirmed'], ['V', 20000, 'pending']]);
    expect(ret.map((t) => [t.accountId === c ? 'C' : 'V', t.amountCents, t.status, t.returnOf === pay[0]!.transferGroupId])).toEqual([['C', 20000, 'confirmed', true], ['V', -20000, 'pending', true]]);
    // statement-row identity kept on both rows: re-importing the same statement finds both as exact duplicates
    expect(b.review(c, [PAY, RET]).preview.candidates.map((x) => [x.duplicate?.level ?? null, x.include, x.statementReturnOf ?? null])).toEqual([['exact', false, null], ['exact', false, null]]);
  });

  it('the rows in either order in the file → the same books', () => {
    const { b, c, v } = setup();
    const rv = b.review(c, [RET, PAY]);
    b.commit(rv, { 'PAYMENT TO VISA': 'auto', 'RETURNED PAYMENT': pairOf(rv) }, { other: { 'PAYMENT TO VISA': v } });
    expect([state(b, c, v), transit(b)]).toEqual([{ checking: 100000, visaOwes: 50000, sts: 50000 }, []]);
  });

  it('no decision: the row stays out by default; including it without deciding is refused and nothing changes', () => {
    const { b, c, v } = setup();
    const rv = b.review(c, [PAY, RET]);
    const before = same(b);
    expect(errorOf(() => b.commit(rv, { 'PAYMENT TO VISA': 'auto', 'RETURNED PAYMENT': 'auto' }, { other: { 'PAYMENT TO VISA': v } }))).toMatchObject({ field: 'match', message: expect.stringMatching(/could be the return of the card payment in row \d+ of this statement\. Choose whether it is/) });
    expect(same(b)).toBe(before);
    // importing only the payment (the return left out, its default) is allowed: Checking 800, Visa 300 → $500
    b.commit(rv, { 'PAYMENT TO VISA': 'auto' }, { other: { 'PAYMENT TO VISA': v } });
    expect(state(b, c, v)).toEqual({ checking: 80000, visaOwes: 30000, sts: 50000 });
  });

  it('the user rejects the pairing: imported as a separate refund (their decision) → $700', () => {
    const { b, c, v } = setup();
    const rv = b.review(c, [PAY, RET]);
    b.commit(rv, { 'PAYMENT TO VISA': 'auto', 'RETURNED PAYMENT': 'none' }, { other: { 'PAYMENT TO VISA': v } });
    // Checking 1,000; Visa 500 − 200 on its way = 300 → 700
    expect([state(b, c, v), b.data.transactions.filter((t) => t.returnOf).length, b.data.transactions.find((t) => t.kind === 'refund')?.amountCents]).toEqual([{ checking: 100000, visaOwes: 30000, sts: 70000 }, 0, 20000]);
  });

  it('ambiguous: two $200 card payments in the statement → both offered (closest first); the user picks the older one → $500', () => {
    const { b, c, v } = setup();
    const lines: Line[] = [['2026-09-05', 'VISA PAYMENT', -20000, 80000], PAY, RET];
    const rv = b.review(c, lines);
    const opts = row(rv, 'RETURNED PAYMENT').statementReturnOf!;
    expect(opts.map((o) => o.date)).toEqual(['2026-09-10', '2026-09-05']);
    b.commit(rv, { 'VISA PAYMENT': 'auto', 'PAYMENT TO VISA': 'auto', 'RETURNED PAYMENT': `row:${opts[1]!.paymentRow}` }, { other: { 'VISA PAYMENT': v, 'PAYMENT TO VISA': v } });
    // Checking 1,000 − 400 + 200 = 800; Visa 500 − 200 (Sep 10, on its way) = 300 → 500
    const sep5 = b.data.transactions.find((t) => t.date === '2026-09-05' && t.accountId === c)!;
    expect([state(b, c, v), b.data.transactions.find((t) => t.returnOf && t.accountId === c)!.returnOf]).toEqual([{ checking: 80000, visaOwes: 30000, sts: 50000 }, sep5.transferGroupId]);
  });

  it('the payment row must be imported as a transfer to a credit card: left out, as an expense, or to savings → refused, nothing changes', () => {
    const { b, c, v } = setup();
    const s = b.acct('Savings', 'savings', 0);
    const rv = b.review(c, [PAY, RET]);
    const before = same(b);
    expect(errorOf(() => b.commit(rv, { 'PAYMENT TO VISA': 'skip', 'RETURNED PAYMENT': pairOf(rv) }))?.message).toMatch(/can't be the payment this row returns \(it is left out of this import/);
    expect(errorOf(() => b.commit(rv, { 'PAYMENT TO VISA': 'auto', 'RETURNED PAYMENT': pairOf(rv) }))?.message).toMatch(/import row \d+ as the card payment \(a transfer to your credit card\)/);
    expect(errorOf(() => b.commit(rv, { 'PAYMENT TO VISA': 'auto', 'RETURNED PAYMENT': pairOf(rv) }, { other: { 'PAYMENT TO VISA': s } }))?.message).toMatch(/imported as a transfer to Savings, which isn't a credit card/);
    expect(same(b)).toBe(before);
    expect(state(b, c, v)).toEqual({ checking: 100000, visaOwes: 50000, sts: 50000 });
  });

  it('a pairing the review never offered (or one forged by a caller) is refused as stale', () => {
    const { b, c, v } = setup();
    const rv = b.review(c, [PAY, RET]);
    const decisions = b.decisions(rv, { 'PAYMENT TO VISA': 'auto', 'RETURNED PAYMENT': pairOf(rv) }, { 'PAYMENT TO VISA': v }).map((d) => (d.candidate.rawDescription === 'RETURNED PAYMENT' ? { ...d, candidate: { ...d.candidate, statementReturnOf: [] } } : d));
    const before = same(b);
    expect(errorOf(() => b.commit(rv, {}, { decisions }))).toMatchObject({ field: 'stale' });
    // and a caller that drops the proposal from the candidate still has to decide (re-derived from the rows)
    const silent = b.decisions(rv, { 'PAYMENT TO VISA': 'auto', 'RETURNED PAYMENT': 'auto' }, { 'PAYMENT TO VISA': v }).map((d) => ({ ...d, candidate: { ...d.candidate, statementReturnOf: undefined } }));
    expect(errorOf(() => b.commit(rv, {}, { decisions: silent }))?.message).toMatch(/could be the return of the card payment/);
    expect(same(b)).toBe(before);
  });

  it('a partial return in the statement ($80 "PAYMENT REVERSAL"): offered; recorded → Checking 880, Visa owes 380, $500', () => {
    const { b, c, v } = setup();
    const rv = b.review(c, [PAY, ['2026-09-12', 'PAYMENT REVERSAL', 8000, 88000]]);
    expect(row(rv, 'PAYMENT REVERSAL').statementReturnOf!.map((o) => o.full)).toEqual([false]);
    b.commit(rv, { 'PAYMENT TO VISA': 'auto', 'PAYMENT REVERSAL': pairOf(rv, 'PAYMENT REVERSAL') }, { other: { 'PAYMENT TO VISA': v } });
    expect([state(b, c, v), transit(b)]).toEqual([{ checking: 88000, visaOwes: 38000, sts: 50000 }, [12000]]);
  });

  it('several return rows of one payment: $120 + $80 = the whole $200 → $500; a third $50 is refused (returns can\'t exceed the payment)', () => {
    const { b, c, v } = setup();
    const lines: Line[] = [PAY, ['2026-09-11', 'RETURNED PMT A', 12000, 92000], ['2026-09-12', 'RETURNED PMT B', 8000, 100000]];
    const rv = b.review(c, lines);
    const decide = { 'PAYMENT TO VISA': 'auto', 'RETURNED PMT A': pairOf(rv, 'RETURNED PMT A'), 'RETURNED PMT B': pairOf(rv, 'RETURNED PMT B') };
    const over = b.review(c, [...lines, ['2026-09-12', 'RETURNED PMT C', 5000, 105000]]);
    const before = same(b);
    expect(errorOf(() => b.commit(over, { ...decide, 'RETURNED PMT C': pairOf(over, 'RETURNED PMT C') }, { other: { 'PAYMENT TO VISA': v } }))?.message).toMatch(/only \$0\.00 of this \$200\.00 payment is left to return/);
    expect(same(b)).toBe(before);
    b.commit(rv, decide, { other: { 'PAYMENT TO VISA': v } });
    expect([state(b, c, v), transit(b)]).toEqual([{ checking: 100000, visaOwes: 50000, sts: 50000 }, []]);
  });

  it('the return is already in Clarity (recorded against an earlier payment): offered as that transaction (a link, nothing added) as well as the pairing; the user links it', () => {
    const { b, c, v } = setup();
    const p0 = b.transfer(c, v, '2026-09-04', 20000, 'confirmed', 'pending');
    const r0 = recordPaymentReturn(b.ctx(), { paymentLegId: p0.out.id, accountId: c, amountCents: 20000, date: '2026-09-12', merchant: 'RETURNED PAYMENT' });
    b.data = applyOps(b.data, r0.ops);
    const rv = b.review(c, [PAY, RET]);
    const r = row(rv, 'RETURNED PAYMENT');
    // the existing return leg is a candidate (the user links it); the pairing with the new payment row is offered too,
    // and the user's choice decides (here: the return already recorded; the payment row is a different payment)
    expect([r.matchCandidates.some((m) => m.txId === r0.txs[0]!.id), r.statementReturnOf!.length]).toEqual([true, 1]);
    b.commit(rv, { 'PAYMENT TO VISA': 'none', 'RETURNED PAYMENT': r0.txs[0]!.id }, { other: { 'PAYMENT TO VISA': v } });
    // Checking 1,000 − 200 + 200 − 200 = 800; Visa: Sep 4 payment returned; Sep 10 payment on its way → 300 → 500
    expect([state(b, c, v), b.data.transactions.filter((t) => t.returnOf).length]).toEqual([{ checking: 80000, visaOwes: 30000, sts: 50000 }, 2]);
  });

  it('a payment row that could also be an existing payment: both are offered; linking the payment row to it and returning that payment works; pairing with a linked row is refused', () => {
    const { b, c, v } = setup();
    const p0 = b.transfer(c, v, '2026-09-10', 20000, 'confirmed', 'pending');
    const rv = b.review(c, [PAY, RET]);
    const r = row(rv, 'RETURNED PAYMENT');
    expect([r.matchCandidates.filter((m) => m.basis === 'return').map((m) => m.txId), r.statementReturnOf!.length, row(rv, 'PAYMENT TO VISA').matchCandidates.map((m) => m.txId)]).toEqual([[p0.out.id], 1, [p0.out.id]]);
    const before = same(b);
    expect(errorOf(() => b.commit(rv, { 'PAYMENT TO VISA': p0.out.id, 'RETURNED PAYMENT': pairOf(rv) }))?.message).toMatch(/is linked to a transaction already in Clarity, so it isn't imported as a new payment/);
    expect(same(b)).toBe(before);
    // the statement's payment row IS the recorded payment (linked), and its return row is that payment's return
    b.commit(rv, { 'PAYMENT TO VISA': p0.out.id, 'RETURNED PAYMENT': p0.out.id });
    expect([state(b, c, v), transit(b)]).toEqual([{ checking: 100000, visaOwes: 50000, sts: 50000 }, []]);
  });

  it('a pending card payment of another amount in Clarity doesn\'t stop the pairing: the payment row is said to be different, then paired → the pending one still counts', () => {
    const { b, c, v } = setup();
    b.transfer(c, v, '2026-09-09', 7000, 'pending', 'pending');
    const rv = b.review(c, [PAY, RET]);
    expect([row(rv, 'PAYMENT TO VISA').matchCandidates.length > 0, row(rv, 'RETURNED PAYMENT').statementReturnOf!.length]).toEqual([true, 1]);
    b.commit(rv, { 'PAYMENT TO VISA': 'none', 'RETURNED PAYMENT': pairOf(rv) }, { other: { 'PAYMENT TO VISA': v } });
    // Checking 1,000 − 70 (pending) − 200 + 200 = 930; Visa 500 − 70 on its way = 430 → 500
    expect([state(b, c, v), transit(b)]).toEqual([{ checking: 93000, visaOwes: 43000, sts: 50000 }, [7000]]);
  });

  it('a refund that only looks like a return (AMAZON RETURN +$25 after an AMAZON purchase) is not proposed: no "payment" row', () => {
    const { b, c } = setup();
    const rv = b.review(c, [['2026-09-10', 'AMAZON MARKETPLACE', -2500, 97500], ['2026-09-12', 'AMAZON RETURN', 2500, 100000]]);
    expect([row(rv, 'AMAZON RETURN').statementReturnOf ?? null, row(rv, 'AMAZON RETURN').include, row(rv, 'AMAZON RETURN').kind]).toEqual([null, true, 'refund']);
  });

  it('a payment without card wording ("PAYMENT TO CITY WATER") is still offered (weaker evidence) but needs a decision; pairing it with a non-card transfer is refused', () => {
    const { b, c } = setup();
    const rv = b.review(c, [['2026-09-10', 'PAYMENT TO CITY WATER', -20000, 80000], RET]);
    expect(row(rv, 'RETURNED PAYMENT').statementReturnOf!.map((o) => o.cardEvidence)).toEqual([false]);
    expect(errorOf(() => b.commit(rv, { 'PAYMENT TO CITY WATER': 'auto', 'RETURNED PAYMENT': pairOf(rv) }))?.message).toMatch(/import row \d+ as the card payment/);
    b.commit(rv, { 'PAYMENT TO CITY WATER': 'auto', 'RETURNED PAYMENT': 'none' });
    // the user's decision: an expense and a separate refund → Checking 1,000; Visa 500 → 500
    expect(b.sts()).toBe(50000);
  });

  it('undo of the import with both rows removes both → $500; the same statement re-imported offers the pairing again', () => {
    const { b, c, v } = setup();
    const rv = b.review(c, [PAY, RET]);
    const res = b.commit(rv, { 'PAYMENT TO VISA': 'auto', 'RETURNED PAYMENT': pairOf(rv) }, { other: { 'PAYMENT TO VISA': v } });
    expect(importUndoProblem(b.data, res.batch.id)).toBeNull();
    b.undo(res.batch.id);
    expect([state(b, c, v), b.data.transactions.length]).toEqual([{ checking: 100000, visaOwes: 50000, sts: 50000 }, 0]);
    const again = b.review(c, [PAY, RET]);
    expect([row(again, 'RETURNED PAYMENT').statementReturnOf!.length, row(again, 'RETURNED PAYMENT').include]).toEqual([1, false]);
    b.commit(again, { 'PAYMENT TO VISA': 'auto', 'RETURNED PAYMENT': pairOf(again) }, { other: { 'PAYMENT TO VISA': v } });
    expect(state(b, c, v)).toEqual({ checking: 100000, visaOwes: 50000, sts: 50000 });
  });

  it('the audit sequence: import payment and return, delete the return, delete the payment, re-import → the return is offered as the payment\'s return, not imported as a refund', () => {
    const { b, c, v } = setup();
    const p = b.commit(b.review(c, [PAY]), { 'PAYMENT TO VISA': 'auto' }, { other: { 'PAYMENT TO VISA': v } });
    const out = p.txs.find((t) => t.accountId === c)!;
    b.commit(b.review(c, [RET]), { 'RETURNED PAYMENT': out.id });
    b.data = applyOps(b.data, deleteTransaction(b.ctx(), b.data.transactions.find((t) => t.returnOf && t.accountId === c)!.id));
    b.data = applyOps(b.data, deleteTransaction(b.ctx(), out.id));
    expect(state(b, c, v)).toEqual({ checking: 100000, visaOwes: 50000, sts: 50000 });
    const rv = b.review(c, [PAY, RET]);
    expect([row(rv, 'RETURNED PAYMENT').include, row(rv, 'RETURNED PAYMENT').statementReturnOf!.length, row(rv, 'PAYMENT TO VISA').looksLikeTransfer]).toEqual([false, 1, true]);
    b.commit(rv, { 'PAYMENT TO VISA': 'auto', 'RETURNED PAYMENT': pairOf(rv) }, { other: { 'PAYMENT TO VISA': v } });
    expect([state(b, c, v), transit(b)]).toEqual([{ checking: 100000, visaOwes: 50000, sts: 50000 }, []]);
  });

  it('independent posting: Visa later posts the payment (its statement) → the reversal is owed: Visa 500, $500; the checking side is untouched', () => {
    const { b, c, v } = setup();
    const rv = b.review(c, [PAY, RET]);
    b.commit(rv, { 'PAYMENT TO VISA': 'auto', 'RETURNED PAYMENT': pairOf(rv) }, { other: { 'PAYMENT TO VISA': v } });
    const visaLeg = b.data.transactions.find((t) => t.transferGroupId && !t.returnOf && t.accountId === v)!;
    b.commit(b.review(v, [['2026-09-11', 'PAYMENT THANK YOU', 20000, -30000]], 'as_is'), { 'PAYMENT THANK YOU': visaLeg.id });
    expect([b.tx(visaLeg.id).status, state(b, c, v), b.data.transactions.filter((t) => t.accountId === c).map((t) => t.status)]).toEqual(['confirmed', { checking: 100000, visaOwes: 50000, sts: 50000 }, ['confirmed', 'confirmed']]);
  });

  it('stale: the payment row was imported (another tab) after this review opened → refused, nothing changes', () => {
    const { b, c, v } = setup();
    const rv = b.review(c, [PAY, RET]);
    b.commit(b.review(c, [PAY]), { 'PAYMENT TO VISA': 'auto' }, { other: { 'PAYMENT TO VISA': v } });
    const before = same(b);
    expect(errorOf(() => b.commit(rv, { 'PAYMENT TO VISA': 'auto', 'RETURNED PAYMENT': pairOf(rv) }, { other: { 'PAYMENT TO VISA': v } }))).toMatchObject({ field: 'stale' });
    expect(same(b)).toBe(before);
  });

  it('two tabs commit the same reviewed statement: the second is refused by storage; the books have one payment and one return', async () => {
    const { b, c, v } = setup();
    const adapter = new MemoryAdapter();
    const provider = createNobleProvider((n) => new Uint8Array(randomBytes(n)));
    const { store: init } = await WorkspaceStore.create(adapter, provider, 'correct horse battery', { withRecoveryKey: false, now: 1 });
    await init.apply(b.data.accounts.map((a) => ({ t: 'put' as const, table: 'accounts' as const, value: a })));
    const tabA = await WorkspaceStore.unlock(adapter, provider, { passphrase: 'correct horse battery' });
    const tabB = await WorkspaceStore.unlock(adapter, provider, { passphrase: 'correct horse battery' });
    const opsFor = (store: WorkspaceStore) => {
      const x = new Book(); x.data = store.data; x.today = b.today;
      const rv = x.review(c, [PAY, RET]);
      return commitImport(store.ctx(5, b.today), { accountId: c, fileName: 's.csv', fileHash: 'h', parserId: 'csv', headerSignature: 'h', delimiter: ',', settings: rv.settings, decisions: x.decisions(rv, { 'PAYMENT TO VISA': 'auto', 'RETURNED PAYMENT': pairOf(rv) }, { 'PAYMENT TO VISA': v }), totalRows: 2, excludedCount: 0, duplicateCount: 0, errorCount: 0, reconciliation: null, applyAdjustment: false }).ops;
    };
    const a = opsFor(tabA); const bOps = opsFor(tabB);
    await tabA.apply(a);
    await expect(tabB.apply(bOps)).rejects.toBeInstanceOf(StaleDataError);
    const stored = await WorkspaceStore.unlock(adapter, provider, { passphrase: 'correct horse battery' });
    expect([stored.data.transactions.filter((t) => t.returnOf).length, stored.data.transactions.filter((t) => t.transferGroupId && !t.returnOf).length, stored.data.importBatches.length]).toEqual([2, 2, 1]);
  });
});

describe('N2: a transfer fee can\'t make a returned payment smaller than its returns', () => {
  const visaRow = (cents: number): Line => ['2026-09-11', 'PAYMENT THANK YOU', cents, -50000 + cents];
  const paid = (b: Book, c: ID, v: ID) => { const t = b.transfer(c, v, '2026-09-10', 20000, 'confirmed', 'pending'); return { out: t.out, vin: t.in }; };
  const ret = (b: Book, leg: ID, c: ID, cents: number) => { b.data = applyOps(b.data, recordPaymentReturn(b.ctx(), { paymentLegId: leg, accountId: c, amountCents: cents, date: b.today }).ops); };
  const live = (b: Book, v: ID, cents: number, id: ID) => findMatchCandidates({ date: '2026-09-11', amountCents: cents, rawDescription: 'PAYMENT THANK YOU' }, b.a(v), b.data.transactions, { accounts: b.data.accounts }).find((m) => m.txId === id)!;
  const withFee = (b: Book, rv: ReturnType<Book['review']>, id: ID, feeCents: number) => b.decisions(rv, { 'PAYMENT THANK YOU': id }).map((d) => ({ ...d, match: { ...(d.match as { txId: ID }), txId: id, fee: { feeCents } } }));

  it('fully returned $200; Visa shows $150 received: no fee option (the reason is shown); a direct commit with the fee is refused; nothing changes', () => {
    const { b, c, v } = setup();
    const p = paid(b, c, v);
    ret(b, p.out.id, c, 20000);
    const m = live(b, v, 15000, p.vin.id);
    expect([m.feeOption, m.feeBlockedByReturnsCents]).toEqual([null, 20000]);
    expect(matchOptionView(m, 15000, b.data, 'USD').disabledReason).toBe("Can't be linked: $200.00 of this payment was already returned, so it can't become $150.00 with a transfer fee (returns can't exceed the payment). Remove the return first, or leave the row out.");
    const rv = b.review(v, [visaRow(15000)], 'as_is');
    const before = same(b);
    expect(errorOf(() => b.commit(rv, {}, { decisions: withFee(b, rv, p.vin.id, 5000) as never }))).toMatchObject({ field: 'match' });
    expect([same(b), state(b, c, v)]).toEqual([before, { checking: 100000, visaOwes: 50000, sts: 50000 }]);
  });

  it('$80 returned; Visa shows $150 → allowed ($150 ≥ $80): payment $150 + $50 fee; Checking 880, Visa owes 430, $450', () => {
    const { b, c, v } = setup();
    const p = paid(b, c, v);
    ret(b, p.out.id, c, 8000);
    expect(live(b, v, 15000, p.vin.id).feeOption?.feeCents).toBe(5000);
    const rv = b.review(v, [visaRow(15000)], 'as_is');
    b.commit(rv, { 'PAYMENT THANK YOU': p.vin.id });
    // Checking: −150 − 50 fee + 80 = 880; Visa received 150 (posted), reversal 80 owed → 500 − 150 + 80 = 430
    expect(state(b, c, v)).toEqual({ checking: 88000, visaOwes: 43000, sts: 45000 });
  });

  it('exactly equal: $150 returned, Visa shows $150 → allowed, fully returned; Checking 950, Visa 500, $450', () => {
    const { b, c, v } = setup();
    const p = paid(b, c, v);
    ret(b, p.out.id, c, 15000);
    const rv = b.review(v, [visaRow(15000)], 'as_is');
    b.commit(rv, { 'PAYMENT THANK YOU': p.vin.id });
    expect(state(b, c, v)).toEqual({ checking: 95000, visaOwes: 50000, sts: 45000 });
  });

  it('several partial returns ($80 + $50 = $130): $120 has no fee option; $130 does', () => {
    const { b, c, v } = setup();
    const p = paid(b, c, v);
    ret(b, p.out.id, c, 8000); ret(b, p.out.id, c, 5000);
    expect([live(b, v, 12000, p.vin.id).feeOption, live(b, v, 12000, p.vin.id).feeBlockedByReturnsCents, live(b, v, 13000, p.vin.id).feeOption?.feeCents]).toEqual([null, 13000, 7000]);
  });

  it('stale preview: reviewed (fee offered) before a return was recorded; committing it then is refused, nothing changes', () => {
    const { b, c, v } = setup();
    const p = paid(b, c, v);
    const rv = b.review(v, [visaRow(15000)], 'as_is');
    const decisions = b.decisions(rv, { 'PAYMENT THANK YOU': p.vin.id });
    expect((decisions[0]!.match as { fee?: { feeCents: number } }).fee).toEqual({ feeCents: 5000 });
    ret(b, p.out.id, c, 20000);
    const before = same(b);
    expect(errorOf(() => b.commit(rv, {}, { decisions }))).not.toBeNull();
    expect(same(b)).toBe(before);
  });

  it('a wrong fee amount submitted directly is refused', () => {
    const { b, c, v } = setup();
    const p = paid(b, c, v);
    const rv = b.review(v, [visaRow(15000)], 'as_is');
    expect(errorOf(() => b.commit(rv, {}, { decisions: withFee(b, rv, p.vin.id, 4000) as never }))?.message).toMatch(/Confirm the \$50\.00 transfer fee/);
  });

  it('one card statement with the payment received at $150 (fee) AND its full $200 reversal: refused as a whole (returns would exceed the payment)', () => {
    const { b, c, v } = setup();
    const p = paid(b, c, v);
    const rv = b.review(v, [visaRow(15000), ['2026-09-12', 'PAYMENT REVERSED', -20000, -50000]], 'as_is');
    const rev = row(rv, 'PAYMENT REVERSED');
    expect(rev.matchCandidates.some((m) => m.basis === 'return' && m.txId === p.vin.id)).toBe(true);
    const before = same(b);
    // the fee row is processed first (allowed on its own), then the reversal; the final check refuses the combination
    expect(errorOf(() => b.commit(rv, { 'PAYMENT THANK YOU': p.vin.id, 'PAYMENT REVERSED': p.vin.id }))?.message).toBe("This import would leave a card payment of $150.00 with $200.00 returned. Returns can't exceed the payment; nothing was imported. Review the statement again.");
    expect(same(b)).toBe(before);
  });
});
