import { render } from '@testing-library/react-native';
import { buildDemoWorkspace, engineInput } from '@clarity/data';
import { buildDashboard, type Warning } from '@clarity/engine';
import type { Account, WorkspaceData } from '@clarity/shared';

jest.mock('expo-crypto', () => ({ getRandomBytes: (n: number) => new Uint8Array(require('node:crypto').randomBytes(n)) }));
jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('@react-native-community/datetimepicker', () => () => null);

import { HomeView, type HomeActions } from '../src/features/Home';
import { WarningList } from '../src/ui/WarningList';
import { SAMPLE_NOW, SAMPLE_TODAY } from '../../../packages/data/test/fixtures/home-sample-nov13';

/** Phase 4A.4.4 on mobile: amounts in their own currency, and an archived card's debt warning on Home. */
it('warning items render each amount in its own currency (€, £, $), negative signs kept', async () => {
  const warnings: Warning[] = [{
    id: 'x', severity: 'info', title: 'Mixed', detail: 'Mixed currencies',
    items: [{ date: '2026-11-20', label: 'Euro move', cents: -50000, currency: 'EUR' }, { date: '2026-11-21', label: 'Pound refund', cents: 7000, currency: 'GBP' }, { date: '2026-11-22', label: 'Dollar bill', cents: -1234 }],
  }];
  const ui = await render(<WarningList warnings={warnings} currency="USD" />);
  expect(ui.getByText('−€500.00')).toBeTruthy();
  expect(ui.getByText('£70.00')).toBeTruthy();
  expect(ui.getByText('−$12.34')).toBeTruthy();
});

it('an archived card that still owes money keeps its warning on mobile Home (same engine text as web)', async () => {
  const d = buildDemoWorkspace(SAMPLE_TODAY, SAMPLE_NOW);
  const t = SAMPLE_NOW;
  const card: Account = { id: 'store', name: 'Store card', type: 'credit_card', currency: 'USD', openingBalanceCents: -25000, openingDate: SAMPLE_TODAY, spendable: false, archived: true, createdAt: t, updatedAt: t };
  const data: WorkspaceData = { ...d, accounts: [...d.accounts, card] };
  const w = buildDashboard(engineInput(data, SAMPLE_TODAY)).warnings.find((x) => x.id === 'card-unscheduled:store')!;
  expect(w.title).toBe('$250.00 on Store card with no payment scheduled');
  const actions: HomeActions = { explain: jest.fn(), open: jest.fn(), add: jest.fn() };
  const ui = await render(<HomeView data={data} today={SAMPLE_TODAY} backup={{ due: false, reason: null }} actions={actions} />);
  expect(ui.getByText(w.title)).toBeTruthy();
  expect(ui.getByText(w.detail)).toBeTruthy();
  expect(ui.getByTestId('safe-to-spend')).toHaveTextContent('$2,427.17');
});
