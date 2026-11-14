import { describe, expect, it } from 'vitest';
import { accountBalance, balanceAsOfDate, buildDashboard, canIAfford, computeSafeToSpend, pendingCreditTotal, periodTotals, postedBalance, type EngineInput } from '../src';
import { account, input, rec, transfer, tx } from './builders';
import type { RecurringItem } from '@clarity/shared';

/**
 * Phase 4A.5.6 — pending credits and the starting balance (audit 4A.5.5). Expected values are worked out by hand.
 * Rule: a pending credit (refund, cashback, income; not a transfer between own accounts) stays in the recorded
 * balance but is not available to spend until it is marked posted: it can't fund bills or transfers or hide a debt.
 * Pending debits stay counted. Today Fri, Nov 13, 2026; horizon Dec 31 unless stated.
 */
const TODAY = '2026-11-13';
const since = (d: string) => ({ startDate: d, trackFrom: d });
const once = (id: string, kind: RecurringItem['kind'], date: string, cents: number, extra: Partial<RecurringItem> = {}) =>
  rec({ id, name: id, kind, ...since(date), schedule: { freq: 'once', date }, amount: { type: 'fixed', cents }, ...extra });
const A = (id: string, name: string, type: 'checking' | 'savings' | 'cash' | 'credit_card', bal: number, extra: Record<string, unknown> = {}) =>
  account({ id, name, type, openingBalanceCents: bal, openingDate: '2026-11-01', ...extra });
const chk = (b: number, extra: Record<string, unknown> = {}) => A('chk', 'Checking', 'checking', b, extra);
const pend = (acct: string, date: string, cents: number, extra: Record<string, unknown> = {}) =>
  tx({ accountId: acct, date, amountCents: cents, kind: 'refund', status: 'pending', merchant: 'Refund', id: `pd-${acct}-${date}-${cents}`, ...extra });
const posted = (acct: string, date: string, cents: number, extra: Record<string, unknown> = {}) =>
  tx({ accountId: acct, date, amountCents: cents, kind: 'refund', merchant: 'Refund', id: `po-${acct}-${date}-${cents}`, ...extra });
const mk = (accounts: ReturnType<typeof A>[], recurring: RecurringItem[] = [], transactions: ReturnType<typeof tx>[] = []) => input({ today: TODAY, accounts, recurring, transactions });
const sts = (i: EngineInput) => computeSafeToSpend(i).cents;
const warns = (i: EngineInput) => buildDashboard(i).warnings;

