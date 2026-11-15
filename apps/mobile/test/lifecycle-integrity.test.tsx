import { act, fireEvent, render } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { addTransaction, applyOps, buildDemoWorkspace, recordPaymentReturn, type Ctx } from '@clarity/data';
import type { WorkspaceData } from '@clarity/shared';

jest.mock('expo-crypto', () => ({ getRandomBytes: (n: number) => new Uint8Array(require('node:crypto').randomBytes(n)), digestStringAsync: async () => 'hash', CryptoDigestAlgorithm: { SHA256: 'SHA256' } }));
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

import AddScreen from '../app/add';
import Transactions from '../app/(tabs)/transactions';
import { setAddPrefill } from '../src/state/nav';
import { SAMPLE_NOW, SAMPLE_TODAY } from '../../../packages/data/test/fixtures/home-sample-nov13';

/**
 * Phase 4A.7 on mobile (audit 4A.6 M1): a card payment with a recorded return can't be deleted from the Edit screen or
 * the Transactions list; the reason is shown and nothing changes. Component tests in Node, not a simulator or device.
 */
let seq = 0;
const ctx = (): Ctx => ({ data: mockData, now: SAMPLE_NOW, today: SAMPLE_TODAY, newId: (p) => `${p}_${++seq}` });
beforeEach(() => {
  mockRun.mockImplementation(async (fn: (c: Ctx) => unknown) => {
    try { const r = fn(ctx()) as { ops?: unknown[] } | unknown[]; mockData = applyOps(mockData, (Array.isArray(r) ? r : r.ops) as never); return { ok: true }; }
    catch (e: any) { return { ok: false, errors: e.issues ?? [{ field: 'form', message: String(e) }] }; }
  });
});
function withReturnedPayment() {
  mockData = buildDemoWorkspace(SAMPLE_TODAY, SAMPLE_NOW);
  const chk = mockData.accounts.find((a) => a.name === 'Everyday Checking')!.id;
  const card = mockData.accounts.find((a) => a.name === 'Visa Card')!.id;
  const p = addTransaction(ctx(), { kind: 'transfer', accountId: chk, toAccountId: card, date: '2026-11-10', amountCents: 20000, merchant: 'Payment to Visa Card', categoryId: null, status: 'confirmed', toStatus: 'pending' });
  mockData = applyOps(mockData, p.ops);
  const out = p.txs.find((t) => t.amountCents < 0)!;
  const r = recordPaymentReturn(ctx(), { paymentLegId: out.id, accountId: chk, amountCents: 20000, date: '2026-11-12' });
  mockData = applyOps(mockData, r.ops);
  return { out, ret: r.txs[0]! };
}

describe('M1: deleting a returned card payment on mobile', () => {
  it('Edit screen: Delete shows why it can\'t be deleted (the return is named) and doesn\'t ask to confirm; nothing changes', async () => {
    const { out } = withReturnedPayment();
    const before = mockData.transactions.length;
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    setAddPrefill({ editId: out.id });
    const ui = await render(<AddScreen />);
    await act(async () => { fireEvent.press(ui.getByText('Delete')); });
    expect(ui.getByText(/This card payment can't be deleted while a return is recorded against it: “Returned payment” \(Nov 12, \$200\.00\)\. Delete the return first/)).toBeTruthy();
    expect(alert).not.toHaveBeenCalled();
    expect(mockData.transactions.length).toBe(before);
    alert.mockRestore();
  });
  it('Edit screen: the return itself can be deleted (confirm dialog), after which the payment can be deleted too', async () => {
    const { out, ret } = withReturnedPayment();
    const before = mockData.transactions.length;
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => { void buttons?.find((b) => b.text === 'Delete')?.onPress?.(); });
    setAddPrefill({ editId: ret.id });
    let ui = await render(<AddScreen />);
    await act(async () => { fireEvent.press(ui.getByText('Delete')); });
    expect(mockData.transactions.length).toBe(before - 2);
    setAddPrefill({ editId: out.id });
    ui = await render(<AddScreen />);
    await act(async () => { fireEvent.press(ui.getByText('Delete')); });
    expect(mockData.transactions.length).toBe(before - 4);
    alert.mockRestore();
  });
  it('Transactions list: a long press on the payment explains instead of offering Delete', async () => {
    withReturnedPayment();
    const before = mockData.transactions.length;
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const ui = await render(<Transactions />);
    // the checking side of the payment is listed as "To Visa Card" (long-press every such row; the alert is mocked)
    for (const row of ui.getAllByLabelText(/^To Visa Card/)) await act(async () => { fireEvent(row, 'longPress'); });
    expect(alert).toHaveBeenCalledWith("Can't delete this payment", expect.stringMatching(/while a return is recorded against it/));
    expect(mockData.transactions.length).toBe(before);
    alert.mockRestore();
  });
});
