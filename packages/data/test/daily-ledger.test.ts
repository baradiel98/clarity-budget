import { describe, expect, it } from 'vitest';
import {
  accountBalance, balanceTrail, buildDailyLedger, buildForecast, computeSafeToSpend, GOLDEN_SCENARIOS, ledgerDayExplanation, planningWindowEnd,
  type EngineInput, type Forecast,
} from '@clarity/engine';
import { addTransaction, adjustBalance, applyOps, buildDemoWorkspace, createRecurring, deleteTransaction, engineInput, type TxInput } from '../src';
import { Book } from './fixtures/settlement-harness';

/**
 * Phase 5A: the daily ledger is a read-only view of the existing forecast. Expected values are worked out by hand from
 * each setup (comments show the arithmetic); the invariants check the ledger against the forecast's own figures.
 */
const inclusive = (input: EngineInput): Forecast => buildForecast({
  today: input.today, horizonEnd: planningWindowEnd(input), accounts: input.accounts, transactions: input.transactions, recurring: input.recurring,
  exceptions: input.exceptions, baseCurrency: input.baseCurrency, includeEstimatedIncome: true,
});
const tx = (b: Book, i: Partial<TxInput> & Pick<TxInput, 'accountId' | 'date' | 'amountCents' | 'merchant'>) => b.add({ kind: 'expense', categoryId: null, ...i } as TxInput);
const bill = (b: Book, name: string, accountId: string, cents: number, day: number, extra: object = {}) => {
  const r = createRecurring(b.ctx(), { name, kind: 'bill', accountId, categoryId: null, schedule: { freq: 'monthly', interval: 1, day, anchor: '2026-01-01' } as never, amount: { type: 'fixed', cents }, ...extra } as never);
  b.data = applyOps(b.data, r.ops); return r.item.id;
};
const confirm = (b: Book, id: string, cents: number, opts = {}) => { const r = adjustBalance(b.ctx(), id, cents, 'Matches bank', b.today, opts); b.data = applyOps(b.data, r.ops); return r; };
const day = (l: ReturnType<typeof buildDailyLedger>, d: string) => l.days.find((x) => x.date === d)!;
const rows = (l: ReturnType<typeof buildDailyLedger>, d: string) => day(l, d).entries.map((e) => [e.label, e.deltaCents, e.balanceAfterCents, e.basis]);

/**
 * The owner's example: Checking at $1,500 on Nov 15; groceries $85 on Nov 15; on Nov 16 electricity $115 (a scheduled
 * bill), gas $50 and another scheduled expense $250 (planned, future-dated). Hand-worked:
 *   Nov 15: $1,500.00 − $85.00 = $1,415.00
 *   Nov 16: $1,415.00 − $250.00 − $115.00 − $50.00 = $1,000.00 (all spendable cash: $1,165.00, $1,050.00, $1,000.00 after each,
 *           largest outflow first; the account alone: gas, other, electricity → $1,365.00, $1,115.00, $1,000.00)
 */
function example(groceries: Partial<TxInput> = {}) {
  const b = new Book(); b.at('2026-11-15');
  const C = b.acct('Checking', 'checking', 150000);
  tx(b, { accountId: C, date: '2026-11-15', amountCents: 8500, merchant: 'Groceries', ...groceries });
  bill(b, 'Electricity', C, 11500, 16);
  tx(b, { accountId: C, date: '2026-11-16', amountCents: 5000, merchant: 'Gas' });
  tx(b, { accountId: C, date: '2026-11-16', amountCents: 25000, merchant: 'Other scheduled expense' });
  return { b, C, input: engineInput(b.data, b.today) };
}

