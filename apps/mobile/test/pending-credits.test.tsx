import { act, fireEvent, render } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { buildDemoWorkspace, engineInput } from '@clarity/data';
import { computeSafeToSpend, type Explanation } from '@clarity/engine';
import type { Transaction, WorkspaceData } from '@clarity/shared';

jest.mock('expo-crypto', () => ({ getRandomBytes: (n: number) => new Uint8Array(require('node:crypto').randomBytes(n)) }));
jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('@react-native-community/datetimepicker', () => () => null);
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }), SafeAreaView: ({ children }: any) => children }));
jest.mock('expo-router', () => ({ router: { back: jest.fn(), push: jest.fn() }, Stack: { Screen: () => null } }));
let mockCurrent: Explanation | null = null;
let mockData: WorkspaceData;
jest.mock('../src/state/nav', () => ({ takeExplain: () => mockCurrent }));
jest.mock('../src/state/session', () => ({
  useData: () => mockData,
  useSession: () => ({ today: '2026-11-13' }),
  useRun: () => async () => ({ ok: true }),
}));

import Explain from '../app/explain';
import Accounts from '../app/manage/accounts';
import { SAMPLE_NOW, SAMPLE_TODAY } from '../../../packages/data/test/fixtures/home-sample-nov13';

/**
 * Phase 4A.5.6 on mobile, the same scenario as apps/web/e2e/phase4a56.spec.ts: sample data + a $300 pending refund
 * into Everyday Checking. Safe to Spend stays $2,427.17; "Why this number?" shows the pending credit taken out;
 * Update balance shows Clarity's posted balance ($2,871.23), the hint and the pending item.
 */
function scenario(): WorkspaceData {
  const d = buildDemoWorkspace(SAMPLE_TODAY, SAMPLE_NOW);
  const chk = d.accounts.find((a) => a.name === 'Everyday Checking')!.id;
  const refund: Transaction = { id: 'pend-refund', accountId: chk, date: SAMPLE_TODAY, amountCents: 30000, kind: 'refund', merchant: 'Store return', categoryId: null, status: 'pending', createdAt: SAMPLE_NOW, updatedAt: SAMPLE_NOW } as Transaction;
  return { ...d, transactions: [...d.transactions, refund] };
}

it('"Why this number?" shows a pending credit as not yet available', async () => {
  const data = scenario();
  mockData = data;
  const sts = computeSafeToSpend(engineInput(data, SAMPLE_TODAY));
  expect(sts.cents).toBe(242717); // unchanged by the pending refund (was 272717 before Phase 4A.5.6)
  mockCurrent = sts.explanation;
  const ui = await render(<Explain />);
  expect(ui.getByText('Everyday Checking: pending credit not yet available')).toBeTruthy();
  expect(ui.getByText(/it's in your recorded balance but not counted until it clears/)).toBeTruthy();
  expect(ui.getAllByText('−$300.00').length).toBeGreaterThan(0);
});

it('Update balance shows the posted balance, what to enter, and the pending item', async () => {
  mockData = scenario();
  const spy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => { buttons?.find((b) => b.text === 'Update balance')?.onPress?.(); });
  const ui = await render(<Accounts />);
  await act(async () => { fireEvent.press(ui.getByText('Everyday Checking')); });
  expect(ui.getByTestId('update-balance-hint')).toBeTruthy();
  expect(ui.getByText(/Clarity's posted balance is \$2,871\.23/)).toBeTruthy();
  expect(ui.getByText(/Enter the posted \(cleared\) balance your bank shows right now, without pending items/)).toBeTruthy();
  expect(ui.getByTestId('update-balance-pending')).toBeTruthy();
  expect(ui.getByText(/Store return/)).toBeTruthy();
  expect(ui.getByText(/mark it posted first/)).toBeTruthy();
  spy.mockRestore();
});
