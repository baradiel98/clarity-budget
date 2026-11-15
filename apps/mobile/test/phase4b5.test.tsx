import { act, fireEvent, render } from '@testing-library/react-native';
import { ScrollView } from 'react-native';
import { buildDemoWorkspace } from '@clarity/data';
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

import AddScreen from '../app/add';
import { Segmented } from '../src/ui/Segmented';
import { SAMPLE_NOW, SAMPLE_TODAY } from '../../../packages/data/test/fixtures/home-sample-nov13';

/**
 * Phase 4B.5 regressions (component tests in Node). The defects were found in the mobile app rendered through React
 * Native for Web at 360×640 and 390×844 (no simulator or device was available); the fixes were checked there too.
 */
describe('Phase 4B.5 mobile fixes', () => {
  it('Segmented: options size to their labels and share spare width (no equal quarters that cut "This month" to "This mo…")', async () => {
    const ui = await render(<Segmented label="Period" value="this" onChange={jest.fn()} options={[{ value: 'this', label: 'This month' }, { value: 'last', label: 'Last month' }, { value: '90', label: '90 days' }, { value: 'all', label: 'All' }]} />);
    for (const o of ui.getAllByRole('radio')) {
      const style = Object.assign({}, ...[o.props.style].flat(Infinity).filter(Boolean));
      expect(style).toMatchObject({ flexGrow: 1, flexShrink: 0, flexBasis: 'auto' });
      expect(style.flex).toBeUndefined();
    }
  });

  it('Add: opening "Notes or pending" scrolls the form to its end, so the new fields are not left under the keypad', async () => {
    jest.useFakeTimers();
    mockData = buildDemoWorkspace(SAMPLE_TODAY, SAMPLE_NOW);
    const spy = jest.spyOn(ScrollView.prototype as unknown as { scrollToEnd: () => void }, 'scrollToEnd').mockImplementation(() => {});
    const ui = await render(<AddScreen />);
    expect(ui.queryByText('Pending (not yet cleared)')).toBeNull();
    await act(async () => { fireEvent.press(ui.getByText('Notes or pending')); });
    await act(async () => { jest.advanceTimersByTime(100); });
    expect(ui.getByText('Pending (not yet cleared)')).toBeTruthy();
    expect(spy).toHaveBeenCalledWith({ animated: true });
    spy.mockRestore();
    jest.useRealTimers();
  });
});
