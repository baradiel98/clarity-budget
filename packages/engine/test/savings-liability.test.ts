import { describe, expect, it } from 'vitest';
import { buildDashboard, canIAfford, computeSafeToSpend, type EngineInput } from '../src';
import { account, input, rec, transfer, tx } from './builders';
import type { RecurringItem } from '@clarity/shared';

/**
 * Phase 4A.5.9 (owner decision): a negative balance on an account not counted as spendable (savings) is owed and
 * reduces Safe to Spend; a positive or zero one has no effect; archived savings the same; positive archived balances
 * unchanged. Money that later arrives in the overdrawn account repays it first, so the debt is never counted twice.
 * Today Fri, Nov 13, 2026; forecast through Dec 31; reserve $0. Expected values by hand.
 */
const TODAY = '2026-11-13';
const once = (id: string, kind: RecurringItem['kind'], date: string, cents: number, extra: Partial<RecurringItem> = {}) =>
  rec({ id, name: id, kind, startDate: TODAY, trackFrom: TODAY, schedule: { freq: 'once', date }, amount: { type: 'fixed', cents }, ...extra });
const A = (id: string, name: string, type: 'checking' | 'savings' | 'cash' | 'credit_card', bal: number, extra: Record<string, unknown> = {}) =>
  account({ id, name, type, openingBalanceCents: bal, openingDate: '2026-11-01', ...extra });
const chk = A('chk', 'Checking', 'checking', 100000);
const cash = A('wal', 'Cash', 'cash', 10000);
const sav = (bal: number, extra: Record<string, unknown> = {}) => A('sav', 'Savings', 'savings', bal, extra);
const mk = (accounts: ReturnType<typeof A>[], recurring: RecurringItem[] = [], transactions: ReturnType<typeof tx>[] = []): EngineInput => input({ today: TODAY, accounts, recurring, transactions });
const sts = (i: EngineInput) => computeSafeToSpend(i).cents;
const titles = (i: EngineInput) => buildDashboard(i).warnings.map((w) => w.title);

describe('the rule', () => {
  it('owner example: Checking $1,000 + Savings −$50 + Cash $100 = $1,050', () => {
    expect(sts(mk([chk, sav(-5000), cash]))).toBe(105000);
    expect(titles(mk([chk, sav(-5000), cash]))).toContain('Savings is overdrawn by $50.00');
  });
  it('positive savings ($500) and zero savings add nothing: $1,100', () => {
    expect(sts(mk([chk, sav(50000), cash]))).toBe(110000);
    expect(sts(mk([chk, sav(0), cash]))).toBe(110000);
    expect(titles(mk([chk, sav(0), cash])).some((t) => /overdrawn/.test(t))).toBe(false);
  });
  it('archived savings: −$50 still owed ($1,050, its archived warning); +$500 archived still not spendable ($1,100)', () => {
    expect(sts(mk([chk, sav(-5000, { archived: true }), cash]))).toBe(105000);
    expect(titles(mk([chk, sav(-5000, { archived: true }), cash]))).toContain('Savings is archived and overdrawn by $50.00');
    expect(sts(mk([chk, sav(50000, { archived: true }), cash]))).toBe(110000);
  });
  it('several savings accounts: −$50, −$30, +$200 → $1,100 − $80 = $1,020', () => {
    expect(sts(mk([chk, cash, sav(-5000), A('s2', 'Holiday', 'savings', -3000), A('s3', 'Rainy day', 'savings', 20000)]))).toBe(102000);
  });
  it('a savings account marked spendable is spendable money (counted once, directly): −$50 → $1,050, no separate debt', () => {
    const i = mk([chk, sav(-5000, { spendable: true }), cash]);
    expect(sts(i)).toBe(105000);
    expect(titles(i)).not.toContain('Savings is overdrawn by $50.00');
  });
  it('a savings account in another currency is excluded: €−50 → $1,100', () => {
    expect(sts(mk([chk, cash, sav(-5000, { currency: 'EUR' })]))).toBe(110000);
  });
  it('a pending credit into overdrawn savings doesn\'t repay it until it posts: $1,050, then $1,100', () => {
    const p = tx({ id: 'p', accountId: 'sav', date: '2026-11-12', amountCents: 10000, kind: 'refund', status: 'pending', merchant: 'Refund' });
    expect(sts(mk([chk, cash, sav(-5000)], [], [p]))).toBe(105000);
    expect(sts(mk([chk, cash, sav(-5000)], [], [{ ...p, status: 'confirmed' }]))).toBe(110000); // savings +$50, not spendable
  });
});

