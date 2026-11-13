# Phase 1 implementation report

Date: 2026-11-13 · Branch: `phase-1` · Environment: Linux dev container with Node 22 and Chromium only. There is no iOS or Android simulator, no Safari and no Edge.

Labels: **Verified here** = automated test or direct check in this environment. **Needs device verification** = cannot be checked here. **Not done** = not built.

## 1. What was built

### Shared packages (single source of truth)
| Package | Contents | Verified here |
|---|---|---|
| `shared` | Types, integer-cent money, ISO calendar dates without time-zone math, categories, exact UI terms | ✅ unit tests |
| `engine` | Balances, recurrence (all frequencies; day 31 and last-day handling, leap years, weekend rules, pause/skip/move/override), occurrence status (expected/estimated/unknown/skipped/overdue/confirmed), daily forecast (outflows before inflows), Safe to Spend, Can I afford this?, lowest balance (through month-end and before next income), balance on any date, explanations, validation, matching | ✅ unit tests + golden scenarios |
| `import` | CSV parsing and the pipeline below | ✅ unit tests with 6 fixture statements |
| `security` | Random master key, Argon2id passphrase slot, HKDF recovery-key slot, AES-256-GCM per record with AAD, cross-platform backup format, passphrase policy, self-test vectors | ✅ unit tests; WebCrypto+hash-wasm and noble are byte-identical |
| `data` | Encrypted workspace store (encrypt → atomic write → memory), undo, commands (accounts, transactions, atomic transfers, splits, refunds, adjustments, recurring, exceptions, import commit/undo, onboarding), migrations, CSV export (formula-injection safe), demo data | ✅ unit tests |
| `design-system` | Tokens for light and dark, CSS generator | ✅ WCAG AA contrast test |

The CSV pipeline in `import` covers:
- delimiter and preamble detection;
- column, date-format and decimal detection;
- sign-convention suggestion from the running balance;
- categorization from your history plus fixed rules;
- exact and likely duplicates;
- transfer and refund detection;
- matching rows to scheduled bills;
- reconciliation against the statement balance.

### Desktop web app (`apps/web`)
- **Onboarding:** privacy explanation, then passphrase, recovery key (verified by retyping), balance, pay, optional bill, and the first overview.
- **Unlocking:** lock screen with passphrase or recovery key, auto-lock.
- **Dashboard:** projected month-end, Safe to Spend, available cash with per-account lines, forecast step chart, lowest balance (two windows), end of today, warnings, upcoming. "Why this number?" on every figure.
- **Add Transaction dialog:** merchant memory, duplicate warning, bill matching, splits, pending, future-dated items.
- **Can I afford this?**
- **Transactions table:** filters, search, monthly groups, sorting, bulk categorize/delete, keyboard navigation, undo.
- **Planning:** 45-day timeline; balance on a date; income, bills and transfers; skip/move/change/mark paid; pause; planned one-off expenses.
- **Statement import:** runs in a Web Worker. Mapping review, review table, reconciliation, history with undo.
- **Settings:** accounts and balance updates, categories, preferences, change passphrase, recovery key, encrypted backup and restore, CSV export with warning, delete all data (crypto-shred).
- **Privacy Center:** answers the 7 questions; shows the storage persistence state; install prompt.
- **Self-test page.**
- **Platform protections:** offline PWA, strict CSP, security headers file, demo mode in memory only.

### Mobile app (`apps/mobile`, Expo SDK 58 / React Native 0.88)
- Same onboarding (with a number keypad) and lock screen.
- **Biometric unlock:** Face ID / Touch ID / fingerprint via Keychain/Keystore. Falls back to the passphrase if the key is invalidated.
- **Protections:** locks after time in the background, privacy overlay in the app switcher, Android screenshot blocking.
- **Navigation and entry:** floating glass tab bar with a central Add button; keypad-first Add sheet with merchant and category chips and haptics.
- **Screens:**
  - Home, mirroring the web dashboard, with an SVG chart;
  - Transactions, grouped by day with search and periods;
  - Planning, with timeline, balance on a date, recurring items and their actions;
  - recurring form;
  - Can I afford this?;
  - "Why this number?" sheet;
  - statement import, with document picker, mapping, review and reconciliation;
  - Settings: accounts, categories, preferences, security, backup/restore/CSV via the share sheet, import history, Privacy Center, self-test, delete all.

