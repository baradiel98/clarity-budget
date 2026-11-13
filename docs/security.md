# Security, privacy and recovery design

## Threat model (what this protects against, and what it doesn't)
**Protects:**
- Someone reading the app's storage on a lost or shared device: IndexedDB on web, the SQLite file on mobile, or a copied backup file. Every financial record is AES-256-GCM ciphertext.
- Offline guessing of the passphrase. It is memory-hard (Argon2id), and short PINs are rejected.
- Tampering, or moving rows between records or vaults. GCM authentication covers the vault, table, record ID and key version.
- Our own servers. There are none: no account, no sync, no analytics, no network calls with financial data.

**Does not protect against:**
- Malware or a malicious browser extension running while the app is unlocked. Decrypted data is in memory then.
- Someone who knows the passphrase or holds the recovery key.
- Loss of both the passphrase and the recovery key. The data is then unrecoverable by design.

## Keys
```
master key (MK) — 32 random bytes, generated once per workspace
   │  AES-256-GCM, fresh 96-bit IV per write, AAD = vault|table|id|keyVersion
   ▼
every record  {table, id, keyVersion, iv, ct, updatedAt, deviceId, deleted}

passphrase ──Argon2id(m=19 MiB, t=2, p=1, 16-byte salt)──► KEK₁ ──AES-GCM wrap──► slot "passphrase"
recovery key (160-bit) ──HKDF-SHA256(salt, "clarity/recovery-kek/v1")──► KEK₂ ──wrap──► slot "recovery"
```
- Changing the passphrase only re-wraps the MK. Records are not re-encrypted. Tested.
- Regenerating the recovery key replaces its slot. The old key stops working. Tested.
- Each slot stores its KDF id and parameters, so stronger parameters can be adopted later without breaking old data or backups.
- Passphrases are Unicode-normalized (NFKC), so the same text typed on different keyboards derives the same key.
- `keyVersion` on every record is reserved for future master-key rotation.

## KDF choice and benchmark
WebCrypto has no Argon2, and React Native has no WebCrypto. Implementations:
- **Web:** `hash-wasm` (WASM).
- **Mobile:** `@noble/hashes` (audited, pure JS).

Both reproduce the same known-answer vectors (`packages/security/src/vectors.ts`), and `security.test.ts` checks them against each other.

Measured in this development container (Node 22 / V8, server CPU, `node scripts/kdf-benchmark.mjs`):

| KDF | noble (pure JS) | hash-wasm (WASM) |
|---|---|---|
| Argon2id 19 MiB, t=2 (**chosen**) | ~250 ms | ~70 ms |
| Argon2id 64 MiB, t=3 | ~990 ms | ~260 ms |
| scrypt N=2^17, r=8 | ~545 ms | – |
| PBKDF2-SHA256 600k | ~720 ms | – |

**Rationale:**
- Argon2id is memory-hard, which makes GPU guessing far more expensive than PBKDF2. 19 MiB with t=2 is the OWASP-listed minimum Argon2id configuration.
- 64 MiB would be stronger, but the pure-JS implementation on phones (Hermes has no JIT) is estimated to take many seconds, and every slot must be computable on both platforms so backups can move between them.

**Needs device verification:** the mobile self-test screen shows the measured Argon2id time on the actual phone. If it is unacceptably slow on older devices, the planned fix is a native Argon2 module (development build). That needs no format change, because parameters are stored per slot.

On mobile, everyday unlock uses biometrics, so the KDF runs only:
- at setup;
- at recovery;
- when the user unlocks with the passphrase;
- when restoring a backup.

## Passphrase policy
- At least 10 characters.
- Number-only PINs, common passwords and single repeated characters are rejected.
- A strength meter encourages several words.

## Platform storage
| | Web | iOS / Android |
|---|---|---|
| Records | IndexedDB (Dexie), ciphertext only | expo-sqlite table, ciphertext only |
| Key slots | IndexedDB (wrapped keys) | SQLite (wrapped keys) |
| Biometric unlock | not in Phase 1 (WebAuthn PRF support is uneven) | MK copy in Keychain/Keystore via `expo-secure-store` with `requireAuthentication`; falls back to the passphrase if biometrics change or fail |
| Auto-lock | after inactivity (default 15 min) and when the tab is hidden for that long | when the app goes to the background (configurable grace period); content hidden in the app switcher |
| Persistence | `navigator.storage.persist()` requested; result shown in the Privacy Center | app sandbox |

## Remembered devices (web, "Remember this device")
**What it does.** After a successful unlock with the passphrase or recovery key, the user can choose to remember this browser for 7 or 30 days. Until then, opening or refreshing Clarity in that browser does not ask for the passphrase.

**How it works** (`apps/web/src/platform/deviceTrust.ts`):
1. WebCrypto generates a random AES-256-GCM **device key** with `extractable: false`. Its raw bytes cannot be exported or read by any script, including Clarity's own (verified by a test: `exportKey` is rejected).
2. The device key encrypts a copy of the vault's **master key**. The associated data binds the vault id and the expiry time, so editing the stored expiry makes decryption fail. The plaintext copy is zeroed immediately.
3. The `CryptoKey` object and the encrypted master key are stored in a separate IndexedDB database, `clarity-device`. The browser keeps the key material; the page only holds a handle to it.
4. On the next visit, if the trust exists, has not expired and is not paused, the browser decrypts the master key and the vault opens with it (`WorkspaceStore.unlock({ masterKey })`). Records are not changed, re-encrypted or migrated.

