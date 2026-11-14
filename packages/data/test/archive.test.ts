import { describe, expect, it } from 'vitest';
import { buildDashboard } from '@clarity/engine';
import type { WorkspaceData } from '@clarity/shared';
import { accountUsage, applyOps, archiveAccount, archiveTargets, createAccount, createRecurring, defaultSettings, describeUsage, emptyWorkspace, engineInput, type Ctx } from '../src';

/**
 * Phase 4A.4.2: archiving an account that scheduled items still use. The user decides for each item
 * (keep / move to another active account / pause); nothing changes unless chosen.
 * Today is Fri, Nov 13, 2026: Checking $1,000; "Old checking" $0 pays rent $800 on Dec 1 and receives a $2,000
 * paycheck on Nov 20; a $50 transfer Checking → Old checking on Nov 25; a Visa card with a full-balance payment from Old checking.
 */
const TODAY = '2026-11-13';
const NOW = Date.UTC(2026, 10, 13, 12);
let seq = 0;
const ctxOf = (data: WorkspaceData): Ctx => ({ data, now: NOW, today: TODAY, newId: (p) => `${p}_${++seq}` });

function setup() {
  let data = emptyWorkspace(defaultSettings(NOW));
  const step = (ops: Parameters<typeof applyOps>[1]) => { data = applyOps(data, ops); };
  const chk = createAccount(ctxOf(data), { name: 'Checking', type: 'checking', currentBalanceCents: 100000 }); step(chk.ops);
  const old = createAccount(ctxOf(data), { name: 'Old checking', type: 'checking', currentBalanceCents: 0 }); step(old.ops);
  const visa = createAccount(ctxOf(data), { name: 'Visa', type: 'credit_card', currentBalanceCents: 0 }); step(visa.ops);
  const spare = createAccount(ctxOf(data), { name: 'Spare', type: 'savings', currentBalanceCents: 0 }); step(spare.ops);
  const mk = (input: Parameters<typeof createRecurring>[1]) => { const r = createRecurring(ctxOf(data), input); step(r.ops); return r.item; };
  const rent = mk({ name: 'Rent', kind: 'bill', accountId: old.account.id, categoryId: null, schedule: { freq: 'once', date: '2026-12-01' }, amount: { type: 'fixed', cents: 80000 }, startDate: TODAY });
  const pay = mk({ name: 'Paycheck', kind: 'income', accountId: old.account.id, categoryId: null, schedule: { freq: 'once', date: '2026-11-20' }, amount: { type: 'fixed', cents: 200000 }, startDate: TODAY });
  const top = mk({ name: 'Top up', kind: 'transfer', accountId: chk.account.id, toAccountId: old.account.id, categoryId: null, schedule: { freq: 'once', date: '2026-11-25' }, amount: { type: 'fixed', cents: 5000 }, startDate: TODAY });
  const card = mk({ name: 'Visa payment', kind: 'transfer', accountId: old.account.id, toAccountId: visa.account.id, categoryId: null, schedule: { freq: 'once', date: '2026-11-28' }, amount: { type: 'card_full_balance' }, startDate: TODAY });
  return { data, ids: { chk: chk.account.id, old: old.account.id, visa: visa.account.id, spare: spare.account.id }, rent, pay, top, card };
}
const sts = (data: WorkspaceData) => buildDashboard(engineInput(data, TODAY)).safeToSpend.cents;