describe('Daily ledger (Phase 5A): the owner example', () => {
  it('$1,500 → $1,415 on Nov 15 → $1,000 at the end of Nov 16, for the account and for all spendable cash', () => {
    const { C, input } = example();
    for (const scope of [{ kind: 'account' as const, accountId: C }, { kind: 'cash' as const }]) {
      const l = buildDailyLedger(input, scope);
      expect([day(l, '2026-11-15').startCents, day(l, '2026-11-15').endCents]).toEqual([141500, 141500]);
      expect(day(l, '2026-11-16').startCents).toBe(141500);
      // all spendable cash: money out sorted largest first (the forecast's own order for the low point); one account:
      // in the order the forecast applies it to that account (recorded plans first, then scheduled items). Same end.
      expect(rows(l, '2026-11-16')).toEqual(scope.kind === 'cash' ? [
        ['Other scheduled expense', -25000, 116500, 'planned'],
        ['Electricity', -11500, 105000, 'scheduled'],
        ['Gas', -5000, 100000, 'planned'],
      ] : [
        ['Gas', -5000, 136500, 'planned'],
        ['Other scheduled expense', -25000, 111500, 'planned'],
        ['Electricity', -11500, 100000, 'scheduled'],
      ]);
      expect([day(l, '2026-11-16').lowCents, day(l, '2026-11-16').endCents]).toEqual([100000, 100000]);
    }
    // the trail into today: the opening balance the user entered, then the groceries recorded on that date
    const t = balanceTrail(input, C);
    expect(t.anchor).toEqual({ kind: 'opening', date: '2026-11-15', cents: 150000 });
    expect(t.lines.map((x) => [x.label, x.deltaCents, x.balanceAfterCents, x.pending])).toEqual([['Groceries', -8500, 141500, false]]);
    expect([t.recordedCents, t.pendingCreditCents, t.availableCents, t.changesSinceCents]).toEqual([141500, 0, 141500, 0]);
  });

  it('"Already included": the $85 is part of the $1,500 and is never subtracted again ($1,500 → $1,085)', () => {
    const { C, input } = example({ includedInBalance: true });
    const t = balanceTrail(input, C);
    expect(t.anchor.cents).toBe(150000);
    expect(t.lines).toEqual([]);
    expect(t.alreadyIncluded.map((x) => [x.label, x.cents])).toEqual([['Groceries', -8500]]);
    expect(t.recordedCents).toBe(150000);
    const l = buildDailyLedger(input, { kind: 'account', accountId: C });
    // $1,500 − $250 − $115 − $50 = $1,085
    expect([day(l, '2026-11-15').endCents, day(l, '2026-11-16').endCents]).toEqual([150000, 108500]);
  });

  it('pending groceries: counted at once (money going out), labelled pending; the result is the same $1,415 / $1,000', () => {
    const { C, input } = example({ status: 'pending' });
    const t = balanceTrail(input, C);
    expect(t.lines.map((x) => [x.label, x.deltaCents, x.pending])).toEqual([['Groceries', -8500, true]]);
    expect(t.availableCents).toBe(141500);
    expect(day(buildDailyLedger(input, { kind: 'cash' }), '2026-11-16').endCents).toBe(100000);
  });

  it('day details: the explanation adds up line by line and ends at the forecast figure', () => {
    const { b, C, input } = example();
    const l = buildDailyLedger(input, { kind: 'account', accountId: C });
    const today = ledgerDayExplanation(input, l, '2026-11-15')!;
    expect(today.lines.map((x) => [x.kind, x.label, x.cents, x.balanceAfterCents])).toEqual([
      ['start', 'Opening balance (Nov 15)', 150000, undefined],
      ['out', 'Groceries', -8500, 141500],
      ['start', 'Recorded balance today', 141500, undefined],
      ['result', 'End of day', 141500, undefined],
    ]);
    const next = ledgerDayExplanation(input, l, '2026-11-16')!;
    expect(next.resultCents).toBe(100000);
    expect(next.lines.map((x) => x.balanceAfterCents).filter((x) => x !== undefined)).toEqual([136500, 111500, 100000]);
    expect(next.lines.find((x) => x.label === 'Electricity')!.note).toBe('Scheduled');
    // reading the ledger changes nothing
    expect(computeSafeToSpend(engineInput(b.data, b.today)).cents).toBe(computeSafeToSpend(input).cents);
  });
});

