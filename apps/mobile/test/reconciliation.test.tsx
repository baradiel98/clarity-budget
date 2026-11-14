import { act, fireEvent, render } from '@testing-library/react-native';
import { adjustBalance, applyOps, buildDemoWorkspace, type Ctx } from '@clarity/data';
import type { Account, Transaction, WorkspaceData } from '@clarity/shared';

jest.mock('expo-crypto', () => ({ getRandomBytes: (n: number) => new Uint8Array(require('node:crypto').randomBytes(n)) }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(), notificationAsync: jest.fn(), selectionAsync: jest.fn(), ImpactFeedbackStyle: {}, NotificationFeedbackType: {} }));
jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('@react-native-community/datetimepicker', () => () => null);
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }), SafeAreaView: ({ children }: any) => children }));
jest.mock('expo-router', () => ({ router: { back: jest.fn(), push: jest.fn() }, Stack: { Screen: () => null } }));
let mockData: WorkspaceData;
const mockRun = jest.fn();
jest.mock('../src/state/session', () => ({
  useData: () => mockData,
  useSession: () => ({ today: '2026-11-13', pendingRecoveryKey: null }),
  useRun: () => mockRun,
  useStore: () => ({ store: { undo: jest.fn() } }),
}));

import { UpdateBalancePanel } from '../app/manage/accounts';
import Transactions from '../app/(tabs)/transactions';
import { Onboarding } from '../src/features/Onboarding';
import { SAMPLE_NOW, SAMPLE_TODAY } from '../../../packages/data/test/fixtures/home-sample-nov13';

/**
 * Phase 4A.5.8 on mobile (component tests in Node; not a simulator or a device). The same scenarios as
 * apps/web/e2e/phase4a58.spec.ts. `run` applies the command to the mocked workspace, like the real session does.
 */
let seq = 0;
const ctx = (): Ctx => ({ data: mockData, now: SAMPLE_NOW, today: SAMPLE_TODAY, newId: (p) => `${p}_${++seq}` });
beforeEach(() => {
  mockRun.mockImplementation(async (fn: (c: Ctx) => unknown) => {
    try {
      const r = fn(ctx()) as { ops?: unknown[] } | unknown[];
      mockData = applyOps(mockData, (Array.isArray(r) ? r : r.ops) as never);
      return { ok: true };
    } catch (e: any) { return { ok: false, errors: e.issues ?? [{ field: 'form', message: String(e) }] }; }
  });
});
const chkOf = (d: WorkspaceData) => d.accounts.find((a) => a.name === 'Everyday Checking')!;
function withPendingRefund(): WorkspaceData {
  const d = buildDemoWorkspace(SAMPLE_TODAY, SAMPLE_NOW);
  const refund = { id: 'pend', accountId: chkOf(d).id, date: SAMPLE_TODAY, amountCents: 30000, kind: 'refund', merchant: 'Store return', categoryId: null, notes: '', status: 'pending', provenance: { source: 'manual' }, createdAt: SAMPLE_NOW, updatedAt: SAMPLE_NOW } as Transaction;
  return { ...d, transactions: [...d.transactions, refund] };
}

