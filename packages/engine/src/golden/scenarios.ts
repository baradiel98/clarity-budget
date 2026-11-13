import type { Account, RecurringItem, Transaction } from '@clarity/shared';
import type { EngineInput } from '../plan';

/**
 * Golden scenarios. The expected outputs (expected.ts) are generated in Node and must be
 * reproduced exactly on every platform (web self-test page, mobile self-test screen).
 */
const T = 1_700_000_000_000;
const acct = (p: Partial<Account> & Pick<Account, 'id'>): Account => ({
  name: p.id, type: 'checking', currency: 'USD', openingBalanceCents: 0, openingDate: '2026-09-01',
  spendable: p.type !== 'credit_card' && p.type !== 'savings', archived: false, createdAt: T, updatedAt: T, ...p,
});
const rec = (p: Partial<RecurringItem> & Pick<RecurringItem, 'id' | 'kind' | 'schedule' | 'amount'>): RecurringItem => ({
  name: p.id, accountId: 'chk', categoryId: null, weekendRule: 'none', startDate: '2026-01-01', trackFrom: '2026-09-01', paused: false, createdAt: T, updatedAt: T, ...p,
});
const tx = (p: Partial<Transaction> & Pick<Transaction, 'id' | 'accountId' | 'date' | 'amountCents' | 'kind'>): Transaction => ({
  status: 'confirmed', merchant: 'x', categoryId: null, notes: '', provenance: { source: 'manual' }, createdAt: T, updatedAt: T, ...p,
});
const base = (p: Partial<EngineInput> & Pick<EngineInput, 'today'>): EngineInput => ({ accounts: [], transactions: [], recurring: [], exceptions: [], baseCurrency: 'USD', minReserveCents: 0, ...p });

export const GOLDEN_SCENARIOS: Record<string, EngineInput> = {
  normalMonth: base({
    today: '2026-09-03',
    minReserveCents: 10000,
    accounts: [acct({ id: 'chk', openingBalanceCents: 120000, openingDate: '2026-09-03' })],
    recurring: [
      rec({ id: 'pay', kind: 'income', schedule: { freq: 'weekly', interval: 2, anchor: '2026-09-12' }, amount: { type: 'fixed', cents: 180000 } }),
      rec({ id: 'phone', kind: 'bill', schedule: { freq: 'monthly', interval: 1, day: 12, anchor: '2026-01-12' }, amount: { type: 'fixed', cents: 6000 } }),
      rec({ id: 'power', kind: 'bill', schedule: { freq: 'monthly', interval: 1, day: 10, anchor: '2026-01-10' }, amount: { type: 'variable', cents: 9000 } }),
    ],
  }),
  shortfall: base({
    today: '2026-09-03',
    accounts: [acct({ id: 'chk', openingBalanceCents: 50000, openingDate: '2026-09-03' })],
    recurring: [
      rec({ id: 'rent', kind: 'bill', schedule: { freq: 'monthly', interval: 1, day: 5, anchor: '2026-01-05' }, amount: { type: 'fixed', cents: 100000 } }),
      rec({ id: 'pay', kind: 'income', schedule: { freq: 'monthly', interval: 1, day: 15, anchor: '2026-01-15' }, amount: { type: 'fixed', cents: 150000 } }),
    ],
  }),
  cardsAndSavings: base({
    today: '2026-02-20',
    minReserveCents: 5000,
    accounts: [
      acct({ id: 'chk', openingBalanceCents: 100000, openingDate: '2026-02-01' }),
      acct({ id: 'sav', type: 'savings', openingDate: '2026-02-01' }),
      acct({ id: 'card', type: 'credit_card', openingDate: '2026-02-01' }),
    ],
    transactions: [
      tx({ id: 't1', accountId: 'card', date: '2026-02-10', amountCents: -30000, kind: 'expense' }),
      tx({ id: 't2a', accountId: 'chk', date: '2026-02-11', amountCents: -10000, kind: 'transfer', transferGroupId: 'g' }),
      tx({ id: 't2b', accountId: 'card', date: '2026-02-11', amountCents: 10000, kind: 'transfer', transferGroupId: 'g' }),
      tx({ id: 't3', accountId: 'chk', date: '2026-02-12', amountCents: 2500, kind: 'refund' }),
    ],
    recurring: [
      rec({ id: 'paycard', kind: 'transfer', toAccountId: 'card', schedule: { freq: 'monthly', interval: 1, day: 'last', anchor: '2026-01-31' }, amount: { type: 'card_full_balance' }, trackFrom: '2026-02-20' }),
      rec({ id: 'save', kind: 'savings', toAccountId: 'sav', schedule: { freq: 'twice_monthly', day1: 15, day2: 'last' }, amount: { type: 'fixed', cents: 10000 }, trackFrom: '2026-02-20', weekendRule: 'before' }),
      rec({ id: 'pay', kind: 'income', schedule: { freq: 'monthly', interval: 1, day: 1, anchor: '2026-01-01' }, amount: { type: 'unknown' }, trackFrom: '2026-02-20' }),
    ],
  }),
};

export function goldenSummary(d: ReturnType<typeof import('../plan').buildDashboard>) {
  return {
    available: d.balances.availableCashCents,
    cardOwed: d.balances.cardOwedCents,
    monthEnd: d.monthEnd.cents,
    endOfDay: d.endOfDay.cents,
    safeToSpend: d.safeToSpend.cents,
    horizon: d.safeToSpend.horizonEnd,
    lowest: [d.lowestThroughMonthEnd.date, d.lowestThroughMonthEnd.cents],
    lowestBeforeIncome: d.lowestBeforeNextIncome ? [d.lowestBeforeNextIncome.date, d.lowestBeforeNextIncome.cents] : null,
    upcoming: d.upcoming.map((u) => [u.date, u.label, u.cents, u.status]),
    warnings: d.warnings.map((w) => w.id),
    days: d.forecast.days.map((x) => [x.date, x.lowCashCents, x.endCashCents]),
  };
}
