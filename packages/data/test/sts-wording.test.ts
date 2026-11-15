import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildDashboard } from '@clarity/engine';
import { createNobleProvider } from '@clarity/security/noble';
import { MemoryAdapter, WorkspaceStore, engineInput, onboard } from '../src';

/**
 * Phase 4B.1: the Safe to Spend "after the low point" sentence agrees in number with what it lists. Only the wording
 * changed; every amount below is the same as before (checked by hand).
 */
const noble = createNobleProvider((n) => new Uint8Array(randomBytes(n)));
const NOW = Date.UTC(2026, 10, 15, 15);
const TODAY = '2026-11-15'; // a Sunday

describe('Safe to Spend breakdown wording (Phase 4B.1)', () => {
  it('one bill after the low point: "comes … so it doesn\'t"; amounts unchanged', async () => {
    const { store } = await WorkspaceStore.create(new MemoryAdapter(), noble, 'correct horse battery', { withRecoveryKey: false, now: NOW });
    // the first-run case from the Phase 4B audit: $2,400 checking, $1,800 every 2 weeks from Nov 22, rent $1,200 Dec 1
    await store.apply(onboard(store.ctx(NOW, TODAY), {
      checkingBalanceCents: 240000,
      pay: { schedule: { freq: 'weekly', interval: 2, anchor: '2026-11-22' }, amountCents: 180000 },
      bill: { name: 'Rent', amountCents: 120000, date: '2026-12-01', monthly: true },
    }));
    const s = buildDashboard(engineInput(store.data, TODAY)).safeToSpend;
    // low today ($2,400, nothing before Nov 22); after it through Dec 31: paychecks Nov 22, Dec 6, Dec 20 = $5,400 in, rent $1,200 out
    expect([s.cents, s.lowPoint.date, s.horizonEnd]).toEqual([240000, TODAY, '2026-12-31']);
    expect([s.afterLow.inCents, s.afterLow.outCents]).toEqual([540000, 120000]);
    expect(s.afterLow.note).toBe("Rent ($1,200.00) comes after Nov 15, once $5,400.00 has come in. Your balance stays at or above the Nov 15 low through Dec 31, so it doesn't lower Safe to Spend.");
  });
});
