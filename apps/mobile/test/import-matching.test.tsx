import { act, fireEvent, render } from '@testing-library/react-native';
import { applyOps, buildDemoWorkspace, type Ctx } from '@clarity/data';
import type { Transaction, WorkspaceData } from '@clarity/shared';

jest.mock('expo-crypto', () => ({ getRandomBytes: (n: number) => new Uint8Array(require('node:crypto').randomBytes(n)), digestStringAsync: async () => 'hash', CryptoDigestAlgorithm: { SHA256: 'SHA256' } }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(), notificationAsync: jest.fn(), selectionAsync: jest.fn(), ImpactFeedbackStyle: {}, NotificationFeedbackType: {} }));
jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('@react-native-community/datetimepicker', () => () => null);
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }), SafeAreaView: ({ children }: any) => children }));
jest.mock('expo-router', () => ({ router: { back: jest.fn(), push: jest.fn() }, Stack: { Screen: () => null } }));
let mockFile = '';
jest.mock('../src/platform/files', () => ({ pickTextFile: async () => ({ name: 'nov.csv', size: mockFile.length, text: mockFile }) }));
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
 * Phase 4A.5.12 on mobile: the import review lists every candidate (closest first, nothing pre-selected), shows the
 * difference for a different amount, and the button says what will happen. Component test in Node (the real screen
 * with the file picker mocked), not a simulator or a device.
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
function withPending(items: { id: string; merchant: string; date: string; cents: number }[]): WorkspaceData {
  const d = buildDemoWorkspace(SAMPLE_TODAY, SAMPLE_NOW);
  const chk = d.accounts.find((a) => a.name === 'Everyday Checking')!.id;
  const txs = items.map((i) => ({ id: i.id, accountId: chk, date: i.date, amountCents: i.cents, kind: 'refund', merchant: i.merchant, categoryId: null, notes: '', status: 'pending', provenance: { source: 'manual' }, createdAt: SAMPLE_NOW, updatedAt: SAMPLE_NOW }) as Transaction);
  return { ...d, settings: { ...d.settings, defaultAccountId: chk }, transactions: [...d.transactions, ...txs] };
}
async function toReview(csv: string) {
  mockFile = 'Date,Description,Amount,Balance\n' + csv;
  const ui = await render(<ImportScreen />);
  await act(async () => { fireEvent.press(ui.getByText('Choose CSV file')); });
  await wait(); await wait();
  await act(async () => { fireEvent.press(ui.getByText('Review transactions')); });
  await wait(); await wait();
  return ui;
}

it('two identical pending refunds: both listed, closest first, "Leave it out" selected; choosing the non-closest one; the button says Link', async () => {
  mockData = withPending([{ id: 'A', merchant: 'Refund A', date: '2026-11-10', cents: 30000 }, { id: 'B', merchant: 'Refund B', date: '2026-11-12', cents: 30000 }]);
  const ui = await toReview('2026-11-13,AMAZON REFUND 8812,300.00,3171.23\n');
  const group = ui.getByTestId('match-choice-2');
  const text = JSON.stringify(group.props.children ? ui.toJSON() : null);
  const labels = ["It's this one: Nov 12 · Refund B · +$300.00 · Everyday Checking · pending", "It's this one: Nov 10 · Refund A · +$300.00 · Everyday Checking · pending", 'Different transaction: none of these 2. Import it as new', 'Leave it out'];
  for (const l of labels) expect(ui.getByRole('checkbox', { name: l })).toBeTruthy();
  const positions = labels.map((l) => text.indexOf(JSON.stringify(l).slice(1, -1)));
  expect(positions.every((p, k) => p > 0 && (k === 0 || p > positions[k - 1]!))).toBe(true); // in this order
  expect(labels).toEqual([
    "It's this one: Nov 12 · Refund B · +$300.00 · Everyday Checking · pending",
    "It's this one: Nov 10 · Refund A · +$300.00 · Everyday Checking · pending",
    'Different transaction: none of these 2. Import it as new',
    'Leave it out',
  ]);
  expect(ui.getByRole('checkbox', { name: 'Leave it out' }).props.accessibilityState.checked).toBe(true);
  expect(ui.getByText('Import 0 transactions')).toBeTruthy();
  await act(async () => { fireEvent.press(ui.getByRole('checkbox', { name: "It's this one: Nov 10 · Refund A · +$300.00 · Everyday Checking · pending" })); });
  expect(ui.getByTestId('match-note-2').props.children.join('')).toBe('It will be marked posted and linked to this row. Nothing new is added.');
  expect(ui.getByText('Link 1 to existing')).toBeTruthy();
  void group;
});

it('a $300 pending refund cleared as $290: listed with the difference; the note explains the amount is kept', async () => {
  mockData = withPending([{ id: 'R', merchant: 'Store return', date: '2026-11-11', cents: 30000 }]);
  const ui = await toReview('2026-11-13,AMAZON REFUND 8812,290.00,3161.23\n');
  const label = "It's this one: Nov 11 · Store return · +$300.00 · Everyday Checking · pending · statement differs by −$10.00";
  await act(async () => { fireEvent.press(ui.getByRole('checkbox', { name: label })); });
  expect(ui.getByTestId('match-note-2').props.children.join('')).toMatch(/Clarity has \+\$300\.00; the statement shows \+\$290\.00 \(difference −\$10\.00\)/);
});
