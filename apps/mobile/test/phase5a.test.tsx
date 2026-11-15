import { act, fireEvent, render } from '@testing-library/react-native';
import { ActionSheetIOS } from 'react-native';
import { buildDemoWorkspace, engineInput } from '@clarity/data';
import { computeSafeToSpend } from '@clarity/engine';
import type { WorkspaceData } from '@clarity/shared';

jest.mock('expo-crypto', () => ({ getRandomBytes: (n: number) => new Uint8Array(require('node:crypto').randomBytes(n)) }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(), notificationAsync: jest.fn(), selectionAsync: jest.fn(), ImpactFeedbackStyle: {}, NotificationFeedbackType: {} }));
jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('@react-native-community/datetimepicker', () => () => null);
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }), SafeAreaView: ({ children }: any) => children }));
jest.mock('expo-router', () => ({ router: { back: jest.fn(), push: jest.fn() }, Stack: { Screen: () => null } }));
let mockData: WorkspaceData;
jest.mock('../src/state/session', () => ({
  useData: () => mockData,
  useSession: () => ({ today: '2026-11-13', pendingRecoveryKey: null }),
  useRun: () => jest.fn(),
  useStore: () => ({ store: { undo: jest.fn() } }),
}));

import { router } from 'expo-router';
import Planning from '../app/(tabs)/planning';
import Explain from '../app/explain';
import { setExplain, takeExplain } from '../src/state/nav';
import { SAMPLE_NOW, SAMPLE_TODAY } from '../../../packages/data/test/fixtures/home-sample-nov13';

/**
 * Phase 5A on mobile (component tests in Node; not a simulator or a device). Sample data, today Fri, Nov 13, 2026.
 * Hand-worked: Everyday Checking $2,871.23 today (opened Oct 14 with $1,000.00); Nov 18 Electricity ≈ −$91.40 → $2,779.83.
 */
describe('Planning · daily ledger (mobile)', () => {
  beforeEach(() => { mockData = buildDemoWorkspace(SAMPLE_TODAY, SAMPLE_NOW); (router.push as jest.Mock).mockClear(); });

  it('day details for all spendable cash; then one account chosen from the sheet; the running balance is shown; nothing changes', async () => {
    const sts = computeSafeToSpend(engineInput(mockData, SAMPLE_TODAY)).cents;
    const ui = await render(<Planning />);
    // today is listed (with nothing scheduled) so its details can be opened
    await act(async () => { fireEvent.press(ui.getByLabelText('Day details: Fri, Nov 13, All spendable cash')); });
    expect(router.push).toHaveBeenCalledWith('/explain');
    const cash = takeExplain()!;
    expect(cash.lines.map((l) => [l.label, l.cents])).toEqual([['Current recorded balance', 287123], ['End of day', 287123]]);

    const sheet = jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation((opts, cb) => cb(opts.options.indexOf('Everyday Checking')));
    await act(async () => { fireEvent.press(ui.getByTestId('ledger-scope')); });
    expect(sheet.mock.calls[0]![0].options).toEqual(['All spendable cash', 'Everyday Checking', 'Savings', 'Visa Card', 'Cancel']);
    expect(ui.getByTestId('ledger-scope').props.accessibilityLabel).toBe('Show: Everyday Checking. Change');
    await act(async () => { fireEvent.press(ui.getByLabelText('Day details: Wed, Nov 18, Everyday Checking')); });
    const ex = takeExplain()!;
    expect(ex.title).toBe('Wed, Nov 18 · Everyday Checking');
    expect(ex.lines.map((l) => [l.kind, l.label, l.cents, l.balanceAfterCents])).toEqual([
      ['start', 'Start of day', 287123, undefined],
      ['out', 'Electricity', -9140, 277983],
      ['result', 'End of day', 277983, undefined],
    ]);
    // the screen renders the running balance next to the amount
    setExplain(ex);
    const screen = await render(<Explain />);
    expect(screen.getByTestId('balance-after')).toHaveTextContent('$2,779.83');
    expect(screen.getByLabelText('Balance after: $2,779.83')).toBeTruthy();
    sheet.mockRestore();
    expect(computeSafeToSpend(engineInput(mockData, SAMPLE_TODAY)).cents).toBe(sts);
  });

  it('a card: end of day shown as owed, with the note that unrecorded interest is not included', async () => {
    const sheet = jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation((opts, cb) => cb(opts.options.indexOf('Visa Card')));
    const ui = await render(<Planning />);
    await act(async () => { fireEvent.press(ui.getByTestId('ledger-scope')); });
    expect(ui.getByTestId('ledger-card-note')).toHaveTextContent("Projected card balances include only charges, payments and refunds you recorded or scheduled. Interest and fees you haven't recorded aren't included.");
    // the sample's Visa owes $247.66 today
    expect(ui.getAllByTestId('tl-day-end')[0]).toHaveTextContent('Owed $247.66');
    sheet.mockRestore();
  });
});