describe('Daily ledger (Phase 5A): which transactions are in the last confirmed balance', () => {
  /**
   * Checking opened Nov 1 with $2,000. Before confirming: rent −$300 on Nov 3 (posted), a refund +$40 on Nov 10 still
   * pending. Nov 15 Update balance: bank posted balance $1,500. Clarity's posted balance then: $2,000 − $300 = $1,700
   * (the pending refund isn't posted) → adjustment −$200. Afterwards the user records:
   *   groceries −$85 dated Nov 15 (default: counted, a same-day purchase usually isn't in the bank's figure);
   *   coffee −$30 dated Nov 14, explicitly NOT already included (counted);
   *   lunch −$25 dated Nov 12 with the default (dated before the confirmed date: already included, history only);
   *   a pharmacy charge −$20 dated Nov 16 is in the future (not in today's balance).
   * Trail: $1,500 confirmed; + $40 refund (pending, not in a posted balance) = $1,540; − $30 coffee = $1,510;
   *        − $85 groceries = $1,425 = recorded today (2,000 − 300 + 40 − 200 − 30 − 85). Available: $1,425 − $40 = $1,385.
   */
  function confirmed() {
    const b = new Book(); b.at('2026-11-01');
    const C = b.acct('Checking', 'checking', 200000);
    b.at('2026-11-03'); tx(b, { accountId: C, date: '2026-11-03', amountCents: 30000, merchant: 'Rent' });
    b.at('2026-11-10'); b.add({ kind: 'refund', accountId: C, date: '2026-11-10', amountCents: 4000, merchant: 'Refund', categoryId: null, status: 'pending' });
    b.at('2026-11-15');
    const r = confirm(b, C, 150000);
    expect(r.tx!.amountCents).toBe(-20000);
    tx(b, { accountId: C, date: '2026-11-15', amountCents: 8500, merchant: 'Groceries' });
    tx(b, { accountId: C, date: '2026-11-14', amountCents: 3000, merchant: 'Coffee', includedInBalance: false });
    tx(b, { accountId: C, date: '2026-11-12', amountCents: 2500, merchant: 'Lunch' });
    tx(b, { accountId: C, date: '2026-11-16', amountCents: 2000, merchant: 'Pharmacy' });
    return { b, C };
  }
  const expectTrail = (t: ReturnType<typeof balanceTrail>) => {
    expect(t.lines.map((x) => [x.label, x.date, x.deltaCents, x.balanceAfterCents, x.reason])).toEqual([
      ['Refund', '2026-11-10', 4000, 154000, 'not_posted'],
      ['Coffee', '2026-11-14', -3000, 151000, 'recorded_after'],
      ['Groceries', '2026-11-15', -8500, 142500, 'recorded_after'],
    ]);
    expect([t.recordedCents, t.pendingCreditCents, t.availableCents, t.changesSinceCents]).toEqual([142500, 4000, 138500, 0]);
    expect(t.earlierIncludedCount).toBe(1); // the Nov 12 lunch
  };

  it('a confirmation entered with Update balance: starts from the $1,500 entered; nothing in it is subtracted again', () => {
    const { b, C } = confirmed();
    const input = engineInput(b.data, b.today);
    expect(b.a(C).balanceConfirmation).toMatchObject({ date: '2026-11-15', postedCents: 150000 });
    const t = balanceTrail(input, C);
    expect(t.anchor).toEqual({ kind: 'confirmed', date: '2026-11-15', cents: 150000 });
    expectTrail(t);
    // the ledger starts today from what the trail ends at; Nov 16: $1,385 − $20 pharmacy = $1,365
    const l = buildDailyLedger(input, { kind: 'account', accountId: C });
    expect([day(l, '2026-11-15').startCents, day(l, '2026-11-16').endCents]).toEqual([138500, 136500]);
    expect(accountBalance(b.a(C), b.data.transactions, b.today)).toBe(142500);
  });

  it('a confirmation from before Phase 5A (no stored figure): the same $1,500, worked out from the adjustment', () => {
    const { b, C } = confirmed();
    b.data = { ...b.data, accounts: b.data.accounts.map((a) => { const { balanceConfirmation: _, ...rest } = a; return rest; }) };
    const t = balanceTrail(engineInput(b.data, b.today), C);
    expect(t.anchor).toEqual({ kind: 'confirmed_from_records', date: '2026-11-15', cents: 150000 });
    expectTrail(t);
  });

  it('a later change to a transaction dated before the confirmation is shown as its own line, so the trail still adds up', () => {
    const { b, C } = confirmed();
    const rent = b.data.transactions.find((x) => x.merchant === 'Rent')!;
    b.data = applyOps(b.data, deleteTransaction(b.ctx(), rent.id));
    const t = balanceTrail(engineInput(b.data, b.today), C);
    expect(t.anchor.cents).toBe(150000);
    // recorded now: $1,425 + $300 = $1,725; the $300 is the change since confirming
    expect([t.recordedCents, t.changesSinceCents]).toEqual([172500, 30000]);
    expect(t.anchor.cents + t.lines.reduce((s, x) => s + x.deltaCents, 0) + t.changesSinceCents).toBe(t.recordedCents);
  });

  it('an exact-match confirmation (no adjustment) stores the figure; items recorded afterwards are counted on top', () => {
    const b = new Book(); b.at('2026-11-01');
    const C = b.acct('Checking', 'checking', 100000);
    b.at('2026-11-15');
    const r = confirm(b, C, 100000);
    expect(r.tx).toBeNull();
    tx(b, { accountId: C, date: '2026-11-15', amountCents: 8500, merchant: 'Groceries' });
    const t = balanceTrail(engineInput(b.data, b.today), C);
    expect(t.anchor).toEqual({ kind: 'confirmed', date: '2026-11-15', cents: 100000 });
    expect(t.lines.map((x) => [x.label, x.balanceAfterCents, x.reason])).toEqual([['Groceries', 91500, 'recorded_after']]);
  });

  it('a card: the trail and ledger use the card balance (negative = owed); a pending refund stays in the card balance', () => {
    const b = new Book(); b.at('2026-11-01');
    const V = b.acct('Visa', 'credit_card', 40000); // owes $400
    b.at('2026-11-15');
    tx(b, { accountId: V, date: '2026-11-14', amountCents: 6000, merchant: 'Shoes' });
    b.add({ kind: 'refund', accountId: V, date: '2026-11-15', amountCents: 1000, merchant: 'Refund', categoryId: null, status: 'pending' });
    const input = engineInput(b.data, b.today);
    const t = balanceTrail(input, V);
    // −$400 − $60 + $10 = −$450 recorded (owed $450); a card keeps its recorded balance in the forecast
    expect([t.anchor.cents, t.recordedCents, t.pendingCreditCents, t.availableCents]).toEqual([-40000, -45000, 0, -45000]);
    const l = buildDailyLedger(input, { kind: 'account', accountId: V });
    expect(l.isCard).toBe(true);
    expect(day(l, '2026-11-15').startCents).toBe(-45000);
    const ex = ledgerDayExplanation(input, l, '2026-11-15')!;
    // shown as owed: $400 → +$60 → −$10 → $450
    expect(ex.lines.filter((x) => x.balanceAfterCents !== undefined).map((x) => [x.label, x.cents, x.balanceAfterCents])).toEqual([['Shoes', 6000, 46000], ['Refund', -1000, 45000]]);
    expect(ex.assumptions).toContain("Projected card balances include only charges, payments and refunds you recorded or scheduled. Interest and fees you haven't recorded aren't included.");
  });
});

