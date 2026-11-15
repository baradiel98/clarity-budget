import { describe, expect, it } from 'vitest';
import { buildDashboard } from '@clarity/engine';
import { addTransaction, applyOps, catchUp, createRecurring, currentUpcoming, engineInput, linkTransactionToOccurrence, paidThisMonth, setOccurrenceException, warningsBesideCatchUp } from '../src';
import { Book } from './fixtures/settlement-harness';

/**
 * Phase 4B.4: the catch-up review lists the engine's own past-due Upcoming items, grouped by scheduled item. Nothing is
 * assumed: an item leaves the list only through the user's own Mark paid (new or linked payment), Record, or Skip, and
 * only that one occurrence. Expected values are worked out by hand from the setup.
 *
 * Accounts (Oct 1): Checking $2,000 · Savings $0 · Visa owes $400.
 * Monthly from Checking (created Oct 1): Rent $300 on the 15th · Paycheck $500 on the 20th (income) · Phone $65 on the
 * 22nd · Savings $100 on the 25th (→ Savings) · Visa payment $200 on the 27th (→ Visa). Nothing recorded since.
 */
function setup(today = '2026-11-30') {
  const b = new Book(); b.at('2026-10-01');
  const C = b.acct('Checking', 'checking', 200000);
  const S = b.acct('Savings', 'savings', 0);
  const V = b.acct('Visa', 'credit_card', 40000);
  const rec = (name: string, kind: 'bill' | 'income' | 'transfer' | 'savings', cents: number, day: number, extra: object = {}) => {
    const r = createRecurring(b.ctx(), { name, kind, accountId: C, categoryId: null, schedule: { freq: 'monthly', interval: 1, day, anchor: '2026-01-01' } as never, amount: { type: 'fixed', cents }, ...extra } as never);
    b.data = applyOps(b.data, r.ops); return r.item.id;
  };
  const ids = { rent: rec('Rent', 'bill', 30000, 15), pay: rec('Paycheck', 'income', 50000, 20), phone: rec('Phone', 'bill', 6500, 22), save: rec('Savings', 'savings', 10000, 25, { toAccountId: S }), visa: rec('Visa payment', 'transfer', 20000, 27, { toAccountId: V }) };
  b.at(today);
  return { b, C, S, V, ids };
}
const cu = (b: Book) => catchUp(buildDashboard(engineInput(b.data, b.today)));
const list = (b: Book) => cu(b).groups.map((g) => [g.name, g.items.map((u) => u.date)]);
const add = (b: Book, i: Record<string, unknown>, ref?: [string, string]) => { const r = addTransaction(b.ctx(), { categoryId: null, ...(ref ? { occurrenceRef: { recurringId: ref[0], originalDate: ref[1] } } : {}), ...i } as never); b.data = applyOps(b.data, r.ops); return r.txs; };

