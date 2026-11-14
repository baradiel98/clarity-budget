import { render } from '@testing-library/react-native';
import { buildDemoWorkspace } from '@clarity/data';
import type { WorkspaceData } from '@clarity/shared';

jest.mock('expo-crypto', () => ({ getRandomBytes: (n: number) => new Uint8Array(require('node:crypto').randomBytes(n)) }));
jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('@react-native-community/datetimepicker', () => () => null);

import { HomeView, type HomeActions } from '../src/features/Home';
import { SAMPLE_NOW, SAMPLE_TODAY } from '../../../packages/data/test/fixtures/home-sample-nov13';

/**
 * Phase 4A.4 F1 on mobile, the same scenario as apps/web/e2e/phase4a4.spec.ts: sample data (Safe to Spend $2,427.17)
 * plus an empty savings account paying a $500 bill today. Savings can't pay it, so the $500 has to come from the
 * spendable accounts: every day's low drops by $500 → $2,427.17 − $500.00 = $1,927.17.
 */
function withSavingsBill(): WorkspaceData {
  const d = buildDemoWorkspace(SAMPLE_TODAY, SAMPLE_NOW);
  const t = SAMPLE_NOW;
  return {
    ...d,
    accounts: [...d.accounts, { id: 'fund', name: 'College fund', type: 'savings', currency: 'USD', openingBalanceCents: 0, openingDate: SAMPLE_TODAY, spendable: false, archived: false, createdAt: t, updatedAt: t }],
    recurring: [...d.recurring, { id: 'tuition', name: 'Tuition', kind: 'bill', accountId: 'fund', categoryId: null, schedule: { freq: 'once', date: SAMPLE_TODAY }, amount: { type: 'fixed', cents: 50000 }, weekendRule: 'none', startDate: SAMPLE_TODAY, trackFrom: SAMPLE_TODAY, paused: false, createdAt: t, updatedAt: t }],
  };
}

it('a bill paid from an empty savings account lowers Safe to Spend and is explained (same result as web)', async () => {
  const actions: HomeActions = { explain: jest.fn(), open: jest.fn(), add: jest.fn() };
  const ui = await render(<HomeView data={withSavingsBill()} today={SAMPLE_TODAY} backup={{ due: false, reason: null }} actions={actions} />);
  expect(ui.getByTestId('safe-to-spend')).toHaveTextContent('$1,927.17');
  expect(ui.getByText("Tuition: College fund can't cover it")).toBeTruthy();
  expect(ui.getByText(/Safe to Spend counts the other \$500\.00 against your spendable accounts/)).toBeTruthy();
});
