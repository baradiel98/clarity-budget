import { describe, expect, it } from 'vitest';
import { buildDashboard } from '@clarity/engine';
import type { WorkspaceData } from '@clarity/shared';
import { applyOps, archiveBalanceReview, archiveAccount, createAccount, createRecurring, defaultSettings, emptyWorkspace, engineInput, PAUSE_NOTE, setRecurringPaused, type Ctx } from '../src';

/** Phase 4A.4.4: the archive review names debts before archiving; the pause/resume rule is stated and tested. */
const TODAY = '2026-11-13';
const NOW = Date.UTC(2026, 10, 13, 12);
let seq = 0;
const ctxOf = (data: WorkspaceData, today = TODAY): Ctx => ({ data, now: NOW, today, newId: (p) => `${p}_${++seq}` });

function workspace(accounts: { name: string; type: 'checking' | 'savings' | 'cash' | 'credit_card'; bal: number }[]) {
  let data = emptyWorkspace(defaultSettings(NOW));
  const ids: Record<string, string> = {};
  for (const a of accounts) {
    const r = createAccount(ctxOf(data), { name: a.name, type: a.type, currentBalanceCents: a.bal });
    data = applyOps(data, r.ops);
    ids[a.name] = r.account.id;
  }
  return { data, ids };
}

describe('the archive review names any debt first', () => {
  it('overdrawn checking, negative savings, a card that owes money, and a positive account', () => {
    const { data, ids } = workspace([
      { name: 'Checking', type: 'checking', bal: 100000 },
      { name: 'Old checking', type: 'checking', bal: -50000 },
      { name: 'Savings', type: 'savings', bal: -10000 },
      { name: 'Visa', type: 'credit_card', bal: 100000 }, // owed, entered as a positive number
      { name: 'Spare', type: 'savings', bal: 2000 },
    ]);
    const note = (n: string) => archiveBalanceReview(data, ids[n]!, TODAY).note;
    expect(note('Old checking')).toBe("Old checking is overdrawn by $500.00. Archiving doesn't clear it: Safe to Spend keeps counting $500.00 against your spendable accounts until Old checking is back to $0.00.");
    expect(note('Savings')).toBe("Savings is at −$100.00. It isn't marked as spendable, so it isn't counted in Safe to Spend now, and archiving doesn't change that. It stays in your totals as money owed.");
    expect(note('Visa')).toBe('Visa still owes $1,000.00. Archiving doesn\'t clear it: the card stays in your totals, and the "no payment scheduled" warning stays until it\'s paid or a payment is scheduled.');
    expect(note('Spare')).toBeNull();
    // and what the note says is what happens: $1,000 − $500 before and after archiving
    const sts = (d: WorkspaceData) => buildDashboard(engineInput(d, TODAY)).safeToSpend.cents;
    expect(sts(data)).toBe(50000);
    expect(sts(applyOps(data, archiveAccount(ctxOf(data), ids['Old checking']!)))).toBe(50000);
  });
});

describe('pause and resume (the existing rule, now stated in the archive review)', () => {
  function setup() {
    const { data: d0, ids } = workspace([{ name: 'Checking', type: 'checking', bal: 100000 }, { name: 'Old', type: 'checking', bal: 0 }]);
    const rent = createRecurring(ctxOf(d0), { name: 'Rent', kind: 'bill', accountId: ids.Old!, categoryId: null, schedule: { freq: 'monthly', interval: 1, day: 1, anchor: '2026-12-01' }, amount: { type: 'fixed', cents: 80000 }, startDate: TODAY });
    return { data: applyOps(d0, rent.ops), ids, rentId: rent.item.id };
  }
  const sts = (d: WorkspaceData, today = TODAY) => buildDashboard(engineInput(d, today)).safeToSpend.cents;

  it('archive + pause, then resume the same day: the Dec 1 rent is counted again, exactly once ($200)', () => {
    const { data, ids, rentId } = setup();
    const paused = applyOps(data, archiveAccount(ctxOf(data), ids.Old!, { pause: [rentId] }));
    expect(sts(paused)).toBe(100000); // paused: not counted (the review says so)
    const resumed = applyOps(paused, setRecurringPaused(ctxOf(paused), rentId, false));
    expect(sts(resumed)).toBe(20000); // 1,000 − 800
  });

  it('resumed on Dec 3: the Dec 1 rent that fell due during the pause is skipped, not overdue (existing, intentional rule)', () => {
    const { data, ids, rentId } = setup();
    const paused = applyOps(data, archiveAccount(ctxOf(data), ids.Old!, { pause: [rentId] }));
    const resumed = applyOps(paused, setRecurringPaused(ctxOf(paused, '2026-12-03'), rentId, false));
    const d = buildDashboard(engineInput(resumed, '2026-12-03'));
    expect(d.warnings.some((w) => w.id.startsWith('overdue:'))).toBe(false);
    expect(d.upcoming.some((u) => u.label === 'Rent' && u.date === '2026-12-01')).toBe(false);
    expect(d.upcomingLater.concat(d.upcoming).some((u) => u.label === 'Rent' && u.date === '2027-01-01')).toBe(true); // the next one is back
    expect(PAUSE_NOTE).toContain('payments that fell due during the pause are not brought back');
  });
});
