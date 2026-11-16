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
/** Today's Day details for the account: the explanation both apps display. */
const explain = (b: Book, C: string) => { const input = engineInput(b.data, b.today); return ledgerDayExplanation(input, buildDailyLedger(input, { kind: 'account', accountId: C }), b.today)!; };
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
    const t = view(b, C);
    expect(t.sameTime.map((x) => x.placement)).toEqual(['unknown', 'unknown']);
    // both counted on top: $1,200.00 + $10.00 − $10.00 = $1,200.00 = recorded, so no difference to explain
    expect([t.lines.length, t.lines[1]!.balanceAfterCents, t.changesSinceCents, t.recordedCents]).toEqual([2, 120000, 0, 120000]);
    const ex = explain(b, C);
    expect(ex.lines.filter((l) => l.label === 'Refund in' || l.label === 'Shop').map((l) => l.note).sort()).toEqual([
      "Recorded · recorded at the same moment as the confirmation, so Clarity can't tell whether it was already in the confirmed figure; it's counted here",
      "Recorded · recorded at the same moment as the confirmation, so Clarity can't tell whether it was already in the confirmed figure; it's counted here",
    ]);
    expect(ex.lines.some((l) => l.label.startsWith('Changes since') || /already in it|wasn't in it/.test(l.note ?? ''))).toBe(false);
  });

  it('when a transaction was edited after the confirmation, a matching sum is not trusted (the edit could explain it)', () => {
    const { b, C } = setup();
    const early = add(b, T - 60_000, { accountId: C, amountCents: 2000, merchant: 'Earlier' });
    add(b, T, { accountId: C, amountCents: 650, merchant: 'Coffee' });
    confirm(b, T, C, 120000 - 2000 - 650);
    b.data = applyOps(b.data, updateTransaction(at(b, T + 60_000), early.id, { kind: 'expense', accountId: C, date: b.today, amountCents: 2000, merchant: 'Earlier (renamed)', categoryId: null }).ops);
    const t = view(b, C);
    expect(t.sameTime.map((x) => x.placement)).toEqual(['unknown']);
    // Coffee counted on top: $1,173.50 − $6.50 = $1,167.00; recorded $1,173.50 → a +$6.50 difference, explained as
    // either the same-moment coffee or the renamed transaction (both are named; neither is picked)
    expect([t.lines.map((l) => [l.label, l.balanceAfterCents, l.sameTime]), t.changesSinceCents, t.recordedCents]).toEqual([[['Coffee', 116700, 'unknown']], 650, 117350]);
    const ex = explain(b, C);
    const i = ex.lines.findIndex((l) => l.label.startsWith('Changes since'));
    expect([ex.lines[i]!.cents, ex.lines[i]!.note]).toEqual([650, "Some transactions were recorded at the same moment as this confirmation and Clarity can't tell whether they were already in it, so part or all of this difference may be them rather than a later edit or deletion."]);
    expect([ex.lines[i + 1]!.label, ex.lines[i + 1]!.note]).toEqual(['Earlier (renamed)', 'changed after you confirmed this balance; now −$20.00']);
    expect(ex.lines.find((l) => l.label === 'Coffee')!.note).toBe("Recorded · recorded at the same moment as the confirmation, so Clarity can't tell whether it was already in the confirmed figure; it's counted here");
    expect(ex.lines.some((l) => /likely a deleted transaction/.test(l.note ?? ''))).toBe(false);
  });

  /**
   * More than 12 same-moment records: never searched, always "can't tell". Amounts are 1, 2, 4, … 4,096 cents, so every
   * total has exactly ONE combination: if the 13 were searched they would be placed. The confirmation contains the first
   * three (1 + 2 + 4 = 7 cents): figure $1,199.93. All 13 counted on top: $1,199.93 − $81.91 = $1,118.02; recorded
   * $1,200.00 − $81.91 = $1,118.09 → +$0.07, explained as the same-moment ambiguity (not as a deletion).
   */
  it('13 same-moment records (more than the 12 searched): all "can\'t tell", the difference explained as that, no deletion claim', () => {
    const { b, C } = setup();
    for (let i = 0; i < 3; i++) add(b, T, { accountId: C, amountCents: 2 ** i, merchant: `Item ${i + 1}` });
    confirm(b, T, C, 120000 - 7);
    for (let i = 3; i < 13; i++) add(b, T, { accountId: C, amountCents: 2 ** i, merchant: `Item ${i + 1}` });
    const t = view(b, C);
    expect(t.sameTime).toHaveLength(13);
    expect(t.sameTime.every((x) => x.placement === 'unknown')).toBe(true);
    expect(t.lines.every((l) => l.reason === 'same_time' && l.sameTime === 'unknown')).toBe(true);
    expect([t.lines.length, t.lines[12]!.balanceAfterCents, t.changesSinceCents, t.recordedCents]).toEqual([13, 111802, 7, 111809]);
    expect(t.recordedCents).toBe(accountBalance(b.a(C), b.data.transactions, b.today));
    const ex = explain(b, C);
    const items = ex.lines.filter((l) => l.label.startsWith('Item '));
    expect(items).toHaveLength(13);
    expect(items.every((l) => l.note === "Recorded · recorded at the same moment as the confirmation, so Clarity can't tell whether it was already in the confirmed figure; it's counted here")).toBe(true);
    const change = ex.lines.find((l) => l.label.startsWith('Changes since'))!;
    expect([change.cents, change.note]).toEqual([7, "Some transactions were recorded at the same moment as this confirmation and Clarity can't tell whether they were already in it, so part or all of this difference may be them rather than a later edit or deletion."]);
    expect(ex.lines.some((l) => /likely a deleted transaction|already in it, so it isn't counted again|wasn't in it/.test(l.note ?? ''))).toBe(false);
  });

  it('12 same-moment records (the limit) with one fitting combination are placed: the boundary of the rule above', () => {
    const { b, C } = setup();
    for (let i = 0; i < 3; i++) add(b, T, { accountId: C, amountCents: 2 ** i, merchant: `Item ${i + 1}` });
    confirm(b, T, C, 120000 - 7);
    for (let i = 3; i < 12; i++) add(b, T, { accountId: C, amountCents: 2 ** i, merchant: `Item ${i + 1}` });
    const t = view(b, C);
    // Items 1–3 in the figure; 4–12 after it: $1,199.93 − (8 + … + 2,048 = 4,088) cents = $1,159.05 = recorded; no difference
    expect(t.sameTime.filter((x) => x.placement === 'in_confirmed').map((x) => x.label).sort()).toEqual(['Item 1', 'Item 2', 'Item 3']);
    expect(t.sameTime.filter((x) => x.placement === 'after')).toHaveLength(9);
    expect([t.changesSinceCents, t.recordedCents]).toEqual([0, 115905]);
    expect(explain(b, C).lines.some((l) => l.label.startsWith('Changes since'))).toBe(false);
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