describe('archiving an account that scheduled items use', () => {
  it('lists every active item that uses it (paid from it, paid into it, transfers both ways) and describes each', () => {
    const { data, ids } = setup();
    const u = accountUsage(data, ids.old, TODAY);
    expect(u.recurring.map((x) => [x.item.name, x.role])).toEqual([['Rent', 'from'], ['Paycheck', 'from'], ['Top up', 'to'], ['Visa payment', 'from']]);
    expect(u.recurring.map((x) => describeUsage(x, data.accounts))).toEqual([
      'Rent: bill paid from Old checking',
      'Paycheck: income paid into Old checking',
      'Top up: transfer from Checking to Old checking',
      'Visa payment: card payment from Old checking to Visa',
    ]);
  });

  it('cancelling (not calling archiveAccount) leaves everything as it was', () => {
    const { data, ids } = setup();
    const before = JSON.stringify(data);
    accountUsage(data, ids.old, TODAY); // the review only reads
    expect(JSON.stringify(data)).toBe(before);
    expect(data.accounts.find((a) => a.id === ids.old)!.archived).toBe(false);
  });

  it('keeping everything: the account is archived, nothing else changes, and its items are still counted', () => {
    const { data, ids } = setup();
    // Before: Old checking is spendable. Combined 1,000 today; +2,000 (Nov 20) − 800 (Dec 1) → the lowest is today: 1,000.
    expect(sts(data)).toBe(100000);
    const after = applyOps(data, archiveAccount(ctxOf(data), ids.old));
    expect(after.accounts.find((a) => a.id === ids.old)!.archived).toBe(true);
    expect(after.recurring).toEqual(data.recurring); // nothing reassigned, paused or deleted
    // Archived: the $2,000 paycheck into it isn't spendable. Old checking holds 0 + 2,000 (Nov 20) + 50 (Nov 25), so it
    // pays the $800 rent itself; Checking only loses the $50 top-up: 1,000 − 50 = 950.
    expect(sts(after)).toBe(95000);
    expect(buildDashboard(engineInput(after, TODAY)).warnings.some((w) => w.id === `archived:${ids.old}`)).toBe(true);
  });

  it('moving the rent to Checking and pausing the paycheck: only those two items change', () => {
    const { data, ids, rent, pay, top, card } = setup();
    const ops = archiveAccount(ctxOf(data), ids.old, { reassign: { [rent.id]: ids.chk }, pause: [pay.id] });
    const after = applyOps(data, ops);
    const r = (id: string) => after.recurring.find((x) => x.id === id)!;
    expect(r(rent.id).accountId).toBe(ids.chk);
    expect(r(pay.id).paused).toBe(true);
    expect(r(top.id)).toEqual(top);
    expect(r(card.id)).toEqual(card);
    // Checking pays the rent: 1,000 − 50 (top up) − 800 = 150
    expect(sts(after)).toBe(15000);
  });

  it('moving the receiving side of a transfer (Top up → Spare) changes only its destination', () => {
    const { data, ids, top } = setup();
    const after = applyOps(data, archiveAccount(ctxOf(data), ids.old, { reassign: { [top.id]: ids.spare } }));
    const t = after.recurring.find((x) => x.id === top.id)!;
    expect([t.accountId, t.toAccountId]).toEqual([ids.chk, ids.spare]);
  });

  it('only valid targets are offered; an invalid choice is refused and nothing is applied', () => {
    const { data, ids, rent, card } = setup();
    const u = accountUsage(data, ids.old, TODAY);
    const rentUse = u.recurring.find((x) => x.item.id === rent.id)!;
    expect(archiveTargets(rentUse, data.accounts, ids.old).map((a) => a.name)).toEqual(['Checking', 'Visa', 'Spare']);
    const cardUse = u.recurring.find((x) => x.item.id === card.id)!;
    expect(archiveTargets(cardUse, data.accounts, ids.old).map((a) => a.name)).toEqual(['Checking', 'Spare']); // never the card itself or the archived account
    expect(() => archiveAccount(ctxOf(data), ids.old, { reassign: { [rent.id]: ids.old } })).toThrow(/active account/);
    expect(() => archiveAccount(ctxOf(data), ids.old, { reassign: { [rent.id]: ids.chk }, pause: [rent.id] })).toThrow(/either/);
  });

  it('an account nothing uses is archived directly (one change, nothing else)', () => {
    const { data, ids } = setup();
    expect(accountUsage(data, ids.spare, TODAY)).toEqual({ recurring: [], planned: [] });
    const ops = archiveAccount(ctxOf(data), ids.spare);
    expect(ops).toHaveLength(1);
    expect(applyOps(data, ops).accounts.find((a) => a.id === ids.spare)!.archived).toBe(true);
  });
});