describe('Daily ledger (Phase 5A): accounts, transfers and cards', () => {
  /**
   * Nov 15. Checking $1,000, Savings $500, Visa owes $300. Scheduled from Checking: Savings $100 on Nov 20
   * (Checking → Savings), Visa payment $200 on Nov 22 (Checking → Visa), Paycheck $800 on Nov 20 (income). A $40
   * purchase on the Visa planned for Nov 18. A pending $25 refund on Checking today.
   */
  function accounts() {
    const b = new Book(); b.at('2026-11-15');
    const C = b.acct('Checking', 'checking', 100000);
    const S = b.acct('Savings', 'savings', 50000);
    const V = b.acct('Visa', 'credit_card', 30000);
    const rec = (name: string, kind: string, cents: number, day: number, extra: object = {}) => {
      const r = createRecurring(b.ctx(), { name, kind, accountId: C, categoryId: null, schedule: { freq: 'monthly', interval: 1, day, anchor: '2026-01-01' } as never, amount: { type: 'fixed', cents }, ...extra } as never);
      b.data = applyOps(b.data, r.ops);
    };
    rec('To savings', 'savings', 10000, 20, { toAccountId: S });
    rec('Visa payment', 'transfer', 20000, 22, { toAccountId: V });
    rec('Paycheck', 'income', 80000, 20);
    tx(b, { accountId: V, date: '2026-11-18', amountCents: 4000, merchant: 'Hardware store' });
    b.add({ kind: 'refund', accountId: C, date: '2026-11-15', amountCents: 2500, merchant: 'Refund', categoryId: null, status: 'pending' });
    return { b, C, S, V, input: engineInput(b.data, b.today) };
  }

  it('each account has its own running balance; all spendable cash never includes savings or the card', () => {
    const { C, S, V, input } = accounts();
    const chk = buildDailyLedger(input, { kind: 'account', accountId: C });
    // today: recorded $1,025 (refund pending), available $1,000
    expect(day(chk, '2026-11-15').startCents).toBe(100000);
    // Nov 20: money out first: − $100 to savings = $900; then + $800 paycheck = $1,700
    expect(rows(chk, '2026-11-20')).toEqual([['To savings', -10000, 90000, 'scheduled'], ['Paycheck', 80000, 170000, 'scheduled']]);
    expect(day(chk, '2026-11-20').lowCents).toBe(90000);
    // Nov 22: − $200 card payment = $1,500
    expect(rows(chk, '2026-11-22')).toEqual([['Visa payment', -20000, 150000, 'scheduled']]);
    const sav = buildDailyLedger(input, { kind: 'account', accountId: S });
    expect(rows(sav, '2026-11-20')).toEqual([['To savings', 10000, 60000, 'scheduled']]);
    const visa = buildDailyLedger(input, { kind: 'account', accountId: V });
    // −$300 → −$340 (purchase) → −$140 (payment)
    expect(rows(visa, '2026-11-18')).toEqual([['Hardware store', -4000, -34000, 'planned']]);
    expect(rows(visa, '2026-11-22')).toEqual([['Visa payment', 20000, -14000, 'scheduled']]);
    const cash = buildDailyLedger(input, { kind: 'cash' });
    expect(day(cash, '2026-11-18').entries).toEqual([]); // a card purchase doesn't move cash
    expect(rows(cash, '2026-11-20')).toEqual([['To savings', -10000, 90000, 'scheduled'], ['Paycheck', 80000, 170000, 'scheduled']]);
    expect(day(cash, '2026-11-22').endCents).toBe(150000);
    // the transfer: one movement, −$100 and +$100, both accounts named
    expect(day(chk, '2026-11-20').entries[0]!.accountIds).toEqual([C, S]);
    // pending refund: in the recorded balance, not available
    const t = balanceTrail(input, C);
    expect([t.recordedCents, t.pendingCreditCents, t.availableCents]).toEqual([102500, 2500, 100000]);
  });
});