## 2. Verification results (this environment)
| Check | Result |
|---|---|
| `npm run typecheck` (strict TS: packages, DOM provider, tests) | ✅ pass |
| `npm run lint` (incl. `no-console`) | ✅ pass |
| Unit tests (Vitest) | ✅ **146 passed** |
| Web build (strict CSP, service worker) | ✅ |
| Web end-to-end (Playwright, Chromium) | ✅ **18 flows passed** (see below) |
| Web screenshots at 1280/1440/1920, light and dark | ✅ reviewed; layout fixes applied (`docs/screenshots/web`) |
| Mobile TypeScript | ✅ |
| Mobile Jest (jest-expo) | ✅ **13 passed** (see below) |
| Mobile bundles for iOS and Android (`expo export`, Hermes bytecode) | ✅ both compile |
| `expo-doctor` | 18/20 pass; the 2 others need the Expo API (exp.host), which this network blocks |
| Mobile UI rendered via react-native-web at iPhone size, light/dark | ✅ (`docs/screenshots/mobile-web-preview`). **A browser preview, not a device** |

The **18 web flows** cover:
- onboarding numbers checked against a hand calculation;
- "It varies" income;
- adding a transaction in 4 interactions, with undo;
- the duplicate warning;
- keyboard edit and delete;
- a transfer not counting as spending;
- Can I afford (yes/no, nothing saved);
- the "Why this number?" breakdown;
- lock with a wrong and then the right passphrase, plus **no plaintext in IndexedDB**;
- recovery-key unlock;
- encrypted backup → simulated storage loss → restore with identical numbers;
- delete all data;
- CSV import → ambiguous date prompt → import → reconcile → re-import flagged → undo;
- unsupported PDF rejected;
- **network audit** (no request leaves the origin or carries financial data);
- **offline reload**;
- self-test page;
- demo mode.

The **13 mobile tests** cover:
- the SQLite adapter with the mobile crypto provider, ciphertext only;
- atomic rollback;
- wipe;
- **web → phone → web encrypted backup round trip**;
- keypad;
- the lock-on-resume rule;
- biometric cancel vs. invalidation;
- golden engine and crypto vectors.

## 3. Needs device verification (not claimed)
- **iPhone and Android:** every mobile screen, gestures, keyboard avoidance, safe areas, text scaling, VoiceOver/TalkBack, haptics.
- **Biometrics:** Face ID needs a development build; Expo Go cannot do it on iPhone. Also: invalidation after enrollment changes, background lock, the app-switcher overlay, Android FLAG_SECURE.
- **Argon2id timing on phones:** pure JS on Hermes. If it is over ~3 s, add a native Argon2 module (the format supports it with no migration).
- **Glass effects:** iOS 26 Liquid Glass (`expo-glass-effect`), BlurView on older iOS, the translucent surface on Android.
- **Desktop browsers:** Safari (including storage eviction behaviour and Add to Dock) and Edge.
- **Real bank CSV files** beyond the 6 fixtures. Every bank's export differs; a test file per target bank is recommended.

The step-by-step checklist is in `docs/device-test-script.md`.

## 4. Deliberate limits and deviations (agreed or flagged)
- **No sync** (decision). Changes move between devices only by encrypted backup and restore; the app says so.
- **Single currency per workspace** (decision). Other currencies are excluded from totals with a warning.
- **Mobile split editing is web-only for now.** Mobile shows split transactions and keeps their splits when they are edited.
- **Mobile auto-lock is capped at 5 minutes in the background,** stricter than the setting allows on web. The UI states this.
- **Web has no biometric unlock** (WebAuthn PRF support is uneven); listed as a future option.
- **Statement formats:** CSV only. PDF, OFX/QFX, XLSX and OCR are rejected with an honest message; the parser interface is ready for them.
- **Not built (later phases per spec):**
  - insights and recommendations;
  - subscription detection;
  - savings goals;
  - debt tracking;
  - advanced reports;
  - scenario planning.

## 5. Bugs found and fixed during this work
1. **Safe to Spend horizon** ignored a paycheck that fell after month-end. Found by a test; fixed with a 62-day income lookahead.
2. **Import:**
   - one unreadable row stopped date-format detection for the whole file (now an 80% threshold);
   - card statements with exactly 60% positive amounts weren't recognized;
   - names were title-cased wrongly after apostrophes ("Joe'S").
3. **Web dialogs:**
   - they re-focused their first field whenever the page re-rendered;
   - the Add dialog focused the Expense toggle instead of the amount field, which slowed entry.
4. **Two React copies** after adding Expo, which breaks hooks. Fixed by pinning one version with npm overrides.
5. **Mobile startup** hung on a blank screen if the secure store threw. It now falls back to the passphrase.
6. **Layout:**
   - Planning column overflow;
   - empty Status card on the dashboard;
   - backup reminder shown in demo mode;
   - sidebar footer pushed off-screen by the demo banner.

## 6. Owner decisions still open
- App name and icon. "Clarity" is a working name and the trademark has not been checked.
- Bundle IDs. The placeholder `app.clarity.budget.dev` must be changed.
- Pricing / business model.
- Hosting for the web app (headers file provided for Netlify / Cloudflare Pages).
- Apple Developer Program and Google Play accounts, export-compliance answers (the app uses standard encryption), and store privacy labels ("Data not collected" is accurate for this architecture).
