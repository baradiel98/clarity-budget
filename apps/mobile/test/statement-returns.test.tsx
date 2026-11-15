import { act, fireEvent, render } from '@testing-library/react-native';
import { applyOps, buildDemoWorkspace, type Ctx } from '@clarity/data';
import { engineInput } from '@clarity/data';
import { computeSafeToSpend } from '@clarity/engine';
import type { WorkspaceData } from '@clarity/shared';

jest.mock('expo-crypto', () => ({ getRandomBytes: (n: number) => new Uint8Array(require('node:crypto').randomBytes(n)), digestStringAsync: async () => 'hash', CryptoDigestAlgorithm: { SHA256: 'SHA256' } }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(), notificationAsync: jest.fn(), selectionAsync: jest.fn(), ImpactFeedbackStyle: {}, NotificationFeedbackType: {} }));
jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('@react-native-community/datetimepicker', () => () => null);
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }), SafeAreaView: ({ children }: any) => children }));
jest.mock('expo-router', () => ({ router: { back: jest.fn(), push: jest.fn() }, Stack: { Screen: () => null } }));
let mockFile = '';
jest.mock('../src/platform/files', () => ({ pickTextFile: async () => ({ name: 'checking.csv', size: mockFile.length, text: mockFile }) }));
let mockData: WorkspaceData;
const mockRun = jest.fn();
jest.mock('../src/state/session', () => ({
  useData: () => mockData,
  useSession: () => ({ today: '2026-11-13', pendingRecoveryKey: null }),
  useRun: () => mockRun,
  useStore: () => ({ store: { undo: jest.fn() } }),
}));

import ImportScreen from '../app/import';
import { SAMPLE_NOW, SAMPLE_TODAY } from '../../../packages/data/test/fixtures/home-sample-nov13';

/**
 * Phase 4A.8 (N1) on mobile: the import review offers a returned card payment as the return of the payment row of the
 * same statement. Component tests in Node (the real screen, file picker mocked), not a simulator or a device. Expected
 * values: the demo's Safe to Spend is unchanged by a $200 card payment that came back (checking −200 + 200, the card
 * neither paid nor charged).
 */
let seq = 0;
const ctx = (): Ctx => ({ data: mockData, now: SAMPLE_NOW, today: SAMPLE_TODAY, newId: (p) => `${p}_${++seq}` });
const wait = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
beforeEach(() => {
  mockRun.mockImplementation(async (fn: (c: Ctx) => unknown) => {
    try { const r = fn(ctx()) as { ops?: unknown[] } | unknown[]; mockData = applyOps(mockData, (Array.isArray(r) ? r : r.ops) as never); return { ok: true }; }
    catch (e: any) { return { ok: false, errors: e.issues ?? [{ field: 'form', message: String(e) }] }; }
  });
});
const sts = () => computeSafeToSpend(engineInput(mockData, SAMPLE_TODAY)).cents;
async function toReview(csv: string) {
  mockFile = 'Date,Description,Amount,Balance\n' + csv;
  const ui = await render(<ImportScreen />);
  await act(async () => { fireEvent.press(ui.getByText('Everyday Checking')); });
  await act(async () => { fireEvent.press(ui.getByText('Choose CSV file')); });
  await wait(); await wait();
  await act(async () => { fireEvent.press(ui.getByText('Review transactions')); });
  await wait(); await wait();
  return ui;
}
const CSV = '2026-11-10,PAYMENT TO VISA,-200.00,4800.00\n2026-11-12,RETURNED PAYMENT,200.00,5000.00\n';
const PAIR = "It's the return of the card payment in row 2: Nov 10 · PAYMENT TO VISA · −$200.00";

describe('N1 on mobile: same-statement card payment and return', () => {
  it('the return is offered as the payment row\'s return; the payment row must be the card payment; importing both leaves Safe to Spend unchanged', async () => {
    mockData = buildDemoWorkspace(SAMPLE_TODAY, SAMPLE_NOW);
    const before = sts();
    const ui = await toReview(CSV);
    expect(ui.getByText('Is this the return of a card payment in this statement?')).toBeTruthy();
    // choosing the pairing while the payment row isn't selected: explained, Import disabled
    await act(async () => { fireEvent.press(ui.getByRole('checkbox', { name: PAIR })); });
    expect([ui.getByTestId('pair-problem-3').props.children].flat().join('')).toBe('To record this return, import row 2 as a transfer to your credit card (Type: Transfer, then the card).');
    // the payment row: a transfer with Visa Card already suggested; selecting it resolves the problem
    await act(async () => { fireEvent.press(ui.getByText('Payment To Visa')); });
    expect(ui.queryByTestId('pair-problem-3')).toBeNull();
    expect(ui.getByTestId('return-kind-3').props.children.join('')).toMatch(/Linked as the return of \$200\.00 of the \$200\.00 card payment in row 2 \(Nov 10\) of this statement, not imported as income\./);
    await act(async () => { fireEvent.press(ui.getByText('Import 1 transaction and record 1 returned payment')); });
    await wait();
    expect(ui.getByText('Import complete')).toBeTruthy();
    const ret = mockData.transactions.filter((t) => t.returnOf);
    expect([ret.length, sts()]).toEqual([2, before]);
  });

  it('"No, it\'s a separate transaction" imports it as a refund (the user\'s decision), with no return recorded', async () => {
    mockData = buildDemoWorkspace(SAMPLE_TODAY, SAMPLE_NOW);
    const ui = await toReview(CSV);
    await act(async () => { fireEvent.press(ui.getByText('Payment To Visa')); });
    await act(async () => { fireEvent.press(ui.getByRole('checkbox', { name: "No, it's a separate transaction. Import it as new" })); });
    await act(async () => { fireEvent.press(ui.getByText('Import 2 transactions')); });
    await wait();
    expect(ui.getByText('Import complete')).toBeTruthy();
    // (the demo schedules a full-balance card payment, so the effect on Safe to Spend isn't a simple +$200; what is
    // recorded is checked instead)
    expect([mockData.transactions.filter((t) => t.returnOf).length, mockData.transactions.filter((t) => t.provenance.source === 'import').map((t) => [t.kind, t.amountCents])]).toEqual([0, [['transfer', -20000], ['transfer', 20000], ['refund', 20000]]]);
  });
});
