# Clarity accounts: architecture plan (proposal, not built)

Status: **proposal for review.** Nothing in this document is implemented except the sign-in *preview* screen (`/preview/sign-in`), which is not connected to anything. Decisions that need the owner are listed at the end.

## 1. What exists today (verified in code)
- **No account, no server.** The web app is static files on Render; the mobile app makes no network calls.
- **The passphrase is an encryption secret, not a login.** `packages/security/src/vault.ts`:
  - A random 256-bit **master key (MK)** encrypts every record with AES-256-GCM (record id and vault id as associated data).
  - The MK is stored only *wrapped* in **key slots**:
    - **passphrase slot:** Argon2id(passphrase, 16-byte salt) → key-encryption key (KEK) → wraps the MK;
    - **recovery slot (optional):** a 160-bit random recovery key → HKDF → KEK → wraps the same MK.
  - "Unlocking" means one slot successfully unwraps the MK. A wrong secret fails the AES-GCM check (`WrongSecretError`).
- **Responsibilities, separated:**
  - User authentication: none (there is no one to authenticate to).
  - Key derivation and unlocking the encrypted local database: the passphrase or recovery key.
  - Recovery: the recovery key slot.
  - Mobile daily unlock: an MK copy in the Keychain/Keystore behind biometrics.
- **Consequence:** an email + password login cannot *replace* the passphrase without either keeping the password in the encryption role or leaving the data unprotected. Email/password authentication alone does not protect locally encrypted data.

## 2. Goals
1. Conventional sign-in with email and password, on web and mobile.
2. The server never sees financial data, the master key or anything that can derive it ("zero-knowledge").
3. Keep local-first: the app works offline; the server is optional storage and sync.
4. Device-specific unlock: biometrics on phones, an optional "trusted device" on the web.
5. Honest recovery: the server cannot restore data without a secret only the user holds.
6. Existing users keep their data with no re-encryption.

## 3. Proposed design
### 3.1 One password, two derived keys (the model used by zero-knowledge password managers)
On the client only:
```
stretched   = Argon2id(password, salt = per-account random salt from the server)   // same cost as today
authKey     = HKDF(stretched, info = "clarity/auth")   → sent to the server at sign-in
accountKEK  = HKDF(stretched, info = "clarity/kek")    → never leaves the device; wraps the MK (new "account" slot)
```
- The server stores only `ServerHash = Argon2id(authKey, server salt)` and compares it at sign-in. It cannot derive `accountKEK` from `authKey`, because HKDF outputs with different `info` are independent.
- **Stronger alternative to evaluate:** OPAQUE (an asymmetric PAKE from the IETF CFRG), where the server never receives a password-equivalent at all. It has fewer mature JS libraries; decide during the spike.
- The new **account slot** sits next to the existing passphrase and recovery slots; the MK and all records are unchanged.

### 3.2 What the server stores
| Data | Form |
|---|---|
| Email | Plain (needed to sign in and send mail); verified by email link |
| Account salt, server hash of `authKey` | Plain / hashed |
| Vault key slots (wrapped MK) | Ciphertext, as today's `VaultMeta` |
| Records | Ciphertext rows, exactly the format already used by backups and IndexedDB/SQLite |
| Sessions | Short-lived access token plus a rotating refresh token (httpOnly, Secure, SameSite cookie on web; Keychain/Keystore on mobile) |

The server never stores the password, `accountKEK`, the MK, the recovery key or any plaintext financial data.

### 3.3 Device unlock
- **Mobile:** unchanged. After the first sign-in, the MK is stored in the Keychain/Keystore behind Face ID / fingerprint (already implemented for the passphrase).
- **Web (optional "trust this device"):** wrap the MK with a **non-extractable** WebCrypto AES key kept in IndexedDB.
  - Trade-off: anyone with access to that browser profile can open Clarity without the password.
  - It is off by default, and only offered with a short idle lock.