describe('Phase 4A.5.5 audit cases ($500 checking unless stated)', () => {
  it('$300 pending refund → $500 (was $800); the recorded balance still shows $800', () => {
    const i = mk([chk(50000)], [], [pend('chk', '2026-11-12', 30000)]);
    expect(sts(i)).toBe(50000);
    expect(buildDashboard(i).balances.availableCashCents).toBe(80000); // recorded balance unchanged
  });
  it('the same refund posted → $800', () => expect(sts(mk([chk(50000)], [], [posted('chk', '2026-11-12', 30000)]))).toBe(80000));
  it('pending $300, rent $1,000 Dec 1, paycheck $1,000 Dec 4 → −$500 (was −$200)', () => {
    expect(sts(mk([chk(50000)], [once('rent', 'bill', '2026-12-01', 100000), once('pay', 'income', '2026-12-04', 100000)], [pend('chk', '2026-11-12', 30000)]))).toBe(-50000);
  });
  it('pending $300, paycheck Nov 20 before rent Dec 1 → $500 (today is the low)', () => {
    expect(sts(mk([chk(50000)], [once('pay', 'income', '2026-11-20', 100000), once('rent', 'bill', '2026-12-01', 100000)], [pend('chk', '2026-11-12', 30000)]))).toBe(50000);
  });
  it('pending $300, bill $700 Nov 20 → −$200 (was $100)', () => expect(sts(mk([chk(50000)], [once('b', 'bill', '2026-11-20', 70000)], [pend('chk', '2026-11-12', 30000)]))).toBe(-20000));
  it('two pending refunds $100 + $200 → $500', () => expect(sts(mk([chk(50000)], [], [pend('chk', '2026-11-10', 10000), pend('chk', '2026-11-12', 20000)]))).toBe(50000));
  it('pending $300 cashback (income) → $500', () => expect(sts(mk([chk(50000)], [], [pend('chk', '2026-11-12', 30000, { kind: 'income' })]))).toBe(50000));
  it('pending $300 into empty savings can\'t fund a savings → checking transfer; rent $600 → −$100 (was $200)', () => {
    const i = mk([chk(50000), A('sav', 'Savings', 'savings', 0)], [once('m', 'transfer', '2026-11-20', 30000, { accountId: 'sav', toAccountId: 'chk', name: 'Top up' }), once('rent', 'bill', '2026-12-01', 60000)], [pend('sav', '2026-11-12', 30000)]);
    expect(sts(i)).toBe(-10000);
    expect(warns(i).find((w) => w.id.startsWith('unfunded:'))!.title).toBe("Top up: Savings won't have the money");
  });
  it('pending $300 into empty savings can\'t pay a $300 savings bill → $200 (was $500)', () => {
    expect(sts(mk([chk(50000), A('sav', 'Savings', 'savings', 0)], [once('b', 'bill', '2026-11-20', 30000, { accountId: 'sav' })], [pend('sav', '2026-11-12', 30000)]))).toBe(20000);
  });
  it('pending $300 into an archived account overdrawn by $100 doesn\'t hide the debt → $400 (was $500)', () => {
    const i = mk([chk(50000), A('old', 'Old checking', 'checking', -10000, { archived: true })], [], [pend('old', '2026-11-12', 30000)]);
    expect(sts(i)).toBe(40000);
    expect(warns(i).find((w) => w.id === 'archived-overdrawn:old')!.title).toBe('Old checking is archived and overdrawn by $100.00');
  });
  it('pending €300 into a EUR account doesn\'t change USD Safe to Spend ($500)', () => {
    expect(sts(mk([chk(50000), A('eur', 'Euro', 'checking', 0, { currency: 'EUR' })], [], [pend('eur', '2026-11-12', 30000)]))).toBe(50000);
  });
  it('a $0 cash wallet with a pending $200 refund paying a $200 bill → $300, and the wallet shortfall is flagged (was $500, no warning)', () => {
    const i = mk([chk(50000), A('wal', 'Wallet', 'cash', 0)], [once('b', 'bill', '2026-11-20', 20000, { accountId: 'wal', name: 'Bill' })], [pend('wal', '2026-11-12', 20000)]);
    expect(sts(i)).toBe(30000);
    expect(warns(i).find((w) => w.id === 'account-short:wal')!.title).toBe('Wallet would go to −$200.00 on Nov 20');
  });
  it('a future-dated pending refund (Dec 10) doesn\'t count: rent $600 Dec 15 → −$100 (was $200)', () => {
    const i = mk([chk(50000)], [once('rent', 'bill', '2026-12-15', 60000)], [pend('chk', '2026-12-10', 30000)]);
    expect(sts(i)).toBe(-10000);
    expect(computeSafeToSpend(i).explanation.lines.find((l) => l.label === 'Refund')).toMatchObject({ kind: 'excluded', note: 'pending, not counted until it clears' });
  });
  it('a pending card refund keeps the Phase 4A.5.4 behaviour: card owes $400, $200 pending → $100', () => {
    expect(sts(mk([chk(50000), A('visa', 'Visa', 'credit_card', -40000)], [], [pend('visa', TODAY, 20000)]))).toBe(10000);
  });
});

