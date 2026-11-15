import { describe, expect, it } from 'vitest';
import { balanceTrail, buildDailyLedger, computeSafeToSpend, ledgerDayExplanation, type DailyLedger } from '@clarity/engine';
import type { Account } from '@clarity/shared';
import { adjustBalance, applyOps, createRecurring, deleteTransaction, engineInput, markTransactionPosted, updateTransaction, type TxInput } from '../src';
import { Book } from './fixtures/settlement-harness';

/**
 * Phase 5A.1: daily ledger display corrections (D1–D5). Expected values are worked out by hand in the comments.
 * Nothing here changes a forecast figure: the combined view and Safe to Spend are checked against fixed values too.
 */
const day = (l: DailyLedger, d: string) => l.days.find((x) => x.date === d)!;
const rows = (l: DailyLedger, d: string) => day(l, d).entries.map((e) => [e.label, e.deltaCents, e.balanceAfterCents, e.coveredCents ?? 0]);
const rec = (b: Book, name: string, kind: string, accountId: string, cents: number, dayOfMonth: number, extra: object = {}) => {
  const r = createRecurring(b.ctx(), { name, kind, accountId, categoryId: null, schedule: { freq: 'monthly', interval: 1, day: dayOfMonth, anchor: '2026-01-01' } as never, amount: { type: 'fixed', cents }, ...extra } as never);
  b.data = applyOps(b.data, r.ops);
};
const tx = (b: Book, i: Partial<TxInput> & Pick<TxInput, 'accountId' | 'date' | 'amountCents' | 'merchant'>) => b.add({ kind: 'expense', categoryId: null, ...i } as TxInput);