### 3.4 Password change and reset
- **Change (signed in):** re-derive `accountKEK`, re-wrap the MK and update the server hash. No records are re-encrypted.
- **Forgot password:**
  - The email link proves ownership of the account, so the user can sign in again.
  - **It cannot decrypt anything.** To recover data the user needs the **recovery key** (which re-wraps the MK under the new password), or a device that is still unlocked/trusted.
  - Without either, the honest outcome is: the account is reset and the encrypted data on the server is deleted.
  - The UI must say this before the user confirms, as the preview's "No email was sent" text already does.

### 3.5 Sync (optional, later)
- Records already carry `id`, `updatedAt` and `deviceId`, and deletes are tombstones (see `EncryptedRow` and `tombstone()` in `packages/security/src/records.ts`), so the server only moves ciphertext.
- Conflicts are resolved last-writer-wins per record. Transfer pairs and import batches are sent atomically.

## 4. Migration of existing users (no data loss)
1. The user unlocks locally with today's passphrase (the MK is in memory).
2. They choose **Create account**, enter an email and a password, and verify the email.
3. The client adds an **account slot** wrapping the *existing* MK and uploads the slots and ciphertext rows. No re-encryption.
4. The passphrase slot is kept until the user removes it, so rollback is possible at any time.
5. Before any of this, the app requires (or strongly offers) a fresh encrypted backup.
6. **Test plan:** golden vault fixtures from today's format → add the account slot → unlock with each slot → identical decrypted data. Then a round trip through a fake server, and backup restore on web and mobile.

Users who never create an account keep working exactly as today (local-only).

## 5. Threats and mitigations (summary)
| Threat | Mitigation |
|---|---|
| Server database stolen | Contains only ciphertext and hashes; the Argon2id cost on both client and server limits offline guessing |
| Malicious or compromised server | Cannot decrypt. The web app is served by the same party, so CSP, Subresource Integrity, signed releases and the native apps reduce the risk of a tampered client |
| Credential stuffing | Rate limits, breached-password check (k-anonymity), optional TOTP/passkeys later |
| Phishing | Passkeys as a second factor later; email links never ask for the password |
| Lost password + no recovery key | Data is unrecoverable by design; stated clearly at sign-up and before reset |

## 6. Infrastructure options
- **A. Own small API (recommended to evaluate first):** a TypeScript service (e.g. Node with a minimal framework) and Postgres. It fits the custom zero-knowledge protocol and the ciphertext sync.
- **B. Managed auth (Supabase, Clerk, Auth0, Firebase):** these handle email and sessions, but the provider holds user emails and the password flow must still be done client-side for zero-knowledge. That adds a third party to the privacy story.
- **Hosting:** the existing Render account can run a web service and Postgres (paid tiers; check current pricing). Transactional email needs a provider such as Postmark, Resend or Amazon SES.
- **App changes:**
  - CSP `connect-src` gains the API origin.
  - The Privacy Center and the app-store privacy labels must be updated: email and encrypted data will then be stored by Clarity.

## 7. Phases
1. **Spike (1–2 weeks):** choose the HKDF-split or OPAQUE protocol; build a local fake server; prove migration against golden fixtures.
2. **Accounts without sync:** sign-up, sign-in, email verification, password change/reset with the recovery-key rule, encrypted cloud backup.
3. **Device unlock:** web "trust this device"; mobile biometrics after sign-in.
4. **Sync:** ciphertext replication across devices.
5. **Hardening:** rate limits, breached-password check, passkeys/TOTP, external security review before launch.

## 8. Decisions needed from the owner
1. Should accounts be **optional** (local-only stays available, recommended) or required?
2. **One password** (account password also protects the data, as in section 3.1) or **two secrets** (account password plus a separate data passphrase)? One is simpler; two keeps the data safe even if the account password is phished.
3. Infrastructure option A or B, and a monthly budget for hosting and email.
4. Whether to commission an external security review before launch (recommended).
