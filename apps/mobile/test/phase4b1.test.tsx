import { act, fireEvent, render, within } from '@testing-library/react-native';
import { buildDemoWorkspace, createAccount, MemoryAdapter, onboard, WorkspaceStore } from '@clarity/data';
import { BALANCE_ENTRY_HINT, BALANCE_ENTRY_SHORT, type WorkspaceData } from '@clarity/shared';

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

import { provider } from '../src/platform/crypto';
import { CaptureView } from '../src/features/Capture';
import { Onboarding } from '../src/features/Onboarding';
import { captureStore } from '../src/state/capture';
import { SAMPLE_NOW, SAMPLE_TODAY } from '../../../packages/data/test/fixtures/home-sample-nov13';

/** Phase 4B.1 on mobile (component tests in Node; not a simulator or a device). */
jest.setTimeout(120_000);
const NOW = Date.UTC(2026, 10, 13, 15);

it('Onboarding: the first question shows the short line; the full balance explanation is behind an expandable button', async () => {
  const d = buildDemoWorkspace(SAMPLE_TODAY, SAMPLE_NOW);
  mockData = { ...d, settings: { ...d.settings, onboardingComplete: false } };
  const ui = await render(<Onboarding />);
  expect(ui.getByText(`${BALANCE_ENTRY_SHORT} You can add savings, cash and cards later.`)).toBeTruthy();
  expect(ui.queryByTestId('balance-more')).toBeNull();
  const toggle = ui.getByTestId('balance-more-toggle');
  expect(toggle.props.accessibilityRole).toBe('button');
  expect(toggle.props.accessibilityState).toMatchObject({ expanded: false });
  await act(async () => { fireEvent.press(toggle); });
  expect(ui.getByTestId('balance-more')).toHaveTextContent(BALANCE_ENTRY_HINT);
  expect(ui.getByTestId('balance-more-toggle').props.accessibilityState).toMatchObject({ expanded: true });
  // the step itself is unchanged: keypad, overdrawn choice, Continue
  expect(ui.getByText('This account is overdrawn (the balance is negative)')).toBeTruthy();
  expect(ui.getByText('Continue')).toBeTruthy();
});

it('Capture: "No account was mentioned" is said once for the batch, not on each draft; the field still says "your default"', async () => {
  captureStore.clear();
  const { store } = await WorkspaceStore.create(new MemoryAdapter(), provider, 'correct horse battery', { withRecoveryKey: false, now: NOW });
  await store.apply(onboard(store.ctx(NOW, '2026-11-01'), { checkingBalanceCents: 200000 }));
  await store.apply(createAccount(store.ctx(NOW, '2026-11-01'), { name: 'Chase Visa', type: 'credit_card', currentBalanceCents: 30000 }).ops);
  const approve = jest.fn(async () => null);
  const ui = await render(<CaptureView data={store.data} today="2026-11-13" approve={approve} onAddManually={jest.fn()} />);
  await fireEvent.changeText(ui.getByTestId('capture-text'), 'Spent $14.50 on lunch at Panera yesterday and $60 on gas today');
  await fireEvent.press(ui.getByTestId('capture-read'));
  const drafts = await ui.findAllByTestId('draft');
  expect(drafts).toHaveLength(2);
  expect(ui.getAllByTestId('capture-batch-note')).toHaveLength(1);
  expect(ui.getByTestId('capture-batch-note')).toHaveTextContent('No account was mentioned in these 2 drafts, so Checking is used for them.');
  for (const dr of drafts) expect(within(dr).queryByText(/No account was mentioned/)).toBeNull();
  for (const dr of drafts) expect(within(dr).getAllByText(/your default/).length).toBeGreaterThan(0);
  expect(approve).not.toHaveBeenCalled(); // still review before approval
});