describe('pending credit lifecycle', () => {
  const base = (t: ReturnType<typeof tx>[]) => mk([chk(50000)], [], t);
  it('entered, edited ($500), re-dated (Nov 5), deleted: $500 every time', () => {
    expect([sts(base([pend('chk', '2026-11-12', 30000)])), sts(base([pend('chk', '2026-11-12', 50000)])), sts(base([pend('chk', '2026-11-05', 30000)])), sts(base([]))]).toEqual([50000, 50000, 50000, 50000]);
  });
  it('marked posted: +$300 exactly once → $800; later corrected to $250 → $750', () => {
    expect(sts(base([posted('chk', '2026-11-12', 30000)]))).toBe(80000);
    expect(sts(base([posted('chk', '2026-11-12', 25000)]))).toBe(75000);
  });
  it('several in one account: pending $100 + pending $200 + posted $50 → $550', () => {
    expect(sts(base([pend('chk', '2026-11-10', 10000), pend('chk', '2026-11-12', 20000), posted('chk', '2026-11-11', 5000)]))).toBe(55000);
  });
  it('pending debits stay counted: pending −$100 purchase → $400', () => {
    expect(sts(base([tx({ accountId: 'chk', date: '2026-11-12', amountCents: -10000, status: 'pending', merchant: 'Shop', id: 'pdb' })]))).toBe(40000);
  });
  it('with a scheduled $400 transfer to savings: 500 − 400 = $100 (the pending $300 doesn\'t fund it)', () => {
    expect(sts(mk([chk(50000), A('sav', 'Savings', 'savings', 0)], [once('m', 'transfer', '2026-11-20', 40000, { accountId: 'chk', toAccountId: 'sav' })], [pend('chk', '2026-11-12', 30000)]))).toBe(10000);
  });
  it('a pending transfer between own accounts is not a pending credit (both legs counted) → $800', () => {
    expect(sts(mk([chk(50000), A('sav', 'Savings', 'savings', 30000)], [], transfer('sav', 'chk', '2026-11-12', 30000, { status: 'pending' })))).toBe(80000);
  });
  it('a pending credit on an archived (positive) account: never spendable, nothing changes → $500', () => {
    expect(sts(mk([chk(50000), A('old', 'Old', 'checking', 10000, { archived: true })], [], [pend('old', '2026-11-12', 30000)]))).toBe(50000);
  });
});

describe('starting balance: "Already included" and the opening day', () => {
  const opened = (bal: number, t: ReturnType<typeof tx>[]) => mk([chk(bal, { openingDate: TODAY })], [], t);
  it('O1 (Phase 4A.5.8): a pending item can\'t be "already included" in a posted balance; a flag that bypassed the data layer is ignored, so the deposit stays pending: $800 spendable, never $1,100', () => {
    // Before Phase 4A.5.8 the flag hid the pending deposit (recorded $800, and a pending credit counted as spendable).
    const i = opened(80000, [pend('chk', TODAY, 30000, { includedInBalance: true })]);
    expect(sts(i)).toBe(80000);
    expect(accountBalance(i.accounts[0]!, i.transactions, TODAY)).toBe(110000);
    expect(pendingCreditTotal(i.accounts[0]!, i.transactions, TODAY)).toBe(30000);
  });
  it('O1 without the box: the pending deposit is still not spendable ($800), though the recorded balance shows it ($1,100)', () => {
    const i = opened(80000, [pend('chk', TODAY, 30000)]);
    expect(sts(i)).toBe(80000);
    expect(accountBalance(i.accounts[0]!, i.transactions, TODAY)).toBe(110000);
  });
  it('O2: a transaction dated before the opening date is history only → $800', () => {
    expect(sts(opened(80000, [posted('chk', '2026-11-12', 30000)]))).toBe(80000);
  });
  it('O3: a confirmed $50 purchase on the opening date is counted once: added → $750; marked already included → $800', () => {
    const lunch = (extra: Record<string, unknown> = {}) => tx({ accountId: 'chk', date: TODAY, amountCents: -5000, merchant: 'Lunch', id: 'l', ...extra });
    expect(sts(opened(80000, [lunch()]))).toBe(75000);
    expect(sts(opened(80000, [lunch({ includedInBalance: true })]))).toBe(80000);
  });
  it('an "already included" transaction stays in history and still counts as spending in reports', () => {
    const t = [tx({ accountId: 'chk', date: TODAY, amountCents: -5000, merchant: 'Lunch', id: 'l', includedInBalance: true, categoryId: 'cat_food' })];
    expect(periodTotals(t, '2026-11-01', '2026-11-30').spendingCents).toBe(5000);
  });
  it('balance date: the opening date, or the latest "Update balance" adjustment', () => {
    const a = chk(50000);
    expect(balanceAsOfDate(a, [])).toBe('2026-11-01');
    expect(balanceAsOfDate(a, [tx({ accountId: 'chk', date: '2026-11-10', amountCents: 100, kind: 'adjustment', merchant: 'Balance adjustment', id: 'adj' })])).toBe('2026-11-10');
  });
  it('posted balance = recorded balance without pending items; pending credits listed separately', () => {
    const a = chk(50000);
    const t = [pend('chk', '2026-11-12', 30000), tx({ accountId: 'chk', date: '2026-11-12', amountCents: -10000, status: 'pending', merchant: 'Shop', id: 'pdb' })];
    expect([accountBalance(a, t, TODAY), postedBalance(a, t, TODAY), pendingCreditTotal(a, t, TODAY)]).toEqual([70000, 50000, 30000]);
  });
});

