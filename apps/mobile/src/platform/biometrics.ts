import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { fromBase64, toBase64 } from '@clarity/security';
import { Platform } from 'react-native';

/**
 * Biometric unlock: a copy of the master key lives in the iOS Keychain / Android Keystore,
 * readable only after Face ID / Touch ID / fingerprint ("requireAuthentication").
 * If biometrics change or fail, the item becomes unreadable and the passphrase is used instead.
 */
const KEY = 'clarity.masterkey.v1';
const FLAG = 'clarity.biometric.enabled';

export interface BiometricSupport {
  available: boolean;
  label: string;
}

export async function biometricSupport(): Promise<BiometricSupport> {
  try {
    const [hw, enrolled, types] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
      LocalAuthentication.supportedAuthenticationTypesAsync(),
    ]);
    const face = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
    const label = Platform.OS === 'ios' ? (face ? 'Face ID' : 'Touch ID') : face ? 'face unlock' : 'fingerprint';
    return { available: hw && enrolled && SecureStore.canUseBiometricAuthentication(), label };
  } catch {
    return { available: false, label: 'biometrics' };
  }
}

export async function isBiometricEnabled(): Promise<boolean> {
  return (await SecureStore.getItemAsync(FLAG)) === '1';
}

export async function enableBiometric(masterKey: Uint8Array): Promise<void> {
  await SecureStore.setItemAsync(KEY, toBase64(masterKey), {
    requireAuthentication: true,
    keychainAccessible: SecureStore.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
    authenticationPrompt: 'Turn on biometric unlock for Clarity',
  });
  await SecureStore.setItemAsync(FLAG, '1');
}

export type BiometricResult = { ok: true; masterKey: Uint8Array } | { ok: false; reason: 'cancelled' | 'unavailable' };

export async function readBiometricKey(): Promise<BiometricResult> {
  try {
    const v = await SecureStore.getItemAsync(KEY, { requireAuthentication: true, authenticationPrompt: 'Unlock Clarity' });
    if (!v) {
      await disableBiometric();
      return { ok: false, reason: 'unavailable' };
    }
    return { ok: true, masterKey: fromBase64(v) };
  } catch (e) {
    const msg = String((e as Error)?.message ?? e).toLowerCase();
    // Invalidated keys (biometrics changed) can never be read again: remove them.
    if (msg.includes('invalidat') || msg.includes('not found') || msg.includes('could not decrypt')) {
      await disableBiometric();
      return { ok: false, reason: 'unavailable' };
    }
    return { ok: false, reason: 'cancelled' };
  }
}

export async function disableBiometric(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY).catch(() => undefined);
  await SecureStore.deleteItemAsync(FLAG).catch(() => undefined);
}
