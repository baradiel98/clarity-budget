import { render } from '@testing-library/react-native';
import { buildDemoWorkspace, engineInput } from '@clarity/data';
import { computeSafeToSpend, type Explanation } from '@clarity/engine';
import type { Account, WorkspaceData } from '@clarity/shared';

jest.mock('expo-crypto', () => ({ getRandomBytes: (n: number) => new Uint8Array(require('node:crypto').randomBytes(n)) }));
jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('@react-native-community/datetimepicker', () => () => null);
jest.mock('expo-router', () => ({ router: { back: jest.fn(), push: jest.fn() } }));
let mockCurrent: Explanation | null = null;
jest.mock('../src/state/nav', () => ({ takeExplain: () => mockCurrent }));
jest.mock('../src/state/session', () => ({ useData: () => ({ settings: { baseCurrency: 'USD' } }) }));

import Explain from '../app/explain';
import { SAMPLE_NOW, SAMPLE_TODAY } from '../../../packages/data/test/fixtures/home-sample-nov13';

/**
 * Phase 4A.5.2 on mobile: "Why this number?" names the card, the amount owed now, and that no payment is scheduled.
 * The same scenario as apps/web/e2e/phase4a52.spec.ts: sample data + a Store card owing $250 with no payment →
 * every day's low drops by $250: 2,427.17 − 250 = 2,177.17.
 */
it('the Safe to Spend explanation shows the card debt counted as owed now', async () => {
  const d = buildDemoWorkspace(SAMPLE_TODAY, SAMPLE_NOW);
  const card: Account = { id: 'store', name: 'Store card', type: 'credit_card', currency: 'USD', openingBalanceCents: -25000, openingDate: SAMPLE_TODAY, spendable: false, archived: false, createdAt: SAMPLE_NOW, updatedAt: SAMPLE_NOW };
  const data: WorkspaceData = { ...d, accounts: [...d.accounts, card] };
  const sts = computeSafeToSpend(engineInput(data, SAMPLE_TODAY));
  expect(sts.cents).toBe(217717);
  mockCurrent = sts.explanation;
  const ui = await render(<Explain />);
  expect(ui.getByText('Store card: owed now')).toBeTruthy();
  expect(ui.getByText(/no payment is scheduled for it, so it is counted as owed now/)).toBeTruthy();
  expect(sts.explanation.lines.find((l) => l.label === 'Store card: owed now')?.cents).toBe(-25000);
  expect(ui.getAllByText('−$250.00').length).toBeGreaterThan(0);
});
