import { act, fireEvent, render, within } from '@testing-library/react-native';
import { addTransaction, applyOps, buildDemoWorkspace, engineInput, type Ctx } from '@clarity/data';
import { computeSafeToSpend } from '@clarity/engine';
import type { WorkspaceData } from '@clarity/shared';

jest.mock('expo-crypto', () => ({ getRandomBytes: (n: number) => new Uint8Array(require('node:crypto').randomBytes(n)) }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(), notificationAsync: jest.fn(), selectionAsync: jest.fn(), ImpactFeedbackStyle: {}, NotificationFeedbackType: {} }));
jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('@react-native-community/datetimepicker', () => () => null);
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }), SafeAreaView: ({ children }: any) => children }));
jest.mock('expo-router', () => ({ router: { back: jest.fn(), push: jest.fn() }, Stack: { Screen: () => null } }));
let mockData: WorkspaceData;
let mockToday = '2026-11-13';
jest.mock('../src/state/session', () => ({
  useData: () => mockData,
  useSession: () => ({ today: mockToday, pendingRecoveryKey: null }),
  useRun: () => jest.fn(),
  useStore: () => ({ store: { undo: jest.fn() } }),
}));

import { router } from 'expo-router';
import Planning from '../app/(tabs)/planning';
import { takeAddPrefill } from '../src/state/nav';
import { SAMPLE_NOW, SAMPLE_TODAY } from '../../../packages/data/test/fixtures/home-sample-nov13';

/**
 * Phase 4B.3 on mobile (component tests in Node; not a simulator or a device). The sample links three November
 * transactions to their scheduled items: Rent (Nov 1), Paycheck (Nov 5), Streaming (Nov 9, Visa Card).
 */
let seq = 0;
const ctx = (): Ctx => ({ data: mockData, now: SAMPLE_NOW, today: SAMPLE_TODAY, newId: (p) => `${p}_${++seq}` });

describe('Planning · Paid this month (mobile)', () => {
  beforeEach(() => { mockData = buildDemoWorkspace(SAMPLE_TODAY, SAMPLE_NOW); mockToday = SAMPLE_TODAY; });

  it('collapsed by default; expands; each row says what, when, how much, where and its status; a pending payment says pending', async () => {
    // Phone ($65, due Nov 22) paid today and still pending
    const phone = mockData.recurring.find((r) => r.name === 'Phone')!;
    const chk = mockData.accounts.find((a) => a.name === 'Everyday Checking')!.id;
    mockData = applyOps(mockData, addTransaction(ctx(), { kind: 'expense', accountId: chk, date: SAMPLE_TODAY, amountCents: 6500, merchant: 'Phone', categoryId: null, status: 'pending', occurrenceRef: { recurringId: phone.id, originalDate: '2026-11-22' } }).ops);
    const sts = computeSafeToSpend(engineInput(mockData, SAMPLE_TODAY)).cents;
    const ui = await render(<Planning />);
    const toggle = ui.getByTestId('paid-toggle');
    expect(toggle.props.accessibilityState).toMatchObject({ expanded: false });
    expect(ui.getByTestId('paid-count')).toHaveTextContent('4 items');
    expect(ui.queryAllByTestId('paid-row')).toHaveLength(0);
    await act(async () => { fireEvent.press(toggle); });
    expect(ui.getByTestId('paid-toggle').props.accessibilityState).toMatchObject({ expanded: true });
    const rows = ui.getAllByTestId('paid-row');
    expect(rows.map((r) => r.props.accessibilityLabel)).toEqual([
      'Rent. Paid Nov 1. −$1,450.00, Everyday Checking. Posted. Opens the transaction.',
      'Paycheck. Received Nov 5. +$1,860.00, Everyday Checking. Posted. Opens the transaction.',
      'Streaming. Paid Nov 9. −$15.49, Visa Card. Posted. Opens the transaction.',
      'Phone. Paid Nov 13, due Nov 22. −$65.00, Everyday Checking. Pending. Opens the transaction.',
    ]);
    expect(within(rows[3]!).getByTestId('paid-status')).toHaveTextContent('Pending');
    // opening a row opens its transaction in the normal Edit screen
    const tx = mockData.transactions.find((t) => t.occurrenceRef?.recurringId === phone.id && t.occurrenceRef.originalDate === '2026-11-22')!;
    await act(async () => { fireEvent.press(rows[3]!); });
    expect(takeAddPrefill()).toEqual({ editId: tx.id });
    expect(router.push).toHaveBeenCalledWith('/add');
    // collapses again; nothing was recalculated or changed
    await act(async () => { fireEvent.press(ui.getByTestId('paid-toggle')); });
    expect(ui.queryAllByTestId('paid-row')).toHaveLength(0);
    expect(computeSafeToSpend(engineInput(mockData, SAMPLE_TODAY)).cents).toBe(sts);
  });

  it('a month with nothing recorded as paid says so', async () => {
    mockToday = '2026-12-02';
    const ui = await render(<Planning />);
    expect(ui.getByTestId('paid-count')).toHaveTextContent('None yet');
    await act(async () => { fireEvent.press(ui.getByTestId('paid-toggle')); });
    expect(ui.getByTestId('paid-empty')).toHaveTextContent('Nothing scheduled has been recorded as paid in December yet. When you use Mark paid (or link a payment), it appears here.');
  });
});
