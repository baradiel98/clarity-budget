import { createWebCryptoProvider } from '@clarity/security/webcrypto';

export const provider = createWebCryptoProvider(globalThis.crypto);