describe('D1/D2: a non-spendable account shows its own balance; the shortfall is explained, not hidden', () => {
  it('Savings overdrawn by $100 today stays −$100 in its own view; all spendable cash still counts the $100', () => {
    const b = new Book(); b.at('2026-11-15');
    const C = b.acct('Checking', 'checking', 100000);
    const S = b.acct('Savings', 'savings', -10000);
    const input = engineInput(b.data, b.today);
    const sav = buildDailyLedger(input, { kind: 'account', accountId: S });
    // before 5A.1 the view went −$100 → $0 (the forecast's working balance assumes the money is moved in)
    expect([day(sav, '2026-11-15').startCents, day(sav, '2026-11-15').endCents, day(sav, '2026-11-16').endCents, day(sav, '2026-12-31').endCents]).toEqual([-10000, -10000, -10000, -10000]);
    expect(rows(sav, '2026-11-15')).toEqual([['Savings overdrawn balance', 0, -10000, 10000]]);
    // combined: $1,000 − $100 = $900, exactly as before
    const cash = buildDailyLedger(input, { kind: 'cash' });
    expect([day(cash, '2026-11-15').startCents, day(cash, '2026-11-15').endCents]).toEqual([100000, 90000]);
    // checking is never reduced by it
    expect(day(buildDailyLedger(input, { kind: 'account', accountId: C }), '2026-11-16').endCents).toBe(100000);
    expect(balanceTrail(input, S).availableCents).toBe(-10000);
    const ex = ledgerDayExplanation(input, sav, '2026-11-15')!;
    const line = ex.lines.find((l) => l.label === 'Savings overdrawn balance')!;
    expect([line.kind, line.cents, line.balanceAfterCents]).toEqual(['info', undefined, -10000]);
    expect(line.note).toContain("Savings is overdrawn by $100.00. Safe to Spend counts it against your spendable accounts (Clarity hasn't chosen which). It stays in this account's balance until money is moved in.");
    expect(ex.resultCents).toBe(-10000);
  });

  /** Savings $50 must pay $120 on Nov 20 and again Dec 20. Its own view: $50 → −$70 → −$190. Combined: −$70 then −$120. */
  it('Savings $50 paying $120: own view −$70, with what it can cover and what must come from spendable accounts', () => {
    const b = new Book(); b.at('2026-11-15');
    const C = b.acct('Checking', 'checking', 100000);
    const S = b.acct('Savings', 'savings', 5000);
    rec(b, 'Insurance', 'bill', S, 12000, 20);
    const input = engineInput(b.data, b.today);
    const sav = buildDailyLedger(input, { kind: 'account', accountId: S });
    expect(rows(sav, '2026-11-20')).toEqual([['Insurance', -12000, -7000, 7000]]);
    expect(rows(sav, '2026-12-20')).toEqual([['Insurance', -12000, -19000, 12000]]);
    expect(day(sav, '2026-11-20').lowCents).toBe(-7000);
    expect(day(sav, '2026-11-20').entries[0]!.notes).toEqual(["Savings can cover $50.00 of it; the other $70.00 has to come from your spendable accounts (Clarity hasn't chosen which). The balance shown is what Savings would hold if nothing is moved in."]);
    expect(day(sav, '2026-12-20').entries[0]!.notes[0]).toContain('Savings can cover $0.00 of it; the other $120.00');
    const cash = buildDailyLedger(input, { kind: 'cash' });
    expect([day(cash, '2026-11-20').endCents, day(cash, '2026-12-20').endCents]).toEqual([93000, 81000]);
    // the combined note says the same without "the balance shown" (it isn't this account's view)
    expect(day(cash, '2026-11-20').entries[0]!.notes).toEqual(["Savings can cover $50.00 of it; the other $70.00 has to come from your spendable accounts (Clarity hasn't chosen which)."]);
    expect(day(buildDailyLedger(input, { kind: 'account', accountId: C }), '2026-12-31').endCents).toBe(100000);
    expect(computeSafeToSpend(input).cents).toBe(81000); // unchanged from Phase 5A review (scenario A)
  });

  it('money moved into an overdrawn savings account shows in full in its view (−$100 + $30 = −$70); combined unchanged', () => {
    const b = new Book(); b.at('2026-11-15');
    const C = b.acct('Checking', 'checking', 100000);
    const S = b.acct('Savings', 'savings', -10000);
    rec(b, 'Top up savings', 'savings', C, 3000, 18, { toAccountId: S });
    const input = engineInput(b.data, b.today);
    const sav = buildDailyLedger(input, { kind: 'account', accountId: S });
    expect(rows(sav, '2026-11-18')).toEqual([['Top up savings', 3000, -7000, 0]]);
    expect(day(sav, '2026-11-18').entries[0]!.notes[0]).toContain('$30.00 of it repays an overdrawn balance already counted against your spendable accounts');
    expect(rows(buildDailyLedger(input, { kind: 'account', accountId: C }), '2026-11-18')).toEqual([['Top up savings', -3000, 97000, 0]]);
    // the $30 repays debt already counted: combined stays $900 (no double count)
    expect(day(buildDailyLedger(input, { kind: 'cash' }), '2026-11-18').endCents).toBe(90000);
  });

  it("a card payment due from savings it can't fully fund: savings −$150 in its own view; the card receives the full $200", () => {
    const b = new Book(); b.at('2026-11-15');
    b.acct('Checking', 'checking', 100000);
    const S = b.acct('Savings', 'savings', 5000);
    const V = b.acct('Visa', 'credit_card', 30000);
    rec(b, 'Visa from savings', 'transfer', S, 20000, 22, { toAccountId: V });
    const input = engineInput(b.data, b.today);
    expect(rows(buildDailyLedger(input, { kind: 'account', accountId: S }), '2026-11-22')).toEqual([['Visa from savings', -20000, -15000, 15000]]);
    expect(rows(buildDailyLedger(input, { kind: 'account', accountId: V }), '2026-11-22')).toEqual([['Visa from savings', 20000, -10000, 0]]);
    expect(day(buildDailyLedger(input, { kind: 'cash' }), '2026-11-22').endCents).toBe(85000);
  });
});