it('Update balance: a difference matching a pending item is blocked; "Mark posted" then "Confirm balance" reconciles with no adjustment', async () => {
  mockData = withPendingRefund();
  const before = mockData.transactions.length;
  const ui = await render(<UpdateBalancePanel account={chkOf(mockData)} onDone={jest.fn()} />);
  expect(ui.getByText(/Clarity's posted balance is \$2,871\.23/)).toBeTruthy();
  await act(async () => { fireEvent.changeText(ui.getByTestId('update-balance-input'), '3171.23'); });
  expect(ui.getByTestId('pending-match')).toBeTruthy();
  expect(ui.getByText(/Nov 13 · Store return · Refund · pending · \+\$300\.00/)).toBeTruthy();
  expect(ui.getByRole('button', { name: 'Record adjustment' }).props.accessibilityState.disabled).toBe(true);
  await act(async () => { fireEvent.press(ui.getByText('Mark posted')); });
  expect(mockData.transactions.find((t) => t.id === 'pend')!.status).toBe('confirmed');
  await ui.rerender(<UpdateBalancePanel account={chkOf(mockData)} onDone={jest.fn()} />); // the session re-renders after a change
  expect(ui.getByTestId('balance-matches')).toBeTruthy();
  await act(async () => { fireEvent.press(ui.getByText('Confirm balance')); });
  expect(mockData.transactions.length).toBe(before); // no adjustment
  expect(chkOf(mockData).balanceConfirmedDate).toBe('2026-11-13');
});

it('Update balance on a card in credit: shown as a credit; switching to Owed $30 previews +$80 to the amount owed; a minus sign is refused', async () => {
  const d = buildDemoWorkspace(SAMPLE_TODAY, SAMPLE_NOW);
  const card: Account = { id: 'store', name: 'Store card', type: 'credit_card', currency: 'USD', openingBalanceCents: 5000, openingDate: SAMPLE_TODAY, spendable: false, archived: false, createdAt: SAMPLE_NOW, updatedAt: SAMPLE_NOW };
  mockData = { ...d, accounts: [...d.accounts, card] };
  const ui = await render(<UpdateBalancePanel account={card} onDone={jest.fn()} />);
  expect(ui.getByText(/Clarity's posted balance is \$50\.00 in credit/)).toBeTruthy();
  expect(ui.getByTestId('update-balance-input').props.value).toBe('50.00');
  expect(ui.getByText('Confirm balance')).toBeTruthy();
  await act(async () => { fireEvent.press(ui.getByText('Owed')); });
  await act(async () => { fireEvent.changeText(ui.getByTestId('update-balance-input'), '30'); });
  expect(ui.getByTestId('adjustment-preview').props.children.join('')).toBe('Adjustment: +$80.00 to the amount owed');
  await act(async () => { fireEvent.changeText(ui.getByTestId('update-balance-input'), '-30'); });
  expect(ui.getByText('Enter the amount without a sign, then choose Owed or In credit.')).toBeTruthy();
});

it('Onboarding: the keypad has no minus key, so "overdrawn" is an explicit choice and the balance shows −$100.00', async () => {
  const d = buildDemoWorkspace(SAMPLE_TODAY, SAMPLE_NOW);
  mockData = { ...d, settings: { ...d.settings, onboardingComplete: false } };
  const ui = await render(<Onboarding />);
  for (const k of ['1', '0', '0']) await act(async () => { fireEvent.press(ui.getByLabelText(k)); });
  expect(ui.getByText('$100.00')).toBeTruthy();
  await act(async () => { fireEvent.press(ui.getByText('This account is overdrawn (the balance is negative)')); });
  expect(ui.getByText('−$100.00')).toBeTruthy();
});

it('Transactions: a backdated item after a confirmed balance is labelled history-only with the reason; a normal one is not', async () => {
  let d = buildDemoWorkspace(SAMPLE_TODAY, SAMPLE_NOW);
  mockData = d;
  d = applyOps(d, adjustBalance(ctx(), chkOf(d).id, 287123, 'Matched', SAMPLE_TODAY).ops); // matches: confirms Nov 13, no transaction
  const late = { id: 'late', accountId: chkOf(d).id, date: '2026-11-10', amountCents: -2500, kind: 'expense', merchant: 'Late receipt', categoryId: null, notes: '', status: 'confirmed', includedInBalance: true, includedAsOf: '2026-11-13', provenance: { source: 'manual' }, createdAt: SAMPLE_NOW, updatedAt: SAMPLE_NOW } as Transaction;
  mockData = { ...d, transactions: [...d.transactions, late] };
  const ui = await render(<Transactions />);
  expect(ui.getByText('Already in balance · Nov 13')).toBeTruthy();
  expect(ui.getAllByTestId('history-only').map((n) => n.props.children)).toEqual(['Already included in balance as of Nov 13. Kept in history, not added again.']);
});
