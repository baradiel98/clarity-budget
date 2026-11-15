import { act, fireEvent, render, within } from '@testing-library/react-native';
import { applyOps, buildDemoWorkspace, catchUp, engineInput, type Ctx } from '@clarity/data';
import { buildDashboard, computeSafeToSpend } from '@clarity/engine';
import type { WorkspaceData } from '@clarity/shared';

jest.mock('expo-crypto', () => ({ getRandomBytes: (n: number) => new Uint8Array(require('node:crypto').randomBytes(n)) }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(), notificationAsync: jest.fn(), selectionAsync: jest.fn(), ImpactFeedbackStyle: {}, NotificationFeedbackType: {} }));
jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('@react-native-community/datetimepicker', () => () => null);
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }), SafeAreaView: ({ children }: any) => children }));
jest.mock('expo-router', () => ({ router: { back: jest.fn(), push: jest.fn() }, Stack: { Screen: () => null } }));
let mockData: WorkspaceData;
let mockToday = '2027-01-10';
let seq = 0;
// `run` applies the command to the mocked workspace, like the real session does
const mockRun = jest.fn(async (fn: (ctx: Ctx) => unknown) => {
  const r = fn({ data: mockData, now: Date.UTC(2027, 0, 10), today: mockToday, newId: (p: string) => `${p}_${++seq}` }) as { ops?: unknown[] } | unknown[];
  mockData = applyOps(mockData, (Array.isArray(r) ? r : r.ops) as never);
  return { ok: true };
});
jest.mock('../src/state/session', () => ({
  useData: () => mockData,
  useSession: () => ({ today: mockToday, pendingRecoveryKey: null }),
  useRun: () => mockRun,
  useStore: () => ({ store: { undo: jest.fn() } }),
}));

import { router } from 'expo-router';
import Planning from '../app/(tabs)/planning';
import { HomeView, type HomeActions } from '../src/features/Home';
import { takeAddPrefill } from '../src/state/nav';
import { ToastProvider } from '../src/ui/Toast';
import { SAMPLE_NOW, SAMPLE_TODAY } from '../../../packages/data/test/fixtures/home-sample-nov13';

/**
 * Phase 4B.4 on mobile (component tests in Node; not a simulator or a device). The sample, opened on Jan 10, 2027
 * with nothing recorded since Nov 13: 16 past-due items (12 bills, 4 paychecks not recorded) since Nov 18.
 */
const actions = (): HomeActions => ({ explain: jest.fn(), open: jest.fn(), add: jest.fn() });
const planning = () => render(<ToastProvider><Planning /></ToastProvider>);

describe('Catch-up (mobile)', () => {
  beforeEach(() => { mockData = buildDemoWorkspace(SAMPLE_TODAY, SAMPLE_NOW); mockToday = '2027-01-10'; });

  it('Home: one past-due line (not 16 rows); Upcoming lists only what is ahead; Review opens Planning', async () => {
    const a = actions();
    const ui = await render(<HomeView data={mockData} today={mockToday} backup={{ due: false, reason: null }} actions={a} />);
    expect(ui.getByTestId('past-due-summary')).toHaveTextContent('16 items since Nov 18 need a decision');
    const rows = ui.getAllByTestId('upcoming-row');
    expect(rows.every((r) => !String(r.props.accessibilityLabel).includes('Overdue'))).toBe(true);
    expect(ui.queryByText('Electricity is overdue')).toBeNull();
    await act(async () => { fireEvent.press(ui.getByTestId('past-due')); });
    expect(a.open).toHaveBeenCalledWith('/planning');
  });

  it('Planning: grouped by item, oldest first; Mark paid opens the existing Mark paid flow for that one occurrence; Skip skips only it', async () => {
    const sts = computeSafeToSpend(engineInput(mockData, mockToday)).cents;
    const ui = await planning();
    const groups = ui.getAllByTestId('catch-up-group');
    expect(groups.map((g) => within(g).getAllByRole('header')[0]!.props.children)).toEqual([
      ['Electricity', ' · 2 past due'], ['Paycheck', ' · 4 past due'], ['Phone', ' · 2 past due'], ['Card payment', ' · 2 past due'], ['Savings', ' · 2 past due'], ['Rent', ' · 2 past due'], ['Streaming', ' · 2 past due'],
    ]);
    expect(ui.getAllByTestId('catch-up-row')).toHaveLength(16);
    expect(computeSafeToSpend(engineInput(mockData, mockToday)).cents).toBe(sts); // looking changes nothing
    // Mark paid: Rent due Jan 1 → the Add screen with that occurrence (the existing flow, which offers to link a payment)
    const rent = mockData.recurring.find((r) => r.name === 'Rent')!;
    await act(async () => { fireEvent.press(ui.getByLabelText('Mark paid: Rent, due Jan 1')); });
    expect(takeAddPrefill()).toEqual({ occurrenceRef: { recurringId: rent.id, originalDate: '2027-01-01' }, occurrenceName: 'Rent', amountCents: 145000 });
    expect(router.push).toHaveBeenCalledWith('/add');
    // Skip: Streaming due Dec 9 → only that one; Streaming Jan 9 stays
    await act(async () => { fireEvent.press(ui.getByLabelText('Skip: Streaming, due Dec 9')); });
    const streaming = mockData.recurring.find((r) => r.name === 'Streaming')!;
    expect(mockData.exceptions.filter((e) => e.recurringId === streaming.id).map((e) => [e.originalDate, e.action])).toEqual([['2026-12-09', 'skip']]);
    expect(catchUp(buildDashboard(engineInput(mockData, mockToday))).count).toBe(15);
    ui.unmount(); // (the mocked data source doesn't notify the screen of changes; render it again)
    const ui2 = await planning();
    expect(ui2.getAllByTestId('catch-up-row')).toHaveLength(15);
    expect(ui2.getByLabelText('Skip: Streaming, due Jan 9')).toBeTruthy();
  });

  it('nothing past due: no line on Home and no review in Planning', async () => {
    mockToday = SAMPLE_TODAY;
    const ui = await render(<HomeView data={mockData} today={mockToday} backup={{ due: false, reason: null }} actions={actions()} />);
    expect(ui.queryByTestId('past-due')).toBeNull();
    const p = await planning();
    expect(p.queryByTestId('catch-up')).toBeNull();
    expect(p.queryByTestId('catch-up-done')).toBeNull();
  });
});