describe('D3: the summary describes the order each view really uses', () => {
  it('combined: money out listed largest first (presentation); one account: the order the forecast applies it', () => {
    const b = new Book(); b.at('2026-11-15');
    const C = b.acct('Checking', 'checking', 50000);
    rec(b, 'Small', 'bill', C, 1000, 20); rec(b, 'Big', 'bill', C, 40000, 20);
    const input = engineInput(b.data, b.today);
    const cash = ledgerDayExplanation(input, buildDailyLedger(input, { kind: 'cash' }), '2026-11-20')!;
    expect(cash.summary).toContain('listed largest first');
    expect(cash.summary).toContain("doesn't change the day's lowest point or its end");
    expect(cash.summary).not.toContain('in the order the forecast applies it');
    const acct = ledgerDayExplanation(input, buildDailyLedger(input, { kind: 'account', accountId: C }), '2026-11-20')!;
    expect(acct.summary).toContain('in the order the forecast applies it to this account');
  });
});

describe('D4/D5: confirmations: reconstructed figures say so; later changes are named only when Clarity can tell', () => {
  /** Opened Nov 1 with $2,000; rent −$300 Nov 3; a pending refund +$40 Nov 10; Nov 15 Update balance $1,500 (adjustment −$200). */
  function confirmed() {
    const b = new Book(); b.at('2026-11-01');
    const C = b.acct('Checking', 'checking', 200000);
    b.at('2026-11-03'); tx(b, { accountId: C, date: '2026-11-03', amountCents: 30000, merchant: 'Rent' });
    b.at('2026-11-10'); b.add({ kind: 'refund', accountId: C, date: '2026-11-10', amountCents: 4000, merchant: 'Refund', categoryId: null, status: 'pending' });
    b.at('2026-11-15');
    b.data = applyOps(b.data, adjustBalance(b.ctx(), C, 150000, 'Matches bank', b.today).ops);
    tx(b, { accountId: C, date: '2026-11-15', amountCents: 8500, merchant: 'Groceries' });
    return { b, C };
  }
  const legacy = (b: Book) => { b.data = { ...b.data, accounts: b.data.accounts.map((a) => { const { balanceConfirmation: _, ...rest } = a as Account; return rest as Account; }) }; };
  const today = (b: Book, C: string) => { const input = engineInput(b.data, b.today); return ledgerDayExplanation(input, buildDailyLedger(input, { kind: 'account', accountId: C }), b.today)!; };

  it('D5 identifiable: rent edited $300 → $350 after confirming: the −$50 change, and rent named as changed (amount of the change not guessed)', () => {
    const { b, C } = confirmed();
    const rent = b.data.transactions.find((t) => t.merchant === 'Rent')!;
    b.data = applyOps(b.data, updateTransaction(b.ctx(), rent.id, { kind: 'expense', accountId: C, date: '2026-11-03', amountCents: 35000, merchant: 'Rent', categoryId: null }).ops);
    const t = balanceTrail(engineInput(b.data, b.today), C);
    // $1,500 + $40 − $85 = $1,455; recorded now $2,000 − $350 + $40 − $200 − $85 = $1,405 → change −$50
    expect([t.anchor.cents, t.changesSinceCents, t.recordedCents]).toEqual([150000, -5000, 140500]);
    expect(t.changedAfter.map((c) => [c.label, c.date, c.cents, c.counted])).toEqual([['Rent', '2026-11-03', -35000, true]]);
    const ex = today(b, C);
    const i = ex.lines.findIndex((l) => l.label.startsWith('Changes since you confirmed it'));
    expect([ex.lines[i]!.cents, ex.lines[i]!.note]).toEqual([-5000, "Clarity doesn't keep earlier versions of a transaction, so it can't show how much each one below changed. A deleted transaction can't be listed."]);
    expect([ex.lines[i + 1]!.kind, ex.lines[i + 1]!.label, ex.lines[i + 1]!.note]).toEqual(['info', 'Rent', 'changed after you confirmed this balance; now −$350.00']);
  });

  it('D5 identifiable: the pending refund marked posted later is named', () => {
    const { b, C } = confirmed();
    const ref = b.data.transactions.find((t) => t.merchant === 'Refund')!;
    b.at('2026-11-17'); b.data = applyOps(b.data, markTransactionPosted(b.ctx(), ref.id));
    const t = balanceTrail(engineInput(b.data, b.today), C);
    expect(t.changesSinceCents).toBe(4000);
    expect(t.changedAfter.map((c) => c.label)).toEqual(['Refund']);
  });

  it('D5 unidentifiable: rent deleted after confirming: +$300, a generic line, nothing named', () => {
    const { b, C } = confirmed();
    const rent = b.data.transactions.find((t) => t.merchant === 'Rent')!;
    b.data = applyOps(b.data, deleteTransaction(b.ctx(), rent.id));
    const t = balanceTrail(engineInput(b.data, b.today), C);
    expect([t.changesSinceCents, t.changedAfter]).toEqual([30000, []]);
    const line = today(b, C).lines.find((l) => l.label.startsWith('Changes since you confirmed it'))!;
    expect(line.note).toBe("No transaction dated on or before that date was edited after you confirmed it, so this is likely a deleted transaction. Clarity doesn't keep deleted transactions, so it can't name it.");
  });

  it('D5: an edit that changes no amount (a new merchant name) adds no change line and names nothing', () => {
    const { b, C } = confirmed();
    const rent = b.data.transactions.find((t) => t.merchant === 'Rent')!;
    b.data = applyOps(b.data, updateTransaction(b.ctx(), rent.id, { kind: 'expense', accountId: C, date: '2026-11-03', amountCents: 30000, merchant: 'Oakwood rent', categoryId: null }).ops);
    const t = balanceTrail(engineInput(b.data, b.today), C);
    expect([t.changesSinceCents, t.changedAfter]).toEqual([0, []]);
  });

  it('D4: an older confirmation with an adjustment is labelled reconstructed; a later deletion is included and said to be inseparable', () => {
    const { b, C } = confirmed();
    legacy(b);
    let ex = today(b, C);
    expect([ex.lines[0]!.label, ex.lines[0]!.cents]).toEqual(['Balance on Nov 15, reconstructed', 150000]);
    expect(ex.lines[0]!.note).toContain("The figure entered then isn't stored, so it may differ from it");
    expect(ex.lines[0]!.note).toContain('(from Update balance or a statement import)');
    expect(ex.lines.find((l) => l.label === 'Groceries')!.note).toBe('Recorded · recorded after that balance adjustment');
    // deleting rent: the reconstructed figure now includes it ($1,800) and no change line can be shown; current balance correct
    const rent = b.data.transactions.find((t) => t.merchant === 'Rent')!;
    b.data = applyOps(b.data, deleteTransaction(b.ctx(), rent.id));
    const t = balanceTrail(engineInput(b.data, b.today), C);
    expect([t.anchor.kind, t.anchor.cents, t.changesSinceCents, t.recordedCents]).toEqual(['confirmed_from_records', 180000, 0, 175500]);
    ex = today(b, C);
    expect(ex.lines[0]!.label).toBe('Balance on Nov 15, reconstructed');
    expect(ex.lines[0]!.note).toContain("later edits or deletions of transactions dated on or before this date are included here and can't be shown separately");
  });

  it('D4: an older exact-match confirmation (no adjustment, no stored figure) is labelled as recorded now, with the limitation', () => {
    const b = new Book(); b.at('2026-11-01');
    const C = b.acct('Checking', 'checking', 100000);
    b.at('2026-11-15');
    b.data = applyOps(b.data, adjustBalance(b.ctx(), C, 100000, 'm', b.today).ops);
    tx(b, { accountId: C, date: '2026-11-15', amountCents: 8500, merchant: 'Groceries' });
    legacy(b);
    const t = balanceTrail(engineInput(b.data, b.today), C);
    expect([t.anchor.kind, t.anchor.cents, t.recordedCents]).toEqual(['posted_in_records', 91500, 91500]);
    const first = today(b, C).lines[0]!;
    expect(first.label).toBe('Posted balance on Nov 15, as recorded now');
    expect(first.note).toBe("the balance was confirmed on this date without an adjustment, and Clarity doesn't have the time or figure of that confirmation, so it can't tell which of these transactions were recorded or changed after it");
  });

  it('a stored confirmation keeps its exact label and figure', () => {
    const { b, C } = confirmed();
    const first = today(b, C).lines[0]!;
    expect([first.label, first.cents, first.note]).toEqual(['Confirmed balance (Nov 15)', 150000, 'the posted balance you entered with Update balance']);
  });
});