describe('explanations, affordability and the account balance explanation', () => {
  const i = mk([chk(50000)], [once('b', 'bill', '2026-11-20', 10000, { name: 'Phone' })], [pend('chk', '2026-11-12', 30000)]);
  it('"Why this number?" shows the recorded balance and the pending credit held back, and adds up exactly', () => {
    const s = computeSafeToSpend(i);
    const l = s.explanation.lines;
    expect(l[0]).toMatchObject({ kind: 'start', cents: 80000 });
    expect(l.find((x) => x.label === 'Checking: pending credit not yet available')).toMatchObject({ kind: 'out', cents: -30000, note: "pending; it's in your recorded balance but not counted until it clears" });
    const counted = l.filter((x) => (x.kind === 'start' || x.kind === 'in' || x.kind === 'out') && !(x.note ?? '').includes('after the lowest point'));
    expect(counted.reduce((a, x) => a + (x.cents ?? 0), 0)).toBe(s.lowPoint.cents); // 800 − 300 − 100 = 400
    expect(s.cents).toBe(40000);
  });
  it('the month-end projection and the account balance explanation say the same', () => {
    const d = buildDashboard(i);
    expect(d.monthEnd.explanation.lines.find((x) => x.label === 'Checking: pending credit not yet available')?.cents).toBe(-30000);
    expect(d.monthEnd.cents).toBe(40000); // 800 recorded − 300 pending − 100
    expect(d.recordedBalanceExplanation.lines.find((x) => x.label === 'Checking')!.note).toBe("includes $300.00 of pending credits, which aren't available to spend until they clear (not counted in Safe to Spend)");
  });
  it('"Can I afford this?" uses the same rule: $450 → No (400 − 450), not Yes', () => {
    expect(canIAfford(i, { amountCents: 45000, accountId: 'chk', date: TODAY }).verdict).toBe('no');
    expect(canIAfford(i, { amountCents: 40000, accountId: 'chk', date: TODAY }).verdict).toBe('yes');
  });
});