**Where things are stored.**
| Item | Where |
|---|---|
| Passphrase | **Nowhere.** Never stored or logged; it only exists in memory while it is typed and checked |
| Device key | IndexedDB `clarity-device`, as a non-extractable `CryptoKey`, this browser profile only |
| Encrypted master key, IV, vault id, created/expiry dates, paused flag | Same record, not secret except the ciphertext |
| "Locked" flag | `localStorage['clarity-device-locked'] = '1'`, set synchronously by a lock so that closing the tab immediately cannot skip the lock. Not secret |
| Master key (plaintext) | Only in memory while Clarity is unlocked (as before) |

None of this is in backups, and nothing is sent anywhere.

**State rules.**
| Event | Result |
|---|---|
| First unlock on a device | Passphrase or recovery key; optional "Remember this device" (7 or 30 days) |
| Remembered and not expired | Opens directly |
| Trust period over | Record deleted; lock screen says remembered access ended |
| Lock button or automatic lock after inactivity | Locks at once and **pauses** remembered access. The passphrase is needed once, then remembered access continues if "Remember" stays checked |
| Unlock with "Remember" unchecked | Any earlier trust on this browser is deleted |
| Settings → Security → This device → "Forget this device" | Device key and wrapped master key deleted |
| Delete all data, or restore a backup (a different vault) | Trust deleted |
| A broken or mismatched record (other vault, tampered) | Deleted; the passphrase is asked |
| Wrong passphrase | Fails as before; nothing is remembered |

**Limits (stated honestly).**
- During the trust period, **anyone who can use this browser profile can open Clarity without the passphrase.** Only remember devices you don't share, and keep the device itself locked.
- Non-extractable means the key cannot be *copied*, not that it cannot be *used*. Malicious code running in Clarity's page (an XSS bug or a supply-chain compromise) or a malicious browser extension could ask the browser to decrypt the master key while the trust exists. CSP, no third-party scripts and no `eval` reduce this risk; they cannot remove it.
- Malware running as the same OS user, or someone with a copy of the browser profile and that machine's OS-level key protection, may be able to use the stored key. Browser storage is not a hardware security module.
- Expiry is enforced by the app on this device, using the device clock. Turning the clock back extends trust; deleting the record (or the clock moving past expiry) ends it.
- Clearing site data, private windows and some browsers' storage eviction (for example Safari's limits for sites that are not installed) remove the remembered state. The user then simply enters the passphrase.
- The mobile app uses the platform Keychain/Keystore with biometrics instead (see "Platform storage").

## Test mode (development and the separate test site only)
- It exists only when the code is built by the Vite dev server or with `CLARITY_TEST_MODE=1`. In the production build the flag is the constant `false` and the bundler removes the code. A test checks that the production bundle contains none of the test-mode strings and that URL parameters do nothing.
- It uses a separate IndexedDB database (`clarity-test`) filled with fictional sample data, still encrypted, with a published test passphrase. It never opens or touches the real `clarity` database.

## Deletion ("crypto-shredding")
Browsers and phones cannot guarantee that deleted bytes are physically overwritten. So "Delete all data" works in this order:
1. Overwrite, then delete, the key slots (and on mobile the Keychain/Keystore copy). Without them the remaining ciphertext cannot be decrypted by anyone.
2. Delete the database.
3. Clear caches and the service worker (web) or the database file (mobile).

The UI describes it exactly this way.

## Backups
`.claritybackup` is JSON holding the key slots as of export, the encrypted rows and the schema version.
- It restores on any platform with the passphrase current **at backup time**, or with the recovery key.
- Restore decrypts everything before replacing anything, so a damaged backup or wrong passphrase never destroys existing data. Tested.
- Plain CSV export is available behind an explicit "not encrypted" warning. Cells are escaped against spreadsheet formula injection.
- Reminders appear after 14 days or 50 new transactions without a backup.

## Web hardening
- **Content Security Policy** in `index.html`: `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; img-src 'self' data: blob:; style-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'`.
  - `frame-ancestors` cannot be set from a meta tag, so `apps/web/public/_headers` provides it plus HSTS, `X-Content-Type-Options` and `Referrer-Policy` for hosts that read that file (Netlify, Cloudflare Pages). Other hosts need equivalent configuration.
- No third-party scripts, fonts, CDNs, analytics or telemetry. Fonts are self-hosted.
- Statement files are read locally with `File.text()`. They are size-limited (10 MB, 20,000 rows) and content-sniffed (binary and other formats rejected). They are never uploaded or stored; only the parsed rows' raw descriptions are kept, encrypted.
- No financial data is written to `console` or logs (lint rule `no-console`).
- The automated network audit (Playwright) records every request during a full session and fails if any request leaves the origin or contains test merchant names or amounts.

## Mobile hardening
- No network calls are made by app code; no analytics SDK; Expo Updates is disabled.
- `expo-screen-capture` prevents screenshots and recording on Android (FLAG_SECURE). An overlay hides content in the iOS app switcher.
- Statement import uses the document picker. Files are read from the app's cache, then the cached copy is deleted.

## Limits stated to users
- Data lives only on the device. No sync. Changes on one device reach another only through a manual encrypted backup and restore.
- Browsers may clear site data (Safari can, for sites that aren't installed and haven't been used for about 7 days). Install the app and keep backups.
- If both the passphrase and the recovery key are lost, no one can recover the data.
