import { act, fireEvent, render } from '@testing-library/react-native';
import { ActionSheetIOS } from 'react-native';
import { addTransaction, applyOps, buildDemoWorkspace, engineInput } from '@clarity/data';
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
import { takeExplain } from '../src/state/nav';
import { SAMPLE_NOW, SAMPLE_TODAY } from '../../../packages/data/test/fixtures/home-sample-nov13';

/**
 * Phase 5A.1 on mobile (component tests in Node; not a simulator or a device). Sample data, today Fri, Nov 13, 2026, plus a
 * $6,000 roof repair planned from Savings ($5,200) on Nov 20. Hand-worked: Savings' own view −$800.00 on Nov 20 (not
 * $0.00); $800.00 counted against the spendable accounts; −$550.00 after the Nov 30 $250 transfer in.
 */
describe('Planning · a payment Savings can only partly cover (mobile)', () => {
  beforeEach(() => {
    mockData = buildDemoWorkspace(SAMPLE_TODAY, SAMPLE_NOW);
    const sav = mockData.accounts.find((a) => a.name === 'Savings')!.id;
    mockData = applyOps(mockData, addTransaction({ data: mockData, now: SAMPLE_NOW, today: SAMPLE_TODAY, newId: (p) => `${p}_roof` }, { kind: 'expense', accountId: sav, date: '2026-11-20', amountCents: 600000, merchant: 'Roof repair', categoryId: null }).ops);
    (router.push as jest.Mock).mockClear();
  });

  it("Savings' own balance, the badge, and the explanation; all spendable cash unchanged", async () => {
    const sheet = jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation((opts, cb) => cb(opts.options.indexOf('Savings')));
    const ui = await render(<Planning />);
    // all spendable cash first: Nov 20 ends at $4,639.83 − $800.00 = $3,839.83 (the part Savings can't cover)
    await act(async () => { fireEvent.press(ui.getByLabelText('Day details: Fri, Nov 20, All spendable cash')); });
    const cash = takeExplain()!;
    expect([cash.resultCents, cash.lines.find((l) => l.label === 'Roof repair')!.cents]).toEqual([383983, -80000]);
    expect(cash.summary).toContain('listed largest first');
    await act(async () => { fireEvent.press(ui.getByTestId('ledger-scope')); });
    expect(ui.getByTestId('covered-badge')).toHaveTextContent('$800.00 shortfall · counted against spendable accounts');
    // Phase 5A.2: the same distinction as the web app (shared wording)
    expect(ui.getByTestId('ledger-shortfall-hint')).toHaveTextContent("Some payments here are more than Savings can cover. Its balances assume the full payment is taken from Savings; the shortfall is counted against your spendable accounts (Clarity hasn't chosen which). What your bank would actually do can't be known.");
    await act(async () => { fireEvent.press(ui.getByLabelText('Day details: Fri, Nov 20, Savings')); });
    const ex = takeExplain()!;
    const roof = ex.lines.find((l) => l.label === 'Roof repair')!;
    expect([roof.cents, roof.balanceAfterCents]).toEqual([-600000, -80000]);
    expect(roof.note).toContain("Savings can cover $5,200.00 of this $6,000.00 payment. The other $800.00 is a shortfall: Safe to Spend counts it against your spendable accounts, and Clarity hasn't chosen which one covers it. The balance shown here assumes the whole $6,000.00 is taken from Savings with nothing moved in first. What your bank would actually do (pay it and overdraw the account, decline it, or charge a fee) depends on your bank; Clarity can't know.");
    expect(ex.resultCents).toBe(-80000);
    await act(async () => { fireEvent.press(ui.getByLabelText('Day details: Mon, Nov 30, Savings')); });
    expect(takeExplain()!.resultCents).toBe(-55000);
    sheet.mockRestore();
  });
});