describe('randomized: a pending credit never changes Safe to Spend; a posted one never lowers it', () => {
  it('300 seeded scenarios across checking, savings, cash, archived and a card', () => {
    const rng = (seed: number) => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; };
    let checked = 0;
    for (let n = 0; n < 300; n++) {
      const r = rng(n + 101);
      const accts = [chk(Math.floor(r() * 8) * 10000), A('sav', 'Savings', 'savings', Math.floor(r() * 4) * 10000), A('wal', 'Wallet', 'cash', Math.floor(r() * 3) * 10000),
        A('old', 'Old', 'checking', (Math.floor(r() * 5) - 2) * 10000, { archived: true }), A('visa', 'Visa', 'credit_card', -Math.floor(r() * 6) * 10000)];
      const ids = accts.map((a) => a.id);
      const day = () => `2026-${r() < 0.5 ? '11' : '12'}-${String(r() < 0.5 ? 14 + Math.floor(r() * 16) : 1 + Math.floor(r() * 28)).padStart(2, '0')}`;
      const recs: RecurringItem[] = [];
      for (let k = 0; k < 1 + Math.floor(r() * 5); k++) {
        const kind = (['bill', 'income', 'transfer'] as const)[Math.floor(r() * 3)]!;
        const from = ids[Math.floor(r() * ids.length)]!;
        const to = ids.filter((x) => x !== from)[Math.floor(r() * (ids.length - 1))]!;
        recs.push(kind === 'transfer' ? once(`r${k}`, 'transfer', day(), (1 + Math.floor(r() * 6)) * 5000, { accountId: from, toAccountId: to }) : once(`r${k}`, kind, day(), (1 + Math.floor(r() * 6)) * 5000, { accountId: from }));
      }
      const target = ids[Math.floor(r() * ids.length)]!;
      const amt = (1 + Math.floor(r() * 6)) * 5000;
      const without = sts(mk(accts, recs));
      expect(sts(mk(accts, recs, [pend(target, '2026-11-12', amt)]))).toBe(without);
      expect(sts(mk(accts, recs, [pend(target, '2026-12-05', amt)]))).toBe(without); // future-dated pending too
      expect(sts(mk(accts, recs, [posted(target, '2026-11-12', amt)]))).toBeGreaterThanOrEqual(without);
      checked++;
    }
    expect(checked).toBe(300);
  });
});

describe('randomized reference comparison (independent model, one checking account)', () => {
  /**
   * Written from the rule, not from the engine: one spendable checking account, one-off bills and paychecks between
   * Nov 14 and Dec 31. Each day bills leave first (morning), then income arrives (afternoon). Safe to Spend = the
   * lowest of today's balance and every morning balance. A pending credit is simply not in the starting money; a
   * posted credit dated before today is. Pending debits stay counted.
   */
  function reference(start: number, items: { date: string; cents: number }[], pendingCredits: number, pendingDebits: number, postedCredits: number) {
    let bal = start - pendingDebits + postedCredits; // pendingCredits deliberately ignored
    void pendingCredits;
    let low = bal;
    const dates = [...new Set(items.map((x) => x.date))].sort();
    for (const d of dates) {
      bal += items.filter((x) => x.date === d && x.cents < 0).reduce((s, x) => s + x.cents, 0);
      low = Math.min(low, bal);
      bal += items.filter((x) => x.date === d && x.cents > 0).reduce((s, x) => s + x.cents, 0);
    }
    return low;
  }
  it('200 seeded scenarios: the engine equals the reference', () => {
    const rng = (seed: number) => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; };
    for (let n = 0; n < 200; n++) {
      const r = rng(n + 9001);
      const start = Math.floor(r() * 10) * 10000;
      const items: { date: string; cents: number }[] = [];
      const recs: RecurringItem[] = [];
      for (let k = 0; k < Math.floor(r() * 6); k++) {
        // strictly after today (a past one-off that was never recorded isn't counted, a separate documented rule)
        const date = r() < 0.5 ? `2026-11-${String(14 + Math.floor(r() * 17))}` : `2026-12-${String(1 + Math.floor(r() * 31)).padStart(2, '0')}`;
        const cents = (1 + Math.floor(r() * 8)) * 5000;
        const bill = r() < 0.6;
        items.push({ date, cents: bill ? -cents : cents });
        recs.push(once(`r${k}`, bill ? 'bill' : 'income', date, cents, { accountId: 'chk' }));
      }
      const pc = r() < 0.7 ? (1 + Math.floor(r() * 6)) * 5000 : 0;
      const pdb = r() < 0.4 ? (1 + Math.floor(r() * 4)) * 2500 : 0;
      const poc = r() < 0.4 ? (1 + Math.floor(r() * 4)) * 5000 : 0;
      const txs = [
        ...(pc ? [pend('chk', '2026-11-12', pc)] : []),
        ...(pdb ? [tx({ accountId: 'chk', date: '2026-11-11', amountCents: -pdb, status: 'pending', merchant: 'Shop', id: `pdb${n}` })] : []),
        ...(poc ? [posted('chk', '2026-11-10', poc)] : []),
      ];
      expect(sts(mk([chk(start)], recs, txs)), `seed ${n}`).toBe(reference(start, items, pc, pdb, poc));
    }
  });
});