/** Every day, every account: the ledger reproduces the forecast's own figures exactly. */
function checkInvariants(input: EngineInput) {
  const f = inclusive(input);
  const cash = buildDailyLedger(input, { kind: 'cash' }, { forecast: f });
  const cashIds = new Set(f.cashAccountIds);
  let combinedOnly = 0; // money covered from / repaid to the spendable accounts as a whole (no single account)
  cash.days.forEach((d, i) => {
    const fd = f.days[i]!;
    expect(d.startCents + d.entries.reduce((s, e) => s + e.deltaCents, 0)).toBe(fd.endCashCents);
    expect([d.startCents, d.lowCents, d.endCents]).toEqual([fd.startCashCents, fd.lowCashCents, fd.endCashCents]);
    if (i > 0) expect(d.startCents).toBe(cash.days[i - 1]!.endCents);
    for (const e of fd.events) combinedOnly += -(e.coverCents ?? 0) + (e.repaidCents ?? 0);
    const sumAccounts = [...cashIds].reduce((s, id) => s + (fd.accountEndCents[id] ?? 0), 0);
    expect(sumAccounts + combinedOnly).toBe(fd.endCashCents);
  });
  for (const a of input.accounts) {
    const l = buildDailyLedger(input, { kind: 'account', accountId: a.id }, { forecast: f });
    l.days.forEach((d, i) => {
      expect(d.startCents + d.entries.reduce((s, e) => s + e.deltaCents, 0)).toBe(d.endCents);
      expect(d.endCents).toBe(f.days[i]!.accountEndCents[a.id]);
      if (i > 0) expect(d.startCents).toBe(l.days[i - 1]!.endCents);
      expect(d.lowCents).toBeLessThanOrEqual(Math.min(d.startCents, d.endCents));
    });
    const t = balanceTrail(input, a.id);
    expect(t.availableCents).toBe(l.days[0]!.startCents);
    expect(t.anchor.cents + t.lines.reduce((s, x) => s + x.deltaCents, 0) + t.changesSinceCents).toBe(t.recordedCents);
    expect(t.recordedCents).toBe(accountBalance(a, input.transactions, input.today));
  }
}

