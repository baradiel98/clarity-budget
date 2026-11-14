import { describe, expect, it } from 'vitest';
import { accountBalance, buildDashboard, postedBalance } from '@clarity/engine';
import type { WorkspaceData } from '@clarity/shared';
import { addTransaction, adjustBalance, applyOps, createAccount, defaultSettings, emptyWorkspace, engineInput, updateTransaction, type Ctx } from '../src';

/**
 * Phase 4A.5.6 — the balance convention. A balance the user types in (opening or "Update balance") is the bank's
 * POSTED balance, without pending items. "Update balance" compares it with Clarity's posted balance, so pending items
 * are never absorbed into an adjustment, and history is never rewritten. Today Fri, Nov 13, 2026.
 */
const NOW = Date.UTC(2026, 10, 13, 12);
let seq = 0;
const ctxOf = (data: WorkspaceData, today = '2026-11-13'): Ctx => ({ data, now: NOW, today, newId: (p) => `${p}_${++seq}` });
const sts = (d: WorkspaceData, today = '2026-11-13') => buildDashboard(engineInput(d, today)).safeToSpend.cents;

function opened(balance: number) {
  let data = emptyWorkspace(defaultSettings(NOW));
  const a = createAccount(ctxOf(data), { name: 'Checking', type: 'checking', currentBalanceCents: balance });
  data = applyOps(data, a.ops);
  return { data, id: a.account.id };
}
const recordRefund = (data: WorkspaceData, accountId: string, cents: number, status: 'pending' | 'confirmed', extra: object = {}) =>
  addTransaction(ctxOf(data), { kind: 'income', accountId, date: '2026-11-13', amountCents: cents, merchant: 'Deposit', categoryId: null, status, ...extra });

describe('Update balance compares posted with posted', () => {
  it('O4: $500, record a $300 pending deposit, update to the bank\'s posted $500 → no adjustment; $500 spendable (not $200 or $800)', () => {
    const o = opened(50000);
    const id = o.id;
    let data = o.data;
    const r = recordRefund(data, id, 30000, 'pending');
    data = applyOps(data, r.ops);
    expect(sts(data)).toBe(50000);
    const adj = adjustBalance(ctxOf(data), id, 50000, 'Matched bank');
    expect(adj.tx).toBeNull(); // posted 500 already equals the bank's posted 500
    expect(sts(applyOps(data, adj.ops))).toBe(50000);
    expect(accountBalance(data.accounts[0]!, data.transactions, '2026-11-13')).toBe(80000); // recorded still shows it
  });

  it('the deposit clears: marking it posted adds it exactly once ($800); updating to the bank\'s $800 afterwards needs no adjustment', () => {
    const o = opened(50000);
    const id = o.id;
    let data = o.data;
    const r = recordRefund(data, id, 30000, 'pending');
    data = applyOps(data, r.ops);
    const upd = updateTransaction(ctxOf(data), r.txs[0]!.id, { kind: 'income', accountId: id, date: '2026-11-13', amountCents: 30000, merchant: 'Deposit', categoryId: null, status: 'confirmed' });
    data = applyOps(data, upd.ops);
    expect(sts(data)).toBe(80000);
    expect(adjustBalance(ctxOf(data), id, 80000, 'Matched bank').tx).toBeNull();
  });

  it('a pending purchase stays counted: $500 posted, $100 pending purchase → update to $500 needs nothing; $400 spendable', () => {
    const o = opened(50000);
    const id = o.id;
    let data = o.data;
    data = applyOps(data, addTransaction(ctxOf(data), { kind: 'expense', accountId: id, date: '2026-11-13', amountCents: 10000, merchant: 'Shop', categoryId: null, status: 'pending' }).ops);
    expect(adjustBalance(ctxOf(data), id, 50000, 'Matched bank').tx).toBeNull();
    expect(sts(data)).toBe(40000);
  });

  it('a real difference is one adjustment; history is kept; a pending credit entered afterwards is still not spendable', () => {
    const o = opened(50000);
    const id = o.id;
    let data = o.data;
    data = applyOps(data, addTransaction(ctxOf(data), { kind: 'expense', accountId: id, date: '2026-11-13', amountCents: 2000, merchant: 'Coffee', categoryId: null }).ops);
    const before = data.transactions.length;
    const adj = adjustBalance(ctxOf(data), id, 47000, 'Bank fee'); // posted 480 → bank 470: −10
    expect(adj.tx!.amountCents).toBe(-1000);
    data = applyOps(data, adj.ops);
    expect(data.transactions.length).toBe(before + 1); // nothing deleted or rewritten
    expect(postedBalance(data.accounts[0]!, data.transactions, '2026-11-13')).toBe(47000);
    data = applyOps(data, recordRefund(data, id, 30000, 'pending').ops);
    expect(sts(data)).toBe(47000);
  });

  it('"Already included" through the command: recorded as history, not added', () => {
    const o = opened(80000);
    const id = o.id;
    let data = o.data;
    data = applyOps(data, recordRefund(data, id, 30000, 'pending', { includedInBalance: true }).ops);
    expect(data.transactions[0]!.includedInBalance).toBe(true);
    expect(accountBalance(data.accounts[0]!, data.transactions, '2026-11-13')).toBe(80000);
    expect(sts(data)).toBe(80000);
  });
});
