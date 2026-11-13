const mockStore = new Map<string, string>();
const mockState: { failRead: Error | null } = { failRead: null };
jest.mock('expo-secure-store', () => ({
  WHEN_PASSCODE_SET_THIS_DEVICE_ONLY: 1,
  canUseBiometricAuthentication: () => true,
  setItemAsync: async (k: string, v: string) => void mockStore.set(k, v),
  getItemAsync: async (k: string, opts?: { requireAuthentication?: boolean }) => {
    if (opts?.requireAuthentication && mockState.failRead) throw mockState.failRead;
    return mockStore.get(k) ?? null;
  },
  deleteItemAsync: async (k: string) => void mockStore.delete(k),
}));
jest.mock('expo-local-authentication', () => ({
  hasHardwareAsync: async () => true,
  isEnrolledAsync: async () => true,
  supportedAuthenticationTypesAsync: async () => [2],
  AuthenticationType: { FINGERPRINT: 1, FACIAL_RECOGNITION: 2 },
}));

import { biometricSupport, enableBiometric, isBiometricEnabled, readBiometricKey } from '../src/platform/biometrics';

describe('biometric key handling', () => {
  beforeEach(() => {
    mockStore.clear();
    mockState.failRead = null;
  });
  it('stores and returns the master key', async () => {
    const mk = new Uint8Array(32).fill(7);
    await enableBiometric(mk);
    expect(await isBiometricEnabled()).toBe(true);
    const r = await readBiometricKey();
    expect(r.ok && Array.from(r.masterKey)).toEqual(Array.from(mk));
  });
  it('a cancelled prompt keeps biometrics enabled', async () => {
    await enableBiometric(new Uint8Array(32));
    mockState.failRead = new Error('User canceled the authentication');
    expect(await readBiometricKey()).toEqual({ ok: false, reason: 'cancelled' });
    expect(await isBiometricEnabled()).toBe(true);
  });
  it('an invalidated key (biometrics changed) is removed and falls back to the passphrase', async () => {
    await enableBiometric(new Uint8Array(32));
    mockState.failRead = new Error('Key permanently invalidated');
    expect(await readBiometricKey()).toEqual({ ok: false, reason: 'unavailable' });
    expect(await isBiometricEnabled()).toBe(false);
  });
  it('labels Face ID on iOS', async () => {
    expect((await biometricSupport()).available).toBe(true);
  });
});