describe('Daily ledger (Phase 5A): invariants against the forecast', () => {
  it('the sample workspace, on several days', () => {
    for (const today of ['2026-11-13', '2026-11-19', '2027-01-10']) checkInvariants(engineInput(buildDemoWorkspace(today, Date.UTC(2026, 10, 13)), today));
  });
  it('every golden scenario (savings covering bills, unfunded transfers, cash advances, archived and overdrawn accounts, currencies)', () => {
    for (const [, input] of Object.entries(GOLDEN_SCENARIOS)) checkInvariants(input);
  });
  it('the scenarios above', () => {
    checkInvariants(example().input);
    checkInvariants(accounts2());
  });
  it('building the ledger changes no forecast figure', () => {
    const input = engineInput(buildDemoWorkspace('2026-11-13', Date.UTC(2026, 10, 13)), '2026-11-13');
    const before = JSON.stringify(computeSafeToSpend(input));
    buildDailyLedger(input, { kind: 'cash' });
    for (const a of input.accounts) { buildDailyLedger(input, { kind: 'account', accountId: a.id }); balanceTrail(input, a.id); }
    expect(JSON.stringify(computeSafeToSpend(input))).toBe(before);
  });
});

function accounts2(): EngineInput {
  const b = new Book(); b.at('2026-11-15');
  const C = b.acct('Checking', 'checking', 100000);
  const S = b.acct('Savings', 'savings', 5000);
  // a $120 bill paid from Savings, which holds $50: $70 has to come from the spendable accounts
  bill(b, 'Insurance', S, 12000, 20);
  b.transfer(C, S, '2026-11-15', 3000, 'confirmed', 'pending');
  return engineInput(b.data, b.today);
}
