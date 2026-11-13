# Dependencies and why each exists

Policy: as few as possible, no analytics/telemetry SDKs, nothing that sends data off the device. Run `npm audit --omit=dev` before releases.

## Shared packages (`packages/*`)
| Package | Used by | Why |
|---|---|---|
| `@noble/ciphers`, `@noble/hashes` | security (mobile provider, tests) | Audited pure-JS AES-GCM, Argon2id, HKDF. React Native has no WebCrypto |
| `hash-wasm` (optional peer) | security (web provider) | Argon2id in WASM for browsers. WebCrypto has no Argon2 |

## Web (`apps/web`)
| Package | Why |
|---|---|
| react, react-dom | UI |
| dexie | IndexedDB with atomic transactions |
| lucide-react | Icons (explicit imports; no emoji icons) |
| @fontsource-variable/inter | Self-hosted font (no Google Fonts requests) |
| vite, @vitejs/plugin-react, vite-plugin-pwa (dev) | Build, offline service worker |
| @playwright/test (dev) | End-to-end tests |

No router, state, UI-kit or chart library: a small history router, `useSyncExternalStore` and an SVG chart are in the app.

## Mobile (`apps/mobile`)
Expo SDK 58 modules at the versions Expo pins:
- expo-router;
- expo-sqlite (storage);
- expo-secure-store and expo-local-authentication (biometric unlock);
- expo-crypto (secure random);
- expo-document-picker, expo-file-system and expo-sharing (import / backup files);
- expo-haptics;
- expo-blur and expo-glass-effect (glass chrome);
- expo-screen-capture (Android FLAG_SECURE);
- expo-font with @expo-google-fonts/inter (4 weights);
- @react-native-community/datetimepicker;
- react-native-svg with lucide-react-native.

Dev only: jest-expo, @testing-library/react-native, and react-native-web (browser preview only).

## Audit status (2026-11-13)
- `npm audit --omit=dev` in the workspace reports moderate advisories in **build/test tooling only**:
  - `minimatch` through `@expo/fingerprint` (Expo CLI);
  - the Jest 29 chain (`babel-plugin-istanbul`, `glob`, `deepmerge`), pulled in by jest-expo.

  None of these packages is included in the shipped web bundle or the mobile JS bundle.
- typescript-eslint pulls a flagged `minimatch` (dev only).
- Revisit when Expo/jest-expo publish updates. Do not use `npm audit fix --force`: it would break Expo's pinned versions.
