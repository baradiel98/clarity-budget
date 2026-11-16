import { act, fireEvent, render } from '@testing-library/react-native';
import { addTransaction, adjustBalance, applyOps, createAccount, defaultSettings, emptyWorkspace, type Ctx } from '@clarity/data';
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
  useSession: () => ({ today: '2026-11-16', pendingRecoveryKey: null }),
  useRun: () => jest.fn(),
  useStore: () => ({ store: { undo: jest.fn() } }),
}));

import Planning from '../app/(tabs)/planning';
import { takeExplain } from '../src/state/nav';

/**
 * Phase 5A.3 (F2) on mobile (component test in Node; not a simulator or a device). One account: no "Show" chip; the
 * schedule is that account's own view, and today's Day details starts from the confirmed balance.
 * Hand-worked: Checking $1,200.00, confirmed at $1,200.00, then $10.00 QA coffee → $1,190.00.
 */
const NOW = Date.UTC(2026, 10, 16, 10);
let seq = 0;
const ctx = (now: number): Ctx => ({ data: mockData, now, today: '2026-11-16', newId: (p) => `${p}_${++seq}` });

describe('Planning · one account (mobile, Phase 5A.3)', () => {
  it('no chooser; Day details for the account starts from the confirmed balance', async () => {
    mockData = emptyWorkspace(defaultSettings(NOW));
    const a = createAccount(ctx(NOW - 86_400_000 * 10), { name: 'Checking', type: 'checking', currentBalanceCents: 120000 });
    mockData = applyOps(mockData, a.ops);
    mockData = applyOps(mockData, adjustBalance(ctx(NOW), a.account.id, 120000, 'QA', '2026-11-16').ops);
    mockData = applyOps(mockData, addTransaction(ctx(NOW + 60_000), { kind: 'expense', accountId: a.account.id, date: '2026-11-16', amountCents: 1000, merchant: 'QA coffee', categoryId: null }).ops);
    const ui = await render(<Planning />);
    expect(ui.queryByTestId('ledger-scope')).toBeNull();
    await act(async () => { fireEvent.press(ui.getByLabelText('Day details: Mon, Nov 16, Checking')); });
    const ex = takeExplain()!;
    expect(ex.lines.map((l) => [l.label, l.cents, l.balanceAfterCents])).toEqual([
      ['Confirmed balance (Nov 16)', 120000, undefined],
      ['QA coffee', -1000, 119000],
      ['Recorded balance today', 119000, undefined],
      ['End of day', 119000, undefined],
    ]);
  });
});
