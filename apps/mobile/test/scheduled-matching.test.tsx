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
import AddScreen from '../app/add';
import { setAddPrefill } from '../src/state/nav';
import { SAMPLE_NOW, SAMPLE_TODAY } from '../../../packages/data/test/fixtures/home-sample-nov13';

/**
 * Phase 4A.9 on mobile: scheduled-item suggestions. Component tests in Node (the real screens), not a simulator or a
 * device. The sample schedules Electricity (variable, estimated $91.40, due Nov 18) from Everyday Checking.
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

describe('Phase 4A.9 on mobile: scheduled-item suggestions', () => {
  it('amount and date only ("ONLINE PMT 7781 −$100"): "Pays Electricity?" unticked with the reason; imported without the link → Safe to Spend −$100', async () => {
    mockData = buildDemoWorkspace(SAMPLE_TODAY, SAMPLE_NOW);
    const before = sts();
    const ui = await toReview('2026-11-12,ONLINE PMT 7781,-100.00,2771.23\n');
    expect(ui.getByRole('checkbox', { name: 'Pays Electricity?' }).props.accessibilityState.checked).toBe(false);
    expect([ui.getByTestId('occurrence-weak-2').props.children].flat().join('')).toBe('Could be Electricity (due Nov 18): only the amount and date are close. Not linked unless you tick it.');
    await act(async () => { fireEvent.press(ui.getByText('Import 1 transaction')); });
    await wait();
    expect(ui.getByText('Import complete')).toBeTruthy();
    // Checking −100; Electricity still due
    expect([sts() - before, mockData.transactions.filter((t) => t.provenance.source === 'import').map((t) => t.occurrenceRef ?? null)]).toEqual([-10000, [null]]);
  });
  it('the bill\'s name in the description ("CITY ELECTRICITY CO −$91.40"): "Pays Electricity" ticked; imported and linked → Safe to Spend unchanged', async () => {
    mockData = buildDemoWorkspace(SAMPLE_TODAY, SAMPLE_NOW);
    const before = sts();
    const ui = await toReview('2026-11-12,CITY ELECTRICITY CO,-91.40,2779.83\n');
    expect(ui.getByRole('checkbox', { name: 'Pays Electricity' }).props.accessibilityState.checked).toBe(true);
    expect(ui.queryByTestId('occurrence-weak-2')).toBeNull();
    await act(async () => { fireEvent.press(ui.getByText('Import 1 transaction')); });
    await wait();
    // Checking −91.40, and the $91.40 Electricity estimate is no longer forecast
    expect([sts() - before, mockData.transactions.filter((t) => t.provenance.source === 'import').map((t) => t.occurrenceRef?.originalDate)]).toEqual([0, ['2026-11-18']]);
  });
  it('Add form: a $100 expense (no payee yet) near the Electricity due date is offered unticked, with the reason', async () => {
    mockData = buildDemoWorkspace(SAMPLE_TODAY, SAMPLE_NOW);
    setAddPrefill({ amountCents: 10000 });
    const ui = await render(<AddScreen />);
    const check = ui.getByRole('checkbox', { name: /This pays Electricity due Nov 18/ });
    expect(check.props.accessibilityState.checked).toBe(false);
    expect(ui.getByText(/Only the amount and date are close; the description doesn't mention it\./)).toBeTruthy();
  });
});