describe('never counted twice', () => {
  it('a $100 transfer from checking into savings at −$50 (Nov 20): $50 repays the debt; $1,000, not $950', () => {
    // before Nov 20: 1,100 − 50 owed = 1,050; after: checking −100, savings +50 (no debt) → 1,000
    const i = mk([chk, cash, sav(-5000)], [once('top', 'transfer', '2026-11-20', 10000, { accountId: 'chk', toAccountId: 'sav' })]);
    expect(sts(i)).toBe(100000);
    const line = computeSafeToSpend(i).explanation.lines.find((l) => l.label === 'top')!;
    expect(line.cents).toBe(-5000);
    expect(line.note).toMatch(/\$50\.00 of it repays an overdrawn balance already counted/);
  });
  it('a recorded (past) transfer that already repaid it: savings is +$50 now, nothing owed: $1,000', () => {
    expect(sts(mk([chk, cash, sav(-5000)], [], transfer('chk', 'sav', '2026-11-10', 10000)))).toBe(100000);
  });
  it('a $100 bill paid from savings at −$50: the $50 owed plus the $100 bill, each once: $950', () => {
    expect(sts(mk([chk, cash, sav(-5000)], [once('ins', 'bill', '2026-11-20', 10000, { accountId: 'sav' })]))).toBe(95000);
  });
  it('a $300 paycheck into savings on Nov 20 repays it; a $1,000 rent on Dec 1 then leaves $100 (not $50)', () => {
    // until Nov 20: 1,050; Dec 1: 1,100 − 1,000 = 100 (the debt was repaid by the paycheck, outside money)
    expect(sts(mk([chk, cash, sav(-5000)], [once('pay', 'income', '2026-11-20', 30000, { accountId: 'sav' }), once('rent', 'bill', '2026-12-01', 100000, { accountId: 'chk' })]))).toBe(10000);
  });
  it('partial repayment: $30 from checking on Nov 20 leaves $20 owed; rent $1,000 Dec 1 → $50', () => {
    // Dec 1: checking 1,000 − 30 − 1,000 = −30, cash 100 → 70 spendable, minus $20 still owed = 50
    expect(sts(mk([chk, cash, sav(-5000)], [once('top', 'transfer', '2026-11-20', 3000, { accountId: 'chk', toAccountId: 'sav' }), once('rent', 'bill', '2026-12-01', 100000, { accountId: 'chk' })]))).toBe(5000);
  });
  it('repaid from another savings account ($30 from Holiday +$200): $20 still owed; rent Dec 1 → $80', () => {
    expect(sts(mk([chk, cash, sav(-5000), A('s2', 'Holiday', 'savings', 20000)], [once('mv', 'transfer', '2026-11-20', 3000, { accountId: 's2', toAccountId: 'sav' }), once('rent', 'bill', '2026-12-01', 100000, { accountId: 'chk' })]))).toBe(8000);
  });
  it('a transfer OUT of overdrawn savings into checking moves nothing (it holds nothing) and is flagged; the debt is counted once', () => {
    const i = mk([chk, cash, sav(-5000)], [once('mv', 'transfer', '2026-11-20', 10000, { accountId: 'sav', toAccountId: 'chk' })]);
    expect(sts(i)).toBe(105000);
    expect(buildDashboard(i).warnings.find((w) => w.id.startsWith('unfunded:'))!.detail).toContain('which is projected to have −$50.00 then');
  });
});

