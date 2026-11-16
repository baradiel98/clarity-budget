import { describe, expect, it } from 'vitest';
import { accountBalance, balanceTrail, buildDailyLedger, computeSafeToSpend, ledgerDayExplanation } from '@clarity/engine';
import type { WorkspaceData } from '@clarity/shared';
import { addTransaction, adjustBalance, applyOps, engineInput, updateTransaction, type Ctx, type TxInput } from '../src';
import { Book } from './fixtures/settlement-harness';

/**
 * Phase 5A.3 (F3): transactions recorded at exactly the time a balance was confirmed (identical timestamps, e.g. a
 * frozen or coarse clock). Time can't order them; the trail uses the figure entered only when it supports exactly one
 * placement, and otherwise says it can't tell. No balance depends on any of this. Expected values worked out by hand.
 */
const T = Date.UTC(2026, 10, 16, 10); // every record below is created at this same instant unless stated
let n = 0;
const at = (b: Book, now: number): Ctx => ({ data: b.data, now, today: b.today, newId: (p) => `${p}_t${++n}` });
const add = (b: Book, now: number, i: Partial<TxInput> & Pick<TxInput, 'accountId' | 'amountCents' | 'merchant'>) => {
  const r = addTransaction(at(b, now), { kind: 'expense', categoryId: null, date: b.today, ...i } as TxInput);
  b.data = applyOps(b.data, r.ops); return r.txs[0]!;
};
const confirm = (b: Book, now: number, id: string, cents: number) => { b.data = applyOps(b.data, adjustBalance(at(b, now), id, cents, 'QA', b.today, { unrelatedToPending: true }).ops); };
const view = (b: Book, C: string) => balanceTrail(engineInput(b.data, b.today), C);
const setup = () => { const b = new Book(); b.at('2026-11-01'); const C = b.acct('Checking', 'checking', 120000); b.at('2026-11-16'); return { b, C }; };

