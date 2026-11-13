import { fireEvent, render } from '@testing-library/react-native';
import { useState } from 'react';
import { Text } from 'react-native';
import { runEngineSelfTest } from '@clarity/engine';
import { runCryptoSelfTest } from '@clarity/security';

jest.mock('expo-crypto', () => ({ getRandomBytes: (n: number) => new Uint8Array(require('node:crypto').randomBytes(n)) }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(), selectionAsync: jest.fn(), notificationAsync: jest.fn(), ImpactFeedbackStyle: {}, NotificationFeedbackType: {} }));
jest.mock('lucide-react-native', () => ({ Delete: () => null }));

import { provider } from '../src/platform/crypto';
import { MAX_BACKGROUND_MS, shouldLockOnResume } from '../src/state/session';
import { Keypad } from '../src/ui/Keypad';

describe('lock on resume', () => {
  it('locks after the grace period, capped at 5 minutes', () => {
    expect(shouldLockOnResume(null, 1e9, 1)).toBe(false);
    expect(shouldLockOnResume(0, 59_000, 1)).toBe(false);
    expect(shouldLockOnResume(0, 60_000, 1)).toBe(true);
    expect(shouldLockOnResume(0, MAX_BACKGROUND_MS, 15)).toBe(true);
    expect(shouldLockOnResume(0, MAX_BACKGROUND_MS - 1, 15)).toBe(false);
  });
});

describe('Keypad', () => {
  function Harness() {
    const [v, setV] = useState('');
    return (
      <>
        <Keypad value={v} onChange={setV} />
        <Text testID="out">{v}</Text>
      </>
    );
  }
  it('builds amounts without floats, max 2 decimals, single point', async () => {
    const r = await render(<Harness />);
    for (const k of ['1', '2', 'Decimal point', 'Decimal point', '5', '0', '9']) await fireEvent.press(r.getByLabelText(k));
    expect(r.getByTestId('out').props.children).toBe('12.50');
    await fireEvent.press(r.getByLabelText('Delete digit'));
    expect(r.getByTestId('out').props.children).toBe('12.5');
  });
  it('leading zero is replaced', async () => {
    const r = await render(<Harness />);
    await fireEvent.press(r.getByLabelText('0'));
    await fireEvent.press(r.getByLabelText('7'));
    expect(r.getByTestId('out').props.children).toBe('7');
  });
});

describe('on-device self-tests (run here under the React Native Jest environment)', () => {
  it('golden engine scenarios match', () => {
    expect(runEngineSelfTest().every((r) => r.ok)).toBe(true);
  });
  it('mobile crypto provider matches the published vectors', async () => {
    const r = await runCryptoSelfTest(provider);
    expect(r.filter((x) => !x.ok)).toEqual([]);
  }, 60_000);
});