describe('reconciles', () => {
  it('"Why this number?", the total and affordability agree: 1,100 − 50 = 1,050; from checking: $1,000 yes, $1,050 move first (cash holds the rest), $1,050.01 no', () => {
    const i = mk([chk, sav(-5000), cash]);
    const s = computeSafeToSpend(i);
    const l = s.explanation.lines.find((x) => x.label === 'Savings overdrawn balance')!;
    expect([l.cents, l.note]).toEqual([-5000, 'a negative balance on an account not counted as spendable; still owed']);
    expect(s.explanation.lines.find((x) => x.label === 'Safe to Spend')!.cents).toBe(105000);
    expect(canIAfford(i, { amountCents: 100000, accountId: 'chk', date: TODAY }).verdict).toBe('yes');
    expect(canIAfford(i, { amountCents: 105000, accountId: 'chk', date: TODAY }).verdict).toBe('move_first');
    expect(canIAfford(i, { amountCents: 105001, accountId: 'chk', date: TODAY }).verdict).toBe('no');
    expect(buildDashboard(i).balances.totalAssetsCents).toBe(105000); // totals unchanged: 1,000 + 100 − 50
  });
});

describe('randomized: an independent day-by-day model of savings debt', () => {
  /**
   * Written from the rule, not from the engine. Checking (spendable) and Savings (not spendable, may start negative).
   * Each day: morning = transfers checking→savings (repay first), bills from checking, bills from savings (savings pays
   * what it holds, the rest comes out of checking); low point = spendable money − what savings still owes; afternoon =
   * income into savings or checking; evening = transfers savings→checking (at most what savings holds).
   * Safe to Spend = the lowest low point (today included), reserve $0.
   */
  type Ev = { date: string; kind: 'xfer_in' | 'bill_chk' | 'bill_sav' | 'inc_sav' | 'inc_chk' | 'xfer_out'; cents: number };
  function reference(chk0: number, sav0: number, evs: Ev[]) {
    let pool = chk0, sav = sav0;
    const owed = () => Math.max(0, -sav);
    let low = pool - owed();
    for (const d of [...new Set(evs.map((e) => e.date))].sort()) {
      const on = (k: Ev['kind']) => evs.filter((e) => e.date === d && e.kind === k);
      for (const e of on('xfer_in')) { pool -= e.cents; sav += e.cents; }
      for (const e of on('bill_chk')) pool -= e.cents;
      for (const e of on('bill_sav')) { const f = Math.min(e.cents, Math.max(0, sav)); sav -= f; pool -= e.cents - f; }
      low = Math.min(low, pool - owed());
      for (const e of on('inc_sav')) sav += e.cents;
      for (const e of on('inc_chk')) pool += e.cents;
      for (const e of on('xfer_out')) { const f = Math.min(e.cents, Math.max(0, sav)); sav -= f; pool += f; }
    }
    return low;
  }
  it('300 seeded scenarios equal the model', () => {
    for (let n = 0; n < 300; n++) {
      let s = (n * 2246822519 + 3) >>> 0;
      const r = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
      const chk0 = Math.floor(r() * 12) * 10000, sav0 = (Math.floor(r() * 8) - 5) * 2500;
      const evs: Ev[] = [];
      const recs: RecurringItem[] = [];
      for (let k = 0; k < Math.floor(r() * 6); k++) {
        const date = r() < 0.5 ? `2026-11-${String(14 + Math.floor(r() * 17))}` : `2026-12-${String(1 + Math.floor(r() * 31)).padStart(2, '0')}`;
        const kind = (['xfer_in', 'bill_chk', 'bill_sav', 'inc_sav', 'inc_chk', 'xfer_out'] as const)[Math.floor(r() * 6)]!;
        const cents = (1 + Math.floor(r() * 8)) * 2500;
        evs.push({ date, kind, cents });
        const id = `e${k}`;
        recs.push(
          kind === 'xfer_in' ? once(id, 'transfer', date, cents, { accountId: 'chk', toAccountId: 'sav' })
            : kind === 'xfer_out' ? once(id, 'transfer', date, cents, { accountId: 'sav', toAccountId: 'chk' })
            : kind === 'bill_chk' ? once(id, 'bill', date, cents, { accountId: 'chk' })
            : kind === 'bill_sav' ? once(id, 'bill', date, cents, { accountId: 'sav' })
            : once(id, 'income', date, cents, { accountId: kind === 'inc_sav' ? 'sav' : 'chk' }),
        );
      }
      const i = mk([A('chk', 'Checking', 'checking', chk0), sav(sav0)], recs);
      expect(sts(i), `seed ${n}: ${JSON.stringify({ chk0, sav0, evs })}`).toBe(reference(chk0, sav0, evs));
    }
  });
});