describe('Equal timestamps around a balance confirmation (Phase 5A.3, F3)', () => {
  /**
   * The production QA case: Checking $1,200.00; two $6.50 coffees; Update balance $1,187.00 (= 1,200 − 6.50 − 6.50,
   * exact match); then a $10.00 "QA coffee". All four records carry the same time T.
   * Figure entered − opening = −$13.00; of the three same-time purchases only the two coffees add up to −$13.00
   * (−6.50 − 10.00 = −16.50, −6.50 − 6.50 − 10.00 = −23.00), so: coffees in the figure, QA coffee after it.
   */
  it('the stored figure supports exactly one placement: coffees in it, QA coffee after; no spurious change line', () => {
    const { b, C } = setup();
    add(b, T, { accountId: C, amountCents: 650, merchant: 'Coffee' });
    add(b, T, { accountId: C, amountCents: 650, merchant: 'Coffee' });
    confirm(b, T, C, 118700);
    add(b, T, { accountId: C, amountCents: 1000, merchant: 'QA coffee' });
    const t = view(b, C);
    expect(t.anchor).toEqual({ kind: 'confirmed', date: '2026-11-16', cents: 118700 });
    expect(t.sameTime.map((x) => [x.label, x.cents, x.placement]).sort()).toEqual([['Coffee', -650, 'in_confirmed'], ['Coffee', -650, 'in_confirmed'], ['QA coffee', -1000, 'after']]);
    expect(t.lines.map((l) => [l.label, l.deltaCents, l.balanceAfterCents, l.reason, l.sameTime])).toEqual([['QA coffee', -1000, 117700, 'same_time', 'after']]);
    expect([t.changesSinceCents, t.recordedCents]).toEqual([0, 117700]);
    // what the screen says (both apps render this explanation)
    const input = engineInput(b.data, b.today);
    const ex = ledgerDayExplanation(input, buildDailyLedger(input, { kind: 'account', accountId: C }), b.today)!;
    expect(ex.lines.filter((l) => l.label === 'Coffee').map((l) => [l.kind, l.note])).toEqual([
      ['info', "−$6.50 · recorded at the same moment as the confirmation; the confirmed figure shows it was already in it, so it isn't counted again"],
      ['info', "−$6.50 · recorded at the same moment as the confirmation; the confirmed figure shows it was already in it, so it isn't counted again"],
    ]);
    expect(ex.lines.find((l) => l.label === 'QA coffee')!.note).toBe("Recorded · recorded at the same moment as the confirmation; the confirmed figure shows it wasn't in it");
    expect(ex.lines.some((l) => l.label.startsWith('Changes since'))).toBe(false);
  });

  /**
   * Two identical $5.00 purchases at time T; the confirmation ($995.00 on a $1,000.00 opening) contains exactly one of
   * them, but either one could be it: Clarity can't tell, so both are counted on top and the difference says why.
   * Trail: $995.00 → $990.00 → $985.00; recorded $990.00 → a +$5.00 difference explained as the same-time ambiguity.
   */
  it('several placements fit: both listed as "can\'t tell", the difference is explained as that ambiguity, balances unchanged', () => {
    const b = new Book(); b.at('2026-11-01'); const C = b.acct('Checking', 'checking', 100000); b.at('2026-11-16');
    add(b, T, { accountId: C, amountCents: 500, merchant: 'Bakery' });
    confirm(b, T, C, 99500);
    add(b, T, { accountId: C, amountCents: 500, merchant: 'Bakery' });
    const t = view(b, C);
    expect(t.sameTime.map((x) => x.placement)).toEqual(['unknown', 'unknown']);
    expect(t.lines.map((l) => [l.balanceAfterCents, l.reason, l.sameTime])).toEqual([[99000, 'same_time', 'unknown'], [98500, 'same_time', 'unknown']]);
    expect([t.changesSinceCents, t.recordedCents, t.changedAfter]).toEqual([500, 99000, []]);
    expect(t.recordedCents).toBe(accountBalance(b.a(C), b.data.transactions, b.today));
    const input = engineInput(b.data, b.today);
    const ex = ledgerDayExplanation(input, buildDailyLedger(input, { kind: 'account', accountId: C }), b.today)!;
    expect(ex.lines.find((l) => l.label.startsWith('Changes since'))!.note).toContain("Clarity can't tell whether they were already in it");
    expect(ex.lines.filter((l) => l.label === 'Bakery').every((l) => l.note!.includes("Clarity can't tell whether it was already in the confirmed figure"))).toBe(true);
  });

  it('a placement that only fits by cancelling out (+$10 and −$10) is not invented', () => {
    const { b, C } = setup();
    add(b, T, { accountId: C, amountCents: 1000, merchant: 'Refund in', kind: 'refund' });
    add(b, T, { accountId: C, amountCents: 1000, merchant: 'Shop' });
    confirm(b, T, C, 120000); // either both are in it or neither: the figure can't say which
    expect(view(b, C).sameTime.map((x) => x.placement)).toEqual(['unknown', 'unknown']);
  });

  it('when a transaction was edited after the confirmation, a matching sum is not trusted (the edit could explain it)', () => {
    const { b, C } = setup();
    const early = add(b, T - 60_000, { accountId: C, amountCents: 2000, merchant: 'Earlier' });
    add(b, T, { accountId: C, amountCents: 650, merchant: 'Coffee' });
    confirm(b, T, C, 120000 - 2000 - 650);
    b.data = applyOps(b.data, updateTransaction(at(b, T + 60_000), early.id, { kind: 'expense', accountId: C, date: b.today, amountCents: 2000, merchant: 'Earlier (renamed)', categoryId: null }).ops);
    expect(view(b, C).sameTime.map((x) => x.placement)).toEqual(['unknown']);
  });

  it('deterministic: the same trail whatever order the records are stored in', () => {
    const { b, C } = setup();
    add(b, T, { accountId: C, amountCents: 650, merchant: 'Coffee' });
    add(b, T, { accountId: C, amountCents: 300, merchant: 'Tea' });
    confirm(b, T, C, 120000 - 650);
    add(b, T, { accountId: C, amountCents: 1000, merchant: 'QA coffee' });
    const a = JSON.stringify(view(b, C));
    const reversed: WorkspaceData = { ...b.data, transactions: [...b.data.transactions].reverse() };
    expect(JSON.stringify(balanceTrail(engineInput(reversed, b.today), C))).toBe(a);
  });

  it('distinct timestamps behave as before; and no balance or Safe to Spend depends on record times', () => {
    const { b, C } = setup();
    add(b, T - 2, { accountId: C, amountCents: 650, merchant: 'Coffee' });
    confirm(b, T, C, 120000 - 650);
    add(b, T + 2, { accountId: C, amountCents: 1000, merchant: 'QA coffee' });
    const t = view(b, C);
    expect([t.sameTime, t.lines.map((l) => [l.label, l.reason])]).toEqual([[], [['QA coffee', 'recorded_after']]]);
    // the same records with every time set equal: identical balances and Safe to Spend
    const tied: WorkspaceData = { ...b.data, transactions: b.data.transactions.map((x) => ({ ...x, createdAt: T, updatedAt: T })) };
    expect(accountBalance(tied.accounts[0]!, tied.transactions, b.today)).toBe(accountBalance(b.a(C), b.data.transactions, b.today));
    expect(computeSafeToSpend(engineInput(tied, b.today)).cents).toBe(computeSafeToSpend(engineInput(b.data, b.today)).cents);
    expect(balanceTrail(engineInput(tied, b.today), C).recordedCents).toBe(t.recordedCents);
  });
});