describe('Catch-up review (Phase 4B.4)', () => {
  it('returning after six weeks: every past-due occurrence, grouped by item, oldest first; reviewing changes nothing', () => {
    const { b } = setup();
    const before = JSON.stringify(b.data);
    const sts = b.sts();
    const c = cu(b);
    expect([c.count, c.bills, c.income, c.oldest]).toEqual([10, 8, 2, '2026-10-15']);
    expect(list(b)).toEqual([
      ['Rent', ['2026-10-15', '2026-11-15']],
      ['Paycheck', ['2026-10-20', '2026-11-20']],
      ['Phone', ['2026-10-22', '2026-11-22']],
      ['Savings', ['2026-10-25', '2026-11-25']],
      ['Visa payment', ['2026-10-27', '2026-11-27']],
    ]);
    const rent = c.groups[0]!.items[0]!;
    expect([rent.cents, rent.status, rent.isIncome]).toEqual([-30000, 'overdue', false]);
    expect(c.groups[1]!.items.every((u) => u.isIncome && u.status === 'overdue')).toBe(true);
    // Home's Upcoming no longer repeats them; the per-item warnings are left to the review
    const d = buildDashboard(engineInput(b.data, b.today));
    expect(currentUpcoming(d).some((u) => u.status === 'overdue')).toBe(false);
    expect(d.warnings.filter((w) => w.id.startsWith('overdue:'))).toHaveLength(10);
    expect(warningsBesideCatchUp(d.warnings).some((w) => w.id.startsWith('overdue:'))).toBe(false);
    expect(warningsBesideCatchUp(d.warnings)).toEqual(d.warnings.filter((w) => !w.id.startsWith('overdue:')));
    // nothing stored or calculated changed by looking
    expect(JSON.stringify(b.data)).toBe(before);
    expect(b.sts()).toBe(sts);
  });

  it('an existing, unlinked payment is not assumed to be the bill; linking it resolves only that occurrence and adds nothing', () => {
    const { b, C, ids } = setup();
    add(b, { kind: 'expense', accountId: C, date: '2026-11-23', amountCents: 6500, merchant: 'VERIZON 1123' });
    const txCount = b.data.transactions.length;
    // still listed: an unlinked $65 isn't taken as the Phone payment
    expect(list(b).find((g) => g[0] === 'Phone')).toEqual(['Phone', ['2026-10-22', '2026-11-22']]);
    const v = b.data.transactions.find((t) => t.merchant === 'VERIZON 1123')!;
    b.data = applyOps(b.data, linkTransactionToOccurrence(b.ctx(), v.id, { recurringId: ids.phone, originalDate: '2026-11-22' }));
    expect(b.data.transactions.length).toBe(txCount);
    expect(list(b).find((g) => g[0] === 'Phone')).toEqual(['Phone', ['2026-10-22']]); // October's stays
    // the next Phone bill (Dec 22) is untouched: still scheduled
    const next = currentUpcoming(buildDashboard(engineInput(b.data, b.today))).concat(buildDashboard(engineInput(b.data, b.today)).upcomingLater).find((u) => u.label === 'Phone');
    expect([next?.date, next?.status]).toEqual(['2026-12-22', 'expected']);
    expect(cu(b).count).toBe(9);
  });

  it('a pending payment resolves its occurrence and stays pending; skip resolves only the one skipped', () => {
    const { b, C, ids } = setup();
    const [t] = add(b, { kind: 'expense', accountId: C, date: '2026-11-30', amountCents: 30000, merchant: 'Rent', status: 'pending' }, [ids.rent, '2026-11-15']);
    expect(b.tx(t!.id).status).toBe('pending');
    expect(list(b).find((g) => g[0] === 'Rent')).toEqual(['Rent', ['2026-10-15']]);
    expect(paidThisMonth(b.data, b.today).entries.map((e) => [e.name, e.statusLabel])).toEqual([['Rent', 'Pending']]);
    b.data = applyOps(b.data, setOccurrenceException(b.ctx(), { recurringId: ids.rent, originalDate: '2026-10-15' }, 'skip'));
    expect(list(b).find((g) => g[0] === 'Rent')).toBeUndefined();
    // December's rent is still due on Dec 15
    const dec = buildDashboard(engineInput(b.data, b.today));
    expect([...dec.upcoming, ...dec.upcomingLater].find((u) => u.label === 'Rent')).toMatchObject({ date: '2026-12-15', status: 'expected' });
    expect(cu(b).count).toBe(8);
  });

  it('a scheduled transfer and a card payment are listed and resolved like any other item, with their existing treatment', () => {
    const { b, C, S, V, ids } = setup();
    const c = cu(b);
    const save = c.groups.find((g) => g.name === 'Savings')!.items[1]!;
    const visa = c.groups.find((g) => g.name === 'Visa payment')!.items[1]!;
    expect([save.occurrence!.kind, save.occurrence!.toAccountId, visa.occurrence!.kind, visa.occurrence!.toAccountId]).toEqual(['savings', S, 'transfer', V]);
    add(b, { kind: 'transfer', accountId: C, toAccountId: S, date: '2026-11-30', amountCents: 10000, merchant: 'Savings' }, [ids.save, '2026-11-25']);
    add(b, { kind: 'transfer', accountId: C, toAccountId: V, date: '2026-11-30', amountCents: 20000, merchant: 'Visa payment', status: 'confirmed', toStatus: 'pending' }, [ids.visa, '2026-11-27']);
    expect(list(b).filter((g) => g[0] === 'Savings' || g[0] === 'Visa payment')).toEqual([['Savings', ['2026-10-25']], ['Visa payment', ['2026-10-27']]]);
    expect(paidThisMonth(b.data, b.today).entries.map((e) => [e.name, e.statusLabel])).toEqual([['Savings', 'Posted'], ['Visa payment', 'Sent · awaiting posting by Visa']]);
  });

  it('a long absence: only the last 62 days are listed (the existing overdue window)', () => {
    const { b } = setup('2027-01-31');
    // Jan 31 − 62 days = Nov 30: the October and November occurrences have aged out
    expect([cu(b).count, cu(b).oldest]).toEqual([10, '2026-12-15']);
    expect(list(b).map((g) => g[1])).toEqual([['2026-12-15', '2027-01-15'], ['2026-12-20', '2027-01-20'], ['2026-12-22', '2027-01-22'], ['2026-12-25', '2027-01-25'], ['2026-12-27', '2027-01-27']]);
  });

  it('one past-due item; then fully resolved; and an empty workspace', () => {
    const b = new Book(); b.at('2026-11-01');
    const C = b.acct('Checking', 'checking', 100000);
    const r = createRecurring(b.ctx(), { name: 'Rent', kind: 'bill', accountId: C, categoryId: null, schedule: { freq: 'monthly', interval: 1, day: 15, anchor: '2026-01-01' } as never, amount: { type: 'fixed', cents: 30000 } });
    b.data = applyOps(b.data, r.ops);
    b.at('2026-11-16');
    expect(cu(b)).toMatchObject({ count: 1, bills: 1, income: 0, oldest: '2026-11-15' });
    expect(list(b)).toEqual([['Rent', ['2026-11-15']]]);
    add(b, { kind: 'expense', accountId: C, date: '2026-11-16', amountCents: 30000, merchant: 'Rent' }, [r.item.id, '2026-11-15']);
    expect(cu(b)).toEqual({ count: 0, bills: 0, income: 0, oldest: null, groups: [] });
    const e = new Book(); e.at('2026-11-16'); e.acct('Checking', 'checking', 100000);
    expect(cu(e)).toEqual({ count: 0, bills: 0, income: 0, oldest: null, groups: [] });
  });
});
