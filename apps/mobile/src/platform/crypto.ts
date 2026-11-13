import * as ExpoCrypto from 'expo-crypto';
import { createNobleProvider } from '@clarity/security/noble';

/** Audited pure-JS crypto (@noble) with the platform CSPRNG from expo-crypto. Byte-compatible with the web app. */
export const provider = createNobleProvider((n) => ExpoCrypto.getRandomBytes(n));
