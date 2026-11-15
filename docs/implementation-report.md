# Phase 1 implementation report

Last updated: 2026-11-14 (Phase 1 audit) · Branch: `phase-1` · Test environment: Linux dev container with Node 22 and Chromium only. There is no iOS or Android simulator, no Safari and no Edge.

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
| `capture` | Clarity Capture: a **deterministic, rule-based** interpreter (not an AI model or LLM) for plain-language text → draft transactions. Covers dates, amounts, merchants, categories, accounts, splits, income, refunds, transfers and card payments. Also untrusted-output validation (`parseDrafts`), review rules (`reviewDraft`) and conversion to validated inputs (`toTxInput`). Runs on the device; no network | ✅ 34 unit tests |
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

### Added after the first report (all verified only in Chromium unless noted)
- **Visual redesign:** cool blue palette, Budget and Reports pages, interactive forecast chart, motion system with reduced-motion support.
- **Unlock screen redesign;** a labelled, **unconnected** email/password sign-in preview (`/preview/sign-in`). Real accounts are only a proposal: `docs/accounts-architecture.md`.
- **"Remember this device"** (web, 7/30 days; see `docs/security.md`) and lock states. **Test mode** is compiled only into dev and test builds.
- **Update banner** with "Check for updates" and the app version in Settings.
- **Onboarding:** several paychecks into one account, with upcoming-payday previews.
- **Clarity Capture:**
  - web `/capture` page and mobile `capture` modal;
  - drafts held in memory only;
  - approval through one atomic `addTransactions` change, with the user's words kept as provenance.

## 2. Verification results (this environment)
| Check | Result |
|---|---|
| `npm run typecheck` (strict TS: packages, DOM provider, tests) | ✅ pass |
| `npm run lint` (incl. `no-console`) | ✅ pass |
| Unit tests (Vitest), 2026-11-14 | ✅ **201 passed**, 1 skipped (the golden-file generator, which runs only when asked) |
| Web build (strict CSP, service worker) | ✅ |
| Web end-to-end (Playwright, Chromium), 2026-11-14 | ✅ **77 passed**, 10 skipped (screenshot captures, which run only with `SCREENSHOTS=1`). Production build plus a separate test-mode build |
| Web screenshots at 1280/1440/1920, light and dark | ✅ reviewed; layout fixes applied (`docs/screenshots/web`) |
| Mobile TypeScript | ✅ |
| Mobile Jest (jest-expo), 2026-11-14 | ✅ **22 passed** (5 suites, including 6 Capture screen tests) |
| Mobile bundles for iOS and Android (`expo export`, Hermes bytecode) | ✅ both compile |
| `expo-doctor` | 18/20 pass; the 2 others need the Expo API (exp.host), which this network blocks |
| Mobile UI rendered via react-native-web at iPhone size, light/dark | ✅ (`docs/screenshots/mobile-web-preview`). **A browser preview, not a device** |

The original **18 web flows** (the suite has since grown to 77, adding Capture, lock and remember-device, motion, startup safety net, test mode, onboarding pay and redesign checks) cover:
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

The original **13 mobile tests** (now 22, adding the Capture screen and glow-contrast tests) cover:
- the SQLite adapter with the mobile crypto provider, ciphertext only;
- atomic rollback;
- wipe;
- **web → phone → web encrypted backup round trip**;
- keypad;
- the lock-on-resume rule;
- biometric cancel vs. invalidation;
- golden engine and crypto vectors.

## 3. Real-device use so far (owner reports, not structured tests)
- **iPhone (Safari), hosted web app:**
  - loads and is used after allow-listing the site in AdGuard (see §7);
  - picked up new versions after closing and reopening the page;
  - the redesigned screens were seen by the owner.
- **Native mobile app:** not yet run on any device.

## 4. Needs device verification (not claimed)
- **iPhone and Android:** every mobile screen, gestures, keyboard avoidance, safe areas, text scaling, VoiceOver/TalkBack, haptics.
- **Biometrics:** Face ID needs a development build; Expo Go cannot do it on iPhone. Also: invalidation after enrollment changes, background lock, the app-switcher overlay, Android FLAG_SECURE.
- **Argon2id timing on phones:** pure JS on Hermes. If it is over ~3 s, add a native Argon2 module (the format supports it with no migration).
- **Glass effects:** iOS 26 Liquid Glass (`expo-glass-effect`), BlurView on older iOS, the translucent surface on Android.
- **Desktop browsers:** Safari (including storage eviction behaviour and Add to Dock) and Edge.
- **Real bank CSV files** beyond the 6 fixtures. Every bank's export differs; a test file per target bank is recommended.

The step-by-step checklist is in `docs/device-test-script.md`.

## 5. Deliberate limits and deviations (agreed or flagged)
- **No sync** (decision). Changes move between devices only by encrypted backup and restore; the app says so.
- **Single currency per workspace** (decision). Other currencies are excluded from totals with a warning.
- **Mobile split editing is web-only for now.** Mobile shows split transactions and keeps their splits when they are edited.
- **Mobile auto-lock is capped at 5 minutes in the background,** stricter than the setting allows on web. The UI states this.
- **Web has no biometric unlock** (WebAuthn PRF support is uneven); listed as a future option.
- **Clarity Capture is rule-based.** Unusual phrasing is flagged for review, not understood. A cloud AI interpreter would need consent and a server, and is not planned without an owner decision.
- **A card paid beyond what is owed** shows as a negative "owed" amount in the engine (net worth stays correct). The UI has no wording for a card in credit.
- **Statement formats:** CSV only. PDF, OFX/QFX, XLSX and OCR are rejected with an honest message; the parser interface is ready for them.
- **Not built (later phases per spec):**
  - insights and recommendations;
  - subscription detection;
  - savings goals;
  - debt tracking;
  - advanced reports;
  - scenario planning.

## 6. Bugs found and fixed during this work
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

7. **Phase 1 audit (2026-11-14):**
   - **AdGuard (verified cause):** see §7.
   - **Clarity Capture readings that were silently wrong, now fixed** with regression tests in `packages/capture/test/audit.test.ts`:
     - a purchase "at <store> on my card" was read as a card payment, and "Visa bill" as spending;
     - "3 shirts for 45" produced an extra $3 draft;
     - "$1.234,56" was read as $1.00 and "$1.5k" as $1.50;
     - "50ish" and "$40-50" were taken as exact amounts;
     - "Sunday Market" was read as a date;
     - "cash back" was read as a refund;
     - "transferred $100 to Mom" was treated as an account transfer.
   - **Engine:** 14 new edge-case tests (`packages/engine/test/audit.test.ts`) all passed without changes.

## 7. Hosted web app and content blockers (AdGuard)
- **Symptom:** on the owner's iPhone, the hosted app stayed on "Loading Clarity…" until the site was allow-listed in AdGuard.
- **Cause, reproduced:** AdGuard Tracking Protection (`SpywareFilter/sections/general_url.txt`) has the rule `/clarity-*.js`, meant for Microsoft Clarity's tracker.
  - In AdGuard syntax it matches any URL containing `clarity-` followed later by `.js`.
  - The hostname `clarity-budget-vzhu.onrender.com` therefore makes **all 7 script URLs** match: the app, `boot.js`, the service worker and the workers. CSS, fonts and images still load.
- **How it was verified:**
  - AdGuard's own matching engine (`@adguard/tsurlfilter` 6.1.0) was run on the current AdGuard and EasyList filter sources (215,310 rules, app-only `$app` rules excluded as in Safari).
  - The engine was first checked to block known trackers.
  - The same build on hostnames without `clarity-` (e.g. `claritybudget-…`, `budget-clarity…`) has 0 of 22 resources blocked.
  - This was not checked on the real device with the real AdGuard app.
- **Not the cause:** Clarity's code, CSP, file names or third-party scripts. There are none of those: every request is same-origin.
- **Change made (code only):** the static loading hint, shown by CSS when no script can run, now says a content blocker such as AdGuard may be blocking the scripts and tells the user what to do. There is an end-to-end test for it.
- **Recommended, not done (hosting change, owner decision):** serve the app from a hostname without `clarity-`, for example a renamed Render service or a custom domain. Re-check with the filter lists before switching.

## 7b. Phase 2 (2026-11-14): dashboard verification and desktop UX
- **Projection check:** the Nov 13 sample month-end of $4,077.17 is correct. It includes a $250 transfer to Savings on Nov 30, which the dashboard did not list because "Upcoming" stopped at 14 days. Upcoming now runs through month-end.
- **Safe to Spend** ($2,579.83, low point Nov 18, horizon Nov 30) is correct. The items after the low point are now explained.
- **Transactions:** totals now cover recorded transactions only. Planned (future-dated) items are summed separately and say so, and a scope line states the period and whether filters are active.
- **Layout:** one content width (1,440px max). The chart fills the hero card; date labels are weekly and never collide. Repeated figures are described in words, and status badges are explained.
- **Verification:** Chromium only, at 390, 834, 1280, 1440, 1920 and 2048px (`e2e/phase2.spec.ts`).

## 7c. Phase 3 (2026-11-14): mobile refinement, chart polish, cross-platform consistency
- **Upcoming on phones (web):** full names wrap instead of truncating; the amount and the "Mark paid"/"Record" button share a second line on the right. Checked at 320, 360, 390 and 430px with long names and seven-figure amounts. No horizontal scroll, the title is at least 14px, and buttons are at least 36px tall.
- **Found and fixed:** a seven-figure month-end or shortfall overflowed the card on phones. Headline figures now scale down to fit the card.
- **Chart:**
  - y-axis labels sit in their own gutter, so the "$2,000 over the line" collision at 1280px is gone.
  - The "Lowest" label is placed where it doesn't cross the line. On narrow charts with no clear spot, it moves to a caption above the chart.
  - Tested with sample data on all three ranges at 320–2048px, and with a tiny ($12.34), a large ($1.2M) and a negative balance.
- **Native mobile Home** now shows the same information as web:
  - projected month-end, Safe to Spend (with the after-low note), current recorded balance, lowest projected balance, lowest before next income, and projected end of today;
  - Upcoming (with ≈ and a status help toggle) and Recent transactions;
  - "Why this number?" on each figure.

  Both apps use the shared `buildHomeView`; no calculations are duplicated.
- **Cross-platform tests:** one fixture (`packages/data/test/fixtures/home-sample-nov13.ts`) is asserted by the engine test, the mobile jest test and the web Playwright test. No financial result was changed.
- **Not verified:** physical iPhone/Android, iOS simulator, Safari. The native UI is verified by jest render tests and a successful `expo export` bundle for iOS and Android, not by looking at it on a device.

## 7d. Phase 3A (commit 828adbf): mobile usability and estimate consistency
- **Planning (phones):** rows fit the card at 320–430px. Before: 63px of page overflow at 320px, 23px at 360px, with cut amounts.
- **Transactions (phones, below 760px):** stacked rows (name + amount, then date · category). The account is in the accessible description and the details sheet. Selection and bulk actions work.
- **Touch targets:** 40px hit areas for Why icons and links, and for Budget category names, on phones.
- **Estimates:** Planning shows the forecast figure with ≈ and the user's usual amount. Source: engine `historyEstimate`; no calculation changed.
- **Other changes:**
  - Settings sections wrap so all are visible.
  - Prepare is disabled for blank text.
  - A headers-only CSV is rejected with a clear message.
  - Sample budgets added.
- **Verification:** Chromium e2e `e2e/phase3a.spec.ts` (21 tests), unit tests and a mobile jest test.
- **Known at the time:** `storage.test.ts` failed for a date-dependent reason (fixed in Phase 3C).

## 7e. Phase 3C: accessibility, interaction polish, test reliability
- **Contrast:** dark-mode destructive button now ≥4.5:1 (was 2.28:1).
- **Focus and keyboard:**
  - Add Transaction (and every dialog) returns focus to the button that opened it.
  - The Planning actions menu works from the keyboard (arrows, Home/End, Escape, Tab, click outside).
  - Form errors and hints are linked to their fields (`aria-describedby`, `aria-invalid`).
- **Phone sheets:** footer actions stay on screen at 320×844, 360×640, 390×844 and 430×932, with no content showing below them.
- **Layout and wording:**
  - The empty Transactions state wraps its buttons at 320px.
  - The dashboard uses "Current recorded balance" for the $2,871.23 figure everywhere, including explanations.
  - "Safe to Spend after this purchase" replaces "After this purchase".
  - The phone tab bar is opaque.
  - The Capture box has the standard focus ring.
  - Settings preference fields align.
  - Keyboard hints are decorative (`aria-hidden`).
- **Test reliability:** `apps/mobile/test/storage.test.ts` is deterministic (fixed clock, seeded test-only random bytes, structured ciphertext checks). It passes with the real clock forced to 1794650666199, 1650650650650 and 4102444800000; the old version fails at 1650650650650.
- **Verification:** Chromium `e2e/phase3c.spec.ts` (17 tests) plus the full suites; see the commit message for results.
- **Not verified:** physical devices, Safari, VoiceOver/TalkBack.

## 7f. Phase 4A: Safe to Spend horizon and Upcoming consistency
- **Root cause:** the Safe to Spend horizon ended at this month-end whenever the next fixed paycheck fell before it. Scheduled items after the horizon are dropped from the forecast, so a bill due just after month-end was ignored.
- **Rule now:** the horizon is the later of the end of next month and the first dependable paycheck after this month. Only fixed income counts. Spending Safe to Spend today keeps projected cash at or above the reserve every day through the horizon, if scheduled fixed income arrives.

  | Case | Before | After |
  |---|---|---|
  | B: Nov 28, $1,850.25, no income, rent $1,400 on Dec 1 | $1,850.25 | **$450.25** |
  | A (restated): Nov 20, $1,000 paycheck already received, next pay Dec 4 | $450.25 (already correct by chance) | **$450.25** |
  | A (as audited): Nov 13, $1,000 paycheck Nov 20 before the rent | $1,850.25 | **$1,450.25** |
  | Sample Nov 13 | $2,579.83 | **$2,427.17** |

- **Visibility:**
  - the dashboard lists "Later · also counted in Safe to Spend" with a link to Planning;
  - Planning runs at least to the horizon;
  - the onboarding overview lists counted outflows.

  Native mobile matches.
- **Tests:** `packages/engine/test/safe-to-spend-horizon.test.ts` (16 tests), cross-platform fixture updates, `apps/web/e2e/phase4a.spec.ts` (2 tests) and a mobile jest test.
- **Not verified:** physical devices, Safari, and real users' schedules beyond the tested cases.

## 7g. Phase 4A.2: account-level integrity and disclosure
- **D1 (fixed):** transfers from a non-spendable account are capped at its projected balance; the unfunded part is flagged.

  | Case | Old | New |
  |---|---|---|
  | Audited (checking $300, savings $0, $1,000 transfer Nov 25, rent $1,200 Dec 1) | +$100 | **−$900** |
  | Same with rent $1,400 | −$100 | **−$1,100** |

- **R2:** Safe to Spend remains the combined spendable amount ($200 in the audited case). The dashboard now warns "Cash would go to −$300.00 on Nov 20 … Move $300.00 into Cash before Nov 20", and "Why this number?" states the combining assumption. A user-scheduled top-up clears the warning; nothing is moved automatically.
- **Disclosure:** the end date and paycheck assumption (or "No regular income is scheduled") appear on the Safe to Spend card, with the next payment after the end date. "Can I afford this?" says "Yes, through <date>", with its scope. The month figure is labelled "Lowest balance this month". Planning states what its timeline covers. Web and native mobile match.
- **Duplicates:** engine warning for an unlinked planned transaction matching a scheduled bill; both stay counted. Add Transaction already links matching entries.
- **Tests:** `packages/engine/test/account-integrity.test.ts` (22), `apps/web/e2e/phase4a2.spec.ts` (4), plus the cross-platform fixture and mobile test updates.
- **Not verified:** physical devices, Safari, real-world credit limits, bank-side overdraft behaviour.

## 7h. Phase 4A.4: financial integrity corrections (audit F1–F8)

| Defect | Scenario (audit example) | Before | After |
|---|---|---|---|
| F1 | Checking $1,000, Savings $0, tuition $500 from Savings Nov 20 | $1,000, false "Safe to Spend assumes…" advice | **$500**, "Tuition: Savings can't cover it" |
| F2 | Checking $300, $1,000 advance Nov 20, rent $1,200 Dec 1, no payment / full Dec 15 / Jan 15 / $50 | +$100 / −$900 / +$100 / +$50 | **−$900** in every case, plus an advance warning |
| F3 | $5,000 on Feb 1 / $400 from Savings $0 / $400 from Cash $100 | "Yes" ×3 | "Can't check Feb 1 yet…" / "Only if you move $400.00 into Savings…" / "Only if you move $300.00 into Cash…" |
| F4 | Cash $300 pays $200, $300, $400 | "move $200" only | −$200 Nov 20 and −$600 Dec 5; "move $600" |
| F5 | $300 top-up on the bill day | warning stayed | no warning (Cash ends $0) |
| F6 | $1,000 paycheck into Savings + same-day sweep, rent $800 | short by $800 | $0 (lowest is today) |
| F7 | "Phone Co" $50 vs Gym/Phone $50 | named Gym | names Phone; ambiguous → lists both |
| F8 | Savings at −$100 | "$0.00" | "−$100.00" |

- Same-day order and reasons are in docs/calculation-rules.md ("Same-day order").
- **Tests:**
  - `packages/engine/test/financial-integrity.test.ts`: 38 tests, every audit example, plus a reconciliation check per scenario;
  - `apps/web/e2e/phase4a4.spec.ts`: 2 tests;
  - `apps/mobile/test/financial-integrity.test.tsx`: 1 test, same F1 result as web ($1,927.17).
- **Not verified:** physical devices, Safari, real card terms (interest, fees, limits), bank transfer timing.

## 7i. Phase 4A.4.2: archived accounts, complete warnings, currency safeguards

| Issue | Example | Before | After |
|---|---|---|---|
| Archived account | Checking $1,000; archived account $0 pays rent $800 | $1,000, no warning | **$200**, "Rent: Old checking can't cover it" + archived-items warning |
| Archived account with money | Same, archived account $2,000 | $1,000 | $1,000 (it pays the rent; its balance isn't spendable) |
| Hidden warnings | 6+ warnings | sixth onward shown nowhere | Home: 5 + "N more in Planning"; Planning lists all, with every date |
| Competing transfers | Savings $500 → Holiday $500 and Rent top-up $500 | "other transfers … are paid first" | names Holiday fund, requested/counted/not counted, "cautious assumption" |
| Currency | €500 EUR savings → USD checking, rent $500, checking $100 | +$100 (€ added as $) | **−$400** (nothing arrives in USD), warning |

- **Archiving:** a review (web dialog, mobile screen) lists every active scheduled item. Each item can be kept, moved to another active account, or paused; Cancel changes nothing.
- **Tests:**
  - `packages/engine/test/archived-currency-warnings.test.ts`: 18 tests;
  - `packages/data/test/archive.test.ts`: 7;
  - `apps/web/e2e/phase4a42.spec.ts`: 3;
  - `apps/mobile/test/warnings.test.tsx`: 2.
- **Not verified:** physical devices, Safari, rendering of the routed mobile screens (archive review, Planning list) on a device.

## 7j. Phase 4A.4.4: archived liabilities, card-debt integrity, currency accuracy

| Issue | Scenario | Before | After |
|---|---|---|---|
| Archived overdrawn account | Checking $1,000, Old checking −$500 | $500 active / **$1,000 archived**, no warning | $500 / **$500**, "Old checking is archived and overdrawn by $500.00" |
| Archived card debt | Visa owes $1,000, no payment, archived | warning gone | warning kept, "archiving doesn't clear what it owes" |
| Archived EUR account | archived Euro savings pays €500 | "still counted …" (false); not in currency notice | "in EUR … none of these are counted"; in currency notice |
| EUR card advance into EUR account | €500 | −$500 from USD Safe to Spend | not subtracted |
| Cash advance, payment, later purchases | $500, $90 advance, $400 payment Dec 21, $400 purchases Dec 22 | $190, no disclosure | $190 + "Visa is projected to owe $90.00 on Dec 31…" (purchases before/on Dec 21: $100) |
| Currency display | EUR → EUR transfer | "$500.00 of $800.00" | "€500.00 of €800.00" |
| Grouping | weekly $100 from archived $250 | 5 warnings; "7 scheduled items" | 1 warning, 5 dates, $450; "1 scheduled item" |

- **Tests:**
  - `packages/engine/test/archived-liabilities.test.ts`: 27 tests;
  - `packages/data/test/archive-liabilities.test.ts`: 3;
  - `apps/web/e2e/phase4a44.spec.ts`: 2;
  - `apps/mobile/test/currency-warnings.test.tsx`: 2.
- **Generated scenarios (600, scratch probe):** archiving no longer raises Safe to Spend except through the archived account's own capped transfers out.
- **Not verified:** physical devices, Safari, rendering of the routed mobile archive screen.

## 7k. Phase 4A.5: card liability and archived transfers (owner decisions)

| Scenario (Nov 13, horizon Dec 31) | Before | After |
|---|---|---|
| Checking $1,000; Visa owes $1,000; nothing scheduled | $1,000 | **$0** |
| Same + full-balance payment Nov 25 | $0 | $0 (counted once) |
| $500; $90 advance; $400 payment Dec 21; $400 purchases Dec 22 | $190 | **$100** (Dec 20 / Dec 21: $100, unchanged) |
| $500; $200 card purchase Dec 5; $50 refund Dec 10 | $500 | $350 |
| Sample data + archived card owing $250 | $2,427.17 | $2,427.17 (covered by later income before Dec 31) |
| EUR card owing money | not mentioned | named; "Can I afford this?" qualified |
| Archived $300 → Checking $500 | $300 counted, $200 flagged | unchanged (owner decision) |

- **Tests:** `packages/engine/test/card-liability.test.ts` (21).
- **Changed tests:** 5 existing tests and 1 e2e comment that encoded the previous card rule now carry hand-derived values.
- **Not verified:** physical devices, Safari, real card statement due dates (not modelled).

## 7l. Phase 4A.5.2: Policy B for card debt

| Scenario ($500 checking, card owes $400; Nov 13, horizon Dec 31) | Phase 4A.5 | Policy B |
|---|---|---|
| Payment Nov 25, paycheck Dec 4 | $100 | $100 |
| No payment, paycheck Dec 4 | $500 | **$100** |
| Payment Dec 10 after the paycheck | $500 | $500 |
| $100 partial payment Nov 25 | $400 | **$100** |
| Visa $300 paid Nov 20, Amex $200 paid Dec 20 ($400 checking) | $400 | **$100** |
| Same balances, forecast end Dec 31 → Feb 1 | $100 → $500 | **$100 → $100** |
| Purchases before/on/after a $400 payment; $90 advance before/after | $100 | $100 |
| Sample data + card owing $250, no payment | $2,427.17 | **$2,177.17** |

- **Tests:**
  - `packages/engine/test/card-policy-b.test.ts`: 21;
  - `apps/web/e2e/phase4a52.spec.ts`: 1 (Why this number?, Can I afford this?);
  - `apps/mobile/test/card-explain.test.tsx`: 1.
- **Changed tests:** five unit tests, one e2e assertion and one mobile assertion that encoded the Phase 4A.5 timing now carry Policy B values.
- **Not verified:** physical devices, Safari, real statement due dates (not modelled).

## 7m. Phase 4A.5.4: card credits are not payments

| Scenario (Nov 13, horizon Dec 31) | Phase 4A.5.2 | Now |
|---|---:|---:|
| $500, $400 debt, $200 refund Dec 10 | $300 | **$100** |
| Same + $1,000 paycheck Dec 4 | $300 | **$100** |
| Refund Dec 1, paycheck Dec 10 | $300 | **$100** |
| $600 refund against $400 | $500 | **$100** |
| $400 refund Jan 20 (after the forecast) | $500 | **$100** |
| Two $100 refunds | $300 | **$100** |
| Fixed $50 cashback Nov 15, Dec 15 | $200 | **$100** |
| Visa $400 + $200 refund, Amex $200, $1,000 | $600 | **$400** |
| $300 purchase and $300 refund same day | $500 | **$200** |
| $200 purchase, $50 refund later | $350 | **$300** |
| $200 purchase and $50 refund both posted | $350 | $350 |
| $400 debt, $200 posted refund, $200 payment later | $300 | $300 (owner's table said $100; $100 would count the refunded $200 twice) |
| $400 debt, $200 pending refund, no payment | $300 | **$100** |

- **Tests:** `packages/engine/test/card-credits.test.ts` (27). Two earlier tests that encoded the defect are corrected.
- **Random comparison:** 500 scenarios, all equal to an independent reference model.
- **Not verified:** physical devices, Safari.

## 7n. Phase 4A.5.6: pending cash credits and starting-balance integrity

| Scenario (Nov 13, horizon Dec 31; $500 checking) | Phase 4A.5.4 | Now |
|---|---:|---:|
| $300 pending refund | $800 | **$500** |
| Same, posted | $800 | $800 |
| Pending + $1,000 rent Dec 1, paycheck Dec 4 | −$200 | **−$500** |
| Pending + paycheck Nov 20, rent Dec 1 | $800 | **$500** |
| Pending + $700 bill | $100 | **−$200** |
| Two pending refunds ($100 + $200) | $800 | **$500** |
| Pending $300 cashback | $800 | **$500** |
| Pending $300 into savings, transfer to checking, $600 rent | $200 | **−$100** |
| Pending $300 into savings, $300 savings bill | $500 | **$200** |
| Pending $300 into an archived account overdrawn by $100 | $500 | **$400** |
| Pending €300 into a EUR account | $500 | $500 |
| Cash wallet, pending $200, $200 bill | $500 | **$300** |
| Future-dated pending refund Dec 10, rent $600 Dec 15 | $200 | **−$100** |
| O1: opened at $800 incl. a pending $300, recorded again | $1,100 | **$800** (pending excluded; "Already included" for a posted one) |
| O2: deposit dated before opening | $800 | $800 |
| O3: confirmed $50 purchase on the opening day | $750 | $750 (or $800 with "Already included") |
| O4: pending $300, Update balance to posted $500 | $200 | **$500** (no adjustment) |
| Card pending refund (Phase 4A.5.4 rule) | $100 | $100 |

- **Tests:**
  - `packages/engine/test/pending-credits.test.ts` (33): every case, the lifecycle, explanations, affordability, 300 invariant scenarios and 200 scenarios against an independent model;
  - `packages/data/test/balance-convention.test.ts` (5);
  - `apps/web/e2e/phase4a56.spec.ts` (4): onboarding, pending refund through posting, Update balance, "Already included";
  - `apps/mobile/test/pending-credits.test.tsx` (2).
- **Not verified:** physical devices, Safari. Adjustments made before this phase are not rewritten.

## 7o. Phase 4A.5.8: balance reconciliation and inclusion safeguards

| Audit finding (4A.5.7) | Before | After |
|---|---|---|
| D1 onboarding "-100" | saved +$100 | −$100 ("Short by $100.00") |
| D4 card $50 in credit, Update balance | couldn't be entered; "0" → −$50 adjustment | entered as In credit; exact match confirms; Owed $30 → −$80 |
| D3 pending deposit ticked "Already included" | $800 spendable | refused; box hidden for pending items |
| D9 flag after the balance date (data layer) | honoured silently | refused with a message; engine ignores invalid flags |
| D2 cleared deposit still pending, Update to $800, then post | $1,100 | blocked; Mark posted → $800, no adjustment |
| D2 cleared purchase, same | $300 | blocked; Mark posted → $400 |
| D5 transfer new → old account, ticked | old account $1,000 (lost $200) | $1,200; per-account decision |
| D6 purchase dated Nov 18 entered after the Nov 20 update | $850 | $900 (history, "as of Nov 20") |
| D7 history-only items in lists | no indication | "Already in balance · Nov 20" / "Before account added" |
| D8 matching Update balance | no date recorded | `balanceConfirmedDate` set, no $0 transaction |
| Found: editing a +$40 adjustment | became −$40 expense | refused |

- **Tests:** data `reconciliation-safeguards.test.ts` (40), `reconciliation-ledger.test.ts` (300 random sequences compared with an independent ledger after every step), import (1 new); web `e2e/phase4a58.spec.ts` (7); mobile `test/reconciliation.test.tsx` (4, component tests).
- **Changed expectations:** tests that encoded the defects (4A.5.6 "Already included" on a pending item; O1 legacy flag) now assert the corrected behaviour. No other expectation changed after the owner's "strictly before" decision.
- **Not verified:** physical devices, simulators, Safari, screen readers.

## 7p. Phase 4A.5.9: final reconciliation integrity audit

| Scenario | Before | After |
|---|---:|---:|
| Checking $1,000 + Savings −$50 + Cash $100 | $1,100 | **$1,050** |
| Same + $100 transfer checking → savings Nov 20 | — | $1,000 (debt repaid once, not $950) |
| Archived savings −$50 | $1,100 | **$1,050** |
| Import: pending $300 deposit not on the statement | $690 (then $990 posted) | **$990** (then $1,290) |
| Import: pending $120 purchase not on the statement | $990 | **$870** |
| Import: pending deposit cleared, bank's own description | duplicate + −$300 adjustment | row flagged; Mark posted → $1,290, no adjustment |
| Update balance +$200 with a $300 pending deposit | recorded silently | named as possible partial match; confirmation needed |

- **Tests:** engine `savings-liability.test.ts` (16, incl. 300 random scenarios vs an independent model); data `import-reconciliation.test.ts` (17: import, partial matches, transfers); the 4A.5.8 ledger now includes partial matches and negative savings; web `e2e/phase4a59.spec.ts` (3); mobile component test (1 more).
- **Changed expectations:** 4 tests that encoded the old savings rule; 1 that encoded "partial match not flagged".
- **Not verified:** physical devices, simulators, Safari, screen readers.

## 7q. Phase 4A.5.10: statement-import duplicate protection

| Sequence | Before | After |
|---|---:|---:|
| $300 pending deposit; statement row included anyway; then pending marked posted | $1,590 (counted twice) | refused without a decision |
| Same, "Same transaction" chosen | — | $1,290; one deposit, posted once, linked |
| Same, "Different transaction" chosen | — | both kept; $1,290 now, $1,590 when the second posts (two real deposits) |
| Re-import after either decision | — | "Already matched" / "Already imported"; nothing added |
| Undo an import with a match | — | the transaction returns to pending; link removed |
| 4 pending deposits ($100+$50+$50+$50) vs a +$250 difference | asked (all named) | asked; wording no longer implies an exhaustive search |

- **Tests:** data `import-reconciliation.test.ts` (+12: resolution flows, purchases, transfers, edit/delete/undo, re-import, multiple twins, 4+ item combinations, no cap); web `e2e/phase4a510.spec.ts` (2); wording updates in 4A.5.9 web/mobile tests.
- **Not verified:** mobile import review rendering (component test not added; covered by shared data tests and type checks), devices, Safari.

## 7r. Phase 4A.5.12: statement matching, duplicate prevention, transfer integrity

| Audit case (4A.5.11) | Truth | Before | After |
|---|---:|---:|---:|
| F1: two pending $300 refunds; the row is B; A offered | $1,300 | $1,600 | **$1,300** (both listed, user picks B) |
| F2: unrelated $300 row paired first (oldest-first file) | $1,600 | $1,900 | **$1,600** (both rows list the refund) |
| F3: pending $300 deposit clears as $290 | $1,290 | $1,590 | **$1,290** (listed, −$10 difference shown and recorded) |
| F6: pending $50 dinner clears as $60 | $940 | $890 | **$940** |
| F4: existing transfer, savings statement 3+ days later | savings $600 | $700 | **$600** (linked to the leg) |
| F5: other side of a matched transfer | $900 / $600 | $800 / $700 | **$900 / $600** |

- **Rules:** see calculation-rules.md, "Statement matching (Phase 4A.5.12)": windows (pending −3/+10 days, transfer legs −3/+7 days, `MATCH_WINDOWS`), same direction, no amount tolerance, ordering, explicit choice, authoritative data-layer re-check.
- **Tests:** data `statement-matching.test.ts` (24, incl. 400-run randomized comparison: 380 runs with statement rows, 380 correct, 0 incorrect; 421 ambiguous rows); `import-reconciliation.test.ts` updated to the candidate model; web `e2e/phase4a512.spec.ts` (3, with screenshots) and updated 4A.5.9/4A.5.10 specs; mobile `test/import-matching.test.tsx` (2, the real import screen with the file picker mocked).
- **Not verified:** physical devices, simulators, Safari.

## 7s. Phase 4A.5.14: independent transfer settlement and reconciliation integrity

Owner policy: each transfer leg settles on its own; money in transit isn't spendable until the receiving bank posts it, and money going out counts at once; transfer fees are explicit; undo reverses only its own leg and its own changes; stale pending items stay discoverable; stale or conflicting commits from other tabs are refused.

| Audit case (4A.5.13) | Truth (each bank) | Before | After |
|---|---:|---:|---:|
| D1: checking statement links the checking leg; savings not yet posted | savings posted $1,000 | $1,100 | **$1,000** (savings leg stays pending) |
| D1 (A1b): savings deposit posts 9 days later; user follows the hint | checking $1,100 / savings $900 | $1,200 / $800 (second transfer) | **$1,100 / $900** (leg still pending, listed, linked) |
| D2: savings → checking $100 pending at checking | Safe to Spend $1,000 | $1,100 | **$1,000** |
| D2 (A3): savings −$50, $100 on its way in | $850 | $900 | **$850** |
| D3: undo savings import after both legs were linked | checking posted $1,100 | $1,000 (stuck) | **$1,100** (checking link untouched) |
| D4: check entered Sep 2, cashed Sep 17 | $800 | $600 (silent) | **$800** (stale candidate, linked) |
| D5: linked dinner edited $50 → $55, statement re-imported | $940 | $885 | **$940** (row recognised) |
| D6: $100 sent, $95 received | checking −$100, savings +$95 | second transfer offered | **transfer $95 + fee $5**, one transfer |
| D7: Pending ticked, then Transfer | visible state | hidden pending transfer | **visible Status choice** (web and mobile) |
| D8: link-only import | "0 new, 1 linked" | "Imported 1 transaction" | **"0 new transactions imported · 1 existing transaction linked …"** |
| D9: two tabs commit against the same data | one link, no duplicate | last write wins | **second commit refused, tab refreshed** |

- **Rules:** see calculation-rules.md, "Transfer settlement (Phase 4A.5.14)" and the 4A.5.14 additions under "Statement matching".
- **Data model:** optional fields only, so no migration is needed; existing data is valid (legs had equal statuses).
- **Storage:** `StorageAdapter.loadRevision` and `writeRowsIfRevision` provide an atomic compare-and-write over the rows and the revision.
  - Dexie runs it as one read-write transaction over the rows and meta stores; SQLite as an exclusive transaction.
  - `WorkspaceStore.apply` refuses with `StaleDataError` and reloads the latest data. A restore gives the store a new revision.
- **Tests (all after the final code change):**
  - **Unit:** vitest 603 passed, 1 skipped. New: `packages/data/test/transfer-settlement.test.ts` (35 tests, D1–D9 plus every requested case) and `settlement-ledger.test.ts`, a 250-run randomized comparison with independent bank ledgers, checked after every action.
    - Randomized result: 250 correct, 0 mismatches. Coverage: 1,694 imports, 1,400 ambiguous rows, 391 rows with stale candidates, 153 fees confirmed, 158 undos, 120 stale commits refused, 84 manual postings, 0 rows whose transaction wasn't listed.
    - Updated to the owner's policy: engine `pending-credits` and `card-credits` tests, data `reconciliation-ledger` (independent model: per-leg), `statement-matching` and `import-reconciliation`.
  - **Mobile:** jest 51 passed. New: `apps/mobile/test/transfer-settlement.test.tsx` (5 tests, the real screens in Node) and a SQLite guarded-write test in `storage.test.ts`.
  - **Browser:** Playwright 170 passed, 10 skipped (Chromium, production and test-mode builds). New: `e2e/phase4a514.spec.ts` (5) and `e2e/phase4a514-test-mode.spec.ts` (two real tabs on one IndexedDB vault).
  - **Checks:** typecheck and lint clean; mobile `tsc` clean; iOS and Android bundles exported.
- **Not verified:** simulator, physical device, Safari, Firefox, screen reader; multiple tabs outside Chromium.

## 7t. Phase 4A.5.15: card payments in transit counted once

| Case (checking $1,000, card owes $500, no payment scheduled) | Truth | 4A.5.14 | After |
|---|---:|---:|---:|
| $200 payment pending at both banks | $500 | $300 (counted twice) | **$500** |
| Checking posted, card issuer not yet | $500 | $300 | **$500** |
| Card issuer posted, checking pending | $500 | $500 | **$500** |
| Owes $100, pays $300 (overpayment) | $700 | $500 | **$700** (the $200 credit isn't spendable) |
| Pending $100 refund on the card (not a payment) | $500 | $500 | **$500** (still held back) |

- **Root cause:**
  - `pendingCreditTotal` adds a card's pending credits back to its debt (Phase 4A.5.4, for refunds).
  - Since 4A.5.14 that included the card side of a pending payment, whose checking side was already counted.
  - Future-dated pending payments had the same problem in the forecast.
- **Fix:** `isCardPaymentInTransit` (engine/balances.ts) is used by every calculation, plus a "Why this number?" line (`Forecast.cardPaymentsInTransit`). This is a reservation rule only: no status, posted balance, id or link changes.
- **Tests (after the final code change):**
  - **Unit:** vitest 623 passed, 1 skipped, including all 4A.5.14 transfer-settlement and reconciliation tests. New: `packages/data/test/card-payment-transit.test.ts`, 20 tests including a 300-run randomized model (3,600 steps; Safe to Spend never moved when either leg posted; recorded balances unchanged by posting).
    - Updated to the policy: the card-credits engine test ($100, counted once) and the `reconciliation-ledger` model (a card payment in transit isn't a pending credit).
  - **Mobile:** jest 52 passed. New: `apps/mobile/test/card-payment-transit.test.tsx`, the explanation screen in Node.
  - **Browser:** Playwright 171 passed, 10 skipped (Chromium, production and test-mode builds). New: `e2e/phase4a515.spec.ts` (Safe to Spend, "Why this number?", card side posted).
  - **Checks:** typecheck and lint clean; mobile `tsc` clean; iOS and Android bundles exported.
- **Limitations:**
  - A failed or reversed payment counts as on its way until it is deleted or its import undone.
  - Not verified on simulators, devices, Safari or with a screen reader.

## 7u. Phase 4A.5.17: pending opening-balance items and returned card payments (audit 4A.5.16 F1–F4)

| Case (hand-calculated truth) | Truth | Before | After |
|---|---:|---:|---:|
| E2: checking added Sep 12 at $1,000 posted; Visa owes $500; $200 payment of Sep 10 pending at both | $500 | $700 | **$500** |
| E1: Visa added Sep 12 owing $500 posted; same payment | $500 | $300 | **$500** |
| Pending $200 purchase dated before checking was added (opened at $1,000 posted) | $800 | $1,000 | **$800** |
| F1: payment debit and its return on the checking statement, return imported as suggested | $500 | $700 (imported as income by default) | **$500** (return offered on its row, never selected by default; once confirmed: Visa owes $500, money back, not income) |

- **F2:** `inOpeningBalance` (engine/balances.ts). The opening balance is the posted balance, so pending items from before the opening date count and keep counting after they post (a `postedDate` is recorded). The "Before account added" reason is reworded.
- **F1:**
  - Return candidates (`findMatchCandidates` with accounts): exact opposite amount, same account, 0–30 days, any status; the description only ranks.
  - The confirmed return is a transfer back (`returnOf`); the payment is no longer in transit.
  - When the issuer never posted the payment, the two card-side legs cancel (`isVoidedReturnLeg`).
  - A payment's debit and its return can be in the same statement.
  - Undo, re-import and stale commits are covered.
- **F3:** the in-transit line in "Why this number?" says what to do if the payment is returned or rejected, matching the import workflow.
- **F4:** card payments say "Sent · awaiting posting by Visa"; bank transfers keep "awaiting deposit".
- **Tests (all after the final code change):**
  - **Unit:** vitest 647 passed, 1 skipped. New: `packages/data/test/returned-payments.test.ts` (24 tests, including a 300-run randomized model of pending opening-date items, returns, undo and re-import). Updated to the policy: one statement-matching expectation and the `reconciliation-ledger` model (pending pre-opening items count).
  - **Mobile:** jest 54 passed (new: 2 component tests in `test/transfer-settlement.test.tsx`).
  - **Browser:** Playwright 173 passed, 10 skipped (Chromium; new `e2e/phase4a517.spec.ts`, 2 tests with a screenshot).
  - **Checks:** typecheck and lint clean; mobile `tsc` clean; iOS and Android bundles exported.
- **4A.5.16 audit probes re-run:** E1 and E2 fixed. The return-as-income import is now refused without a decision. All 16 settlement transitions and the earlier protections are unchanged. The audit's randomized model: 400 scenarios, 4,194 actions, 0 mismatches.
- **Limitations:**
  - A return typed in by hand as income isn't detected.
  - Partial returns (a different amount) aren't offered.
  - The return row still shows the Type/Category pickers, which are ignored for a return.
  - Not verified on simulators, devices, Safari or with a screen reader.

## 7v. Phase 4A.5.18: returned-payment safeguards (manual entry, partial and older returns; opening correction)

| Case (checking $1,000, Visa owes $500, $200 payment pending at both; truth by hand) | Truth | Before | After |
|---|---:|---:|---:|
| The returned $200 typed in by hand as income | $500 | $700 (separate income) | **$500** (the form asks; return recorded) |
| $80 of the $200 returned (statement or by hand) | $500 | not offered (exact amounts only) | **$500** (checking $880, Visa $380, $120 still on its way) |
| $80 + $70 + $50 returned; then another $60 | $500; refused | n/a | **$500**; the fourth is refused ("only $50.00 … left to return" before the last) |
| Payment of Sep 1 returned Oct 12 ("DEPOSIT") | $500 | treated as income | **$500** once the user picks it (not suggested without evidence) |
| Pending $200 dated before checking was added, already posted then | $1,000 | $800 | **$1,000** after "It had already posted when I added Checking" |

- **Representation:** the 4A.5.17 transfer back (`returnOf`) carries partial returns too. Engine: `returnedWhileUnposted` and `effectiveAmount`; returns are capped by `paymentReturnStatus`.
- **Manual entry:** `returnOptionsForEntry` and `recordPaymentReturn` (also corrects an existing income transaction, keeping its statement identity). Web and mobile Add/Edit require a decision when a return is plausible.
- **Review rows:** a confirmed return hides type and category and says what is recorded; the button reads "Record N returned payment(s)".
- **Deletion:** deleting a payment deletes its returns.
- **Tests (all after the final code change):**
  - **Unit:** vitest 667 passed, 1 skipped. New: `packages/data/test/return-safeguards.test.ts` (20 tests, including a 300-run randomized model of full and partial, manual and imported returns with undo). One 4A.5.17 test updated: with "RETURNED" in the description, partial and older returns are now offered.
  - **Mobile:** jest 55 passed (new: the Add form's return decision; one older test updated for the new button text).
  - **Browser:** Playwright 176 passed, 10 skipped (Chromium; new `e2e/phase4a518.spec.ts`, 3 tests with screenshots).
  - **Checks:** typecheck and lint clean; mobile `tsc` clean; iOS and Android bundles exported.
  - **Earlier audit:** the 4A.5.16 randomized model (scratchpad) still shows 0 mismatches over 4,194 actions.
- **Limitations:**
  - Returns entered through Clarity Capture or recurring confirmation aren't checked.
  - The opening correction is for non-transfer items only (a transfer leg uses the statement-link route).
  - Not verified on simulators, devices, Safari or with a screen reader.

## 7w. Phase 4A.7: transaction lifecycle integrity (audit 4A.6 H1, H2, H3, M1, M2)

| Case (checking $1,000, Visa owes $500, $200 payment; truth by hand) | Truth | Before (77f8fc9) | After |
|---|---:|---:|---:|
| H1: the returned $200 entered through Clarity Capture | $500 | $700 (saved as income) | **$500** (Capture asks; return recorded) |
| H2: undo the import that created the payment, after its return | refused or consistent | checking $1,200, Visa $700, orphaned return | **refused**, nothing changed; allowed once the return is removed |
| H3: fully returned $200 payment edited to $100 | refused | $600 ($100 created) | **refused**, $500 |
| M2: returned payment's card changed Visa → Savings | refused | Visa $700, Savings $200, $300 | **refused**, $500 |
| M1: delete a payment that has an imported return | refused | return silently deleted; "Removed 0 imported transactions" | **refused**, history and links intact |

- **Policy (as specified):** refuse unsafe actions; never auto-delete a return to make an action succeed. Rules: `docs/calculation-rules.md` ("Returned payments: lifecycle integrity").
- **Data layer (both apps):**
  - `deleteProblem` and `deleteTransactions`;
  - `returnEditProblem` in `updateTransaction`, which also keeps `returnOf` on edited returns;
  - the dependent-return check in `importUndoProblem`;
  - `saveCaptured`, which refuses undecided captured income;
  - `recordPaymentReturn` provenance.
- **Capture:** `draftReturnOptions`, `chosenReturnOf`, `toCaptureItem`, and the issues `possible_return` / `return_unavailable`. Web and mobile Capture show the same choice as the Add form.
- **Data model:** no schema change and no migration.
- **Superseded:** 4A.5.18's "deleting a payment deletes its returns". One existing test was updated to the new policy, with hand-calculated values.
- **Tests (all after the final code change):**
  - **Unit:** vitest 699 passed, 1 skipped (41 files).
  - New unit files:
    - `packages/data/test/lifecycle-integrity.test.ts`: 20 tests covering undo, edit, delete, re-import, two-tab stale undo, and multiple returns.
    - `packages/capture/test/capture-returns.test.ts`: 11 tests covering full, partial, multiple payments, genuine income, several items, draft edits, settlement orders, the data-layer refusal, and that the interpreter can't decide.
    - `packages/capture/test/lifecycle-randomized.test.ts`: the randomized model below.
  - **Mobile:** jest 61 passed (16 suites). New: 3 Capture return tests and `test/lifecycle-integrity.test.tsx` (3 delete tests).
  - **Browser:** Playwright 179 passed, 10 skipped (Chromium). New: `e2e/phase4a7.spec.ts`, 3 tests covering a Capture return, several items with "separate income", and a refused delete in the Edit dialog and in the list.
  - **Checks:** root, web and mobile typechecks clean; lint clean; iOS and Android bundles exported.
- **Randomized independent model:**
  - **Scale:** 300 scenarios, 3,440 actions, 308 expected refusals verified to change nothing.
  - **Result:** 0 mismatches in Safe to Spend or checking balance, and 0 orphaned returns. There is no re-sync, so any mismatch would fail the test.
  - **Mutation check:** disabling the undo, delete or edit guard makes it fail.
  - This is evidence, not proof.
- **Limitations:**
  - After the user explicitly deletes an imported return and then its payment, re-importing the return statement offers the row as income (the file is flagged as already imported, but the row isn't).
  - In Capture, the Category field stays visible after "It's the return" is chosen. It is not saved: a return has no category.
  - Not verified on simulators, devices, Safari or with a screen reader.

## 7x. Phase 4A.8: same-statement card returns and import integrity (audit 4A.7.1 N1–N4)

| Case (checking $1,000, Visa owes $500; truth by hand) | Truth | Before (57ee9a5) | After |
|---|---:|---:|---:|
| N1: first import of a statement with "PAYMENT TO VISA −$200" and "RETURNED PAYMENT +$200", payment marked as card payment | $500 (checking 1,000, Visa 500) | $700 (return imported as a refund, selected by default) | **$500**: return unselected until confirmed, then recorded as the payment's return |
| N1: the same after the user deleted both and re-imports | $500 | $700 | **$500** (same pairing) |
| N2: $200 payment fully returned; Visa statement shows $150 received, linked with a $50 fee | refused | accepted: payment $150, $200 returned, Visa $550, $450 | **refused**, nothing changed (no fee option; the commit refuses a direct attempt) |
| N4: "PAYMENT TO VISA" | a card payment | an expense | a transfer with Visa suggested, unselected until confirmed |
| N3: Capture return with a category chosen | no category | Category shown (not saved) | Category hidden, still not saved |

- **Rules:** `docs/calculation-rules.md` (Phase 4A.8 bullets).
- **Data model:** no schema change and no migration.
- **Tests (all after the final code change):**
  - **Unit (vitest):** 738 passed, 1 skipped.
    - `packages/data/test/statement-returns.test.ts`: 37 tests covering N1, N2 and N4, including ambiguous rows, either row order, rejection, stale and two-tab commits, undo and re-import, independent posting, partial and multiple returns, the fee limit and a direct fee attempt.
    - `packages/data/test/statement-randomized.test.ts`: the model below.
    - Capture N3 equivalence test added.
  - **Mobile (jest):** 63 passed. New: `test/statement-returns.test.tsx` (2 tests) and Capture Category assertions.
  - **Browser:** Playwright 183 passed, 10 skipped (Chromium). New: `e2e/phase4a8.spec.ts`, 4 tests with screenshots covering pairing, a rejected pairing, the refused fee and Capture.
  - **Checks:** root, web and mobile typechecks clean; lint clean; iOS and Android bundles exported.
- **Randomized independent model:**
  - **Scale:** 300 scenarios, 3,709 actions, including:
    - 896 same-statement pairings and 178 rejected pairings;
    - 331 fees and 142 refused fees;
    - 319 refusals in total, each verified to change nothing.
  - **Result:** 0 mismatches in checking, Visa owed and Safe to Spend, 0 orphaned returns, and returns never exceeded a payment.
  - **Mutation check:** disabling the matching guard, the commit checks, or the pairing makes the tests fail.
  - **Coverage:** the 4A.7 lifecycle model still passes.
  - This is evidence, not proof.
- **New finding (pre-existing, not fixed):** the review pre-ticks a scheduled-item link by amount and date even for a card-payment row matched to a bill. In the sample data, Electricity overstated Safe to Spend by $91.40.
- **Limitations:**
  - Pairing within card statements isn't implemented.
  - A return statement re-imported alone, after deleting a payment that was in a separate file, still offers the row as new money.
  - Not verified on simulators, devices, Safari or with a screen reader.

## 7y. Phase 4A.9: scheduled-item import matching integrity

| Case (sample data, Nov 13; Electricity: variable, estimated $91.40, due Nov 18) | Truth | Before (7a95975) | After |
|---|---:|---:|---:|
| "PAYMENT TO STORE CARD −$100" and its return (Store card owes $250) | $2,177.17 | $2,268.57: linked to Electricity by default, the bill dropped from the forecast | **$2,177.17**: a card payment can't settle a bill; no suggestion |
| "ONLINE PMT 7781 −$100" (no payee) | $2,327.17 | $2,418.57 (linked by default) | **$2,327.17**: suggested as "Electricity?", not ticked |
| "CITY ELECTRICITY CO −$91.40" | $2,427.17 (bill paid) | $2,427.17 | **$2,427.17**: strong (the name is in the description), ticked |
| Rent $300 due Sep 15; unrelated "TARGET 0912 −$300" (checking $1,000) | $100 | $400 (linked, overstated by $300) | **$100** |

- **Root cause:** `suggestOccurrenceMatch` used amount and date only, and the review and the Add form ticked the link. A link marks the occurrence confirmed and removes it from the forecast.
- **Policy:**
  - Eligibility now also requires the kind to fit.
  - Only strong suggestions are ticked: evidence (the item's name in the description, or the same payee linked before) and no equally good alternative.
  - Weak ones are explained and stay unticked.
  - `commitImport` re-validates every link against the current schedule: the item still exists, the occurrence is unpaid and not skipped, it is linked by only one row, and it still fits the row.
  - `addTransaction` / `updateTransaction` refuse links to missing, other-account or already-recorded occurrences.
- **Data model:** no schema change and no migration.
- **Tests (all after the final code change):**
  - **Unit (vitest):** 759 passed, 1 skipped. New: `packages/data/test/scheduled-matching.test.ts`, 21 tests covering:
    - unrelated payee; far date; different amount; no match;
    - two items with the same amount; similar names; equally close occurrences; one-time items; history evidence; kind fit;
    - the original sample discrepancy;
    - already paid, changed, skipped or deleted items;
    - a forged ineligible link; two rows on one occurrence; two tabs;
    - undo and re-import; linking later; Mark paid on a recorded occurrence; the 4A.8 pairing alongside a link.
  - **Mobile (jest):** 66 passed. New: `test/scheduled-matching.test.tsx` (3 tests: review weak and strong; Add form).
  - **Browser:** Playwright 186 passed, 10 skipped (Chromium). New: `e2e/phase4a9.spec.ts` (3 tests with screenshots).
  - **Checks:** root, web and mobile typechecks clean; lint clean; iOS and Android bundles exported.
  - **Mutation check:** making every suggestion strong, or removing the commit check, makes 7 and 3 tests fail.
- **Limitations:**
  - There is no "link this existing transaction to that occurrence" button. "Mark paid" on an occurrence already paid by an unlinked import still adds a second transaction.
  - Name evidence is word-based.
  - Not verified on simulators, devices, Safari or with a screen reader.

## 7z. Phase 4A.10: link existing transactions to scheduled items

| Case (checking $1,000; Rent $300 due Sep 15 and Oct 15; today Sep 12) | Truth | Before (18e124b) | After |
|---|---|---|---|
| $300 rent imported unlinked, then Mark paid | Checking $700; spending $300; Safe to Spend $400 | Checking $400; spending $600; Safe to Spend $100 (a second $300 added) | **Checking $700; spending $300; Safe to Spend $400**: the existing payment is linked; nothing added |
| Sample: $65 "Verizon Wireless" today, then Mark paid on Phone ($65, Nov 22) | $2,427.17 | $2,362.17 (second $65) | **$2,427.17** (linked) |
| Unlink | the bill is due again | n/a | Safe to Spend back to $100 or $2,362.17 |

- **Rules:** `docs/calculation-rules.md` ("Linking an existing transaction to a scheduled item").
- **Data model:** no schema change and no migration.
- **Tests (all after the final code change):**
  - **Unit (vitest):** 774 passed, 1 skipped. New: `packages/data/test/occurrence-linking.test.ts`, 15 tests covering:
    - the original scenario; genuine vs unrelated; the amount-fit filter;
    - other account, refund, income, transfer, outside 31 days; pending stays pending; a scheduled transfer;
    - one-to-one rules and explicit reassign; two occurrences of a bill;
    - deleted, paused or skipped items; two tabs;
    - unlink; description and amount edits; account and refund edits refused;
    - single and bulk delete plus undo; import undo and re-import.
  - **Mobile (jest):** 68 passed. New: Mark paid link and Unlink tests in `test/scheduled-matching.test.tsx`.
  - **Browser:** Playwright 189 passed, 10 skipped (Chromium). New: `e2e/phase4a10.spec.ts`, 3 tests with screenshots covering linking, "record a new payment", and no candidates.
  - **Checks:** root, web and mobile typechecks clean; lint clean; iOS and Android bundles exported.
  - **Mutation check:** allowing an occurrence to be recorded twice, or skipping the kept-link check on edits, makes the tests fail.
- **Limitations:**
  - Links start from the scheduled item only (Mark paid). There is no "link to a scheduled item" action from a transaction.
  - A payment more than 31 days from its due date can't be linked.
  - Not verified on simulators, devices, Safari or with a screen reader.

## 7aa. Phase 4A.11: overdue payment linking and orphaned-link recovery (audit of 4A.10, D1 and D2)

| Case (hand-calculated) | Before (414ae36) | After |
|---|---|---|
| Rent $300 overdue (Aug 15), paid Sep 18 (34 days late); today Sep 20; checking $1,000 | Can't be linked; Mark paid shows the plain form → a new $300: checking $400, −$200 (truth $100) | **Show older transactions** lists it ("34 days after the due date", unselected) → linked: checking $700, no new transaction, **$100** |
| Rent moved 15th → 20th after its payment was linked | Stale link, no explanation; the payment not offered for Sep 20 | Edit form: "no longer on the schedule" + Unlink → payment unchanged; Mark paid Sep 20 links it → $400 |
| Bill deleted after linking | No Unlink in the Edit form (dead end) | "scheduled item was deleted" + Unlink; a re-created bill doesn't inherit the link |
| Sample, Jan 10 2027: Rent $1,450 due Dec 1 paid Jan 8 (38 days) | Couldn't be linked | Linked: recorded balance unchanged ($1,421.23); "Short by" $2,986.89 → $1,536.89 (+$1,450) |

- **Rules:** `docs/calculation-rules.md` ("Late payments and orphaned links").
- **Data model:** no schema change and no migration.
- **Tests (all after the final code change):**
  - **Unit (vitest):** 782 passed, 1 skipped. New: `packages/data/test/overdue-linking.test.ts`, 8 tests covering:
    - the audit case; Skip vs a new payment; unrelated older transactions unselected;
    - the 62-day cap and overdue-only; a pending payment stays pending;
    - one-to-one rules; a skip after the list opened; two tabs;
    - schedule edit; deleted bill and re-created bill; an invalid link.
  - **Mobile (jest):** 70 passed. New: Show older transactions, and deleted-bill Unlink.
  - **Browser:** Playwright 191 passed, 10 skipped (Chromium). New: `e2e/phase4a11.spec.ts`, 2 tests with screenshots.
  - **Checks:** root, web and mobile typechecks clean; lint clean; iOS and Android bundles exported.
  - **Mutation check:** allowing "older" for non-overdue occurrences, or removing the 62-day cap, makes the tests fail.
- **Limitations:**
  - Bills older than the 62-day overdue lookback can't be linked.
  - An "invalid" link still counts as paid until it is unlinked.
  - Not verified on simulators, devices, Safari or with a screen reader.

## 7ab. Phase 4B.1: small product experience improvements (from the Phase 4B audit)

Wording, spacing and duplicate actions only; no calculation or data change. Checkpoint `phase4b1-checkpoint-before` (f7bcb82).

| # | Change | Where |
|---|---|---|
| 1 | "comes … it doesn't" when one item follows the low point; "come … they don't" otherwise | `packages/engine/src/plan.ts` (text only) |
| 2 | 8px gap between the Safe to Spend explanation and "Next after …" (was −6px) | `apps/web/src/styles/base.css` `.sts-note` |
| 3 | Home header "Add Transaction" removed. Still available: sidebar, tab bar "+", `N`, the empty-state button | `apps/web/src/features/Home.tsx` |
| 4 | Default-account note said once per Capture batch (2+ drafts); one draft keeps its own | `packages/capture/src/review.ts`, web and mobile `Capture.tsx` |
| 5 | Onboarding balance question: short line plus an accessible "More about this balance" disclosure with the unchanged full hint | `packages/shared/src/terms.ts`, web and mobile `Onboarding.tsx` |

Tests:
- **New:**
  - `packages/capture/test/batch-notes.test.ts` (4);
  - `packages/data/test/sts-wording.test.ts` (1; hand-checked: low $2,400 on Nov 15, $5,400 in and $1,200 out after it through Dec 31);
  - `apps/mobile/test/phase4b1.test.tsx` (2);
  - `apps/web/e2e/phase4b1.spec.ts` (3).
- **Updated on purpose:** `phase3c.spec.ts` and `phase4a56.spec.ts`.

## 7ac. Phase 4B.2: Home hierarchy and clarity

Home only; no calculation or data change. Checkpoint `phase4b2-checkpoint-before` (b028023).

| Before | After |
|---|---|
| Headline: Projected month-end $4,077.17; Safe to Spend beside it; recorded balance in a row of 4 small figures | Headline: Current recorded balance $2,871.23; Safe to Spend beside it (desktop) or right after it (one column); month-end $4,077.17 as a supporting figure above the chart |
| "Lowest balance this month $2,779.83 · Nov 18 · through month-end" and, in the Safe to Spend breakdown, "Lowest point · Dec 1 $2,627.17" | "Lowest balance this month $2,779.83 · Nov 18 · through Nov 30" and "Lowest through Dec 31 · Dec 1 $2,627.17" |
| Lowest before next income $2,779.83 ("Same low point…") and Projected end of today $2,871.23 ("Nothing else is scheduled today"), greyed | Hidden (they repeat this month's low and the recorded balance) |
| First run: $2,400.00 shown 7 times | Balance and Safe to Spend (plus the chart's low label) |
| Safe to Spend card: 6-row breakdown and a 2–3 line "after the low point" sentence | In "Why this number?" (the engine's lines, with that sentence added to the summary) |
| Shortfall (Jan 10, 2027): −$1,336.89 shown 4 times | Once, on the Safe to Spend card ("Lowest through Feb 28 · Jan 10"); Short by, its status and the not-counted income stay on the card |

Tests:
- **New:**
  - `packages/data/test/home-hierarchy.test.ts` (4, hand-calculated: three different lows; first run; a bill due today; a shortfall);
  - the mobile `home.test.tsx` hierarchy and shortfall cases;
  - `apps/web/e2e/phase4b2.spec.ts` (5).
- **Updated on purpose** (behaviour changed): the shared fixture `home-sample-nov13.ts`, `home-view.test.ts`, mobile `home.test.tsx`, and the e2e specs `phase2`, `phase3`, `phase3a`, `phase3c`, `phase4a2`, `phase4a11`, `phase4b1` and `redesign`.

## 7ad. Phase 4B.3: Paid history in Planning

A collapsible "Paid this month" section on web and mobile Planning. Checkpoint `phase4b3-checkpoint-before` (62766e9).

- **Source:** `paidThisMonth` (shared) reads the engine's own "confirmed" occurrences and their linked transactions. Nothing is recorded or calculated.
- **Each row shows:** item, paid or received date (the transaction's), due date when different, amount, account (→ other account), and status ("Posted", "Pending", or the existing transfer wording). Selecting a row opens the normal Edit form.
- **Sample data (Nov 13):** Rent (paid Nov 1), Paycheck (received Nov 5), Streaming (paid Nov 9, Visa Card).
- **Hand-checked test case** (Checking $2,000 on Nov 29; the rows below, oldest first):
  - Rent (Oct 15), paid late on Nov 3;
  - Cleaner (Nov 9), paid on its due date;
  - Rent (Nov 15), paid early on Nov 12;
  - Cleaner (Nov 16), pending;
  - Paycheck received Nov 20;
  - Savings transfer on Nov 25;
  - Visa payment (Nov 27), sent Nov 26, "Sent · awaiting posting by Visa".
  - Not listed: the Nov 2 Cleaner (paid Oct 30), and the unpaid Nov 23 and Nov 30 Cleaners.
  - Unlink, delete, skip and undoing an import each remove the entry; balances and Safe to Spend are unchanged.

Tests:
- `packages/data/test/paid-history.test.ts` (5). Mutation checks: removing the skip rule or the month rule each fails a test.
- `apps/mobile/test/paid-history.test.tsx` (2).
- `apps/web/e2e/phase4b3.spec.ts` (3). The unlink case checks that Safe to Spend stays $2,267.17: after the early card payment the low point moves to Nov 18, before the Nov 19 paycheck, so the Phone bill due Nov 22 doesn't lower it.

## 7ae. Phase 4B.4: overdue-item catch-up

Checkpoint `phase4b4-checkpoint-before` (c0cadeb). No engine, calculation or data-model change.

- **Home (web and mobile):** past-due items leave the Upcoming list and become one "Past due" line with Review. Example: on Jan 10, 2027 with nothing recorded since Nov 13, Home showed 16 overdue rows; it now shows "16 items since Nov 18 need a decision".
- **Planning (web and mobile):** a "Catch up" review grouped by item. Each row has the existing Mark paid / Record (which can link an existing payment) and Skip, one occurrence at a time. A per-item past-due warning is no longer repeated in Needs attention.

Tests:
- **`packages/data/test/catch-up.test.ts` (6, hand-calculated):**
  - 10 past-due items after six weeks (8 bills, 2 paychecks);
  - an unlinked $65 payment isn't assumed; linking it resolves only Nov 22, and Dec 22 is still expected;
  - a pending payment stays pending; skip affects one occurrence;
  - a transfer and a card payment;
  - a long absence (62-day window: 10 items since Dec 15 on Jan 31);
  - one item, then resolved, and an empty workspace.
- **`apps/mobile/test/catch-up.test.tsx` (3).**
- **`apps/web/e2e/phase4b4.spec.ts` (3):**
  - one item resolved with Safe to Spend unchanged (the $91.40 counted as owed is now recorded);
  - 16 items: linking the Jan 8 $1,450 payment to the Jan 1 rent raises Safe to Spend by exactly $1,450.00, with one transaction only; skipping one Streaming leaves the other;
  - 390px, plus the empty state.
- **Updated on purpose:** `phase4a11.spec.ts` now reaches the overdue rent through the catch-up review.

## 8. Owner decisions still open
- App name and icon. "Clarity" is a working name and the trademark has not been checked.
- Bundle IDs. The placeholder `app.clarity.budget.dev` must be changed.
- Pricing / business model.
- Web hosting is on Render (`render.yaml`, owner-managed). Open items:
  - the hostname (see §7);
  - syncing the Blueprint to create the separate test site (`clarity-budget-test`).
- Apple Developer Program and Google Play accounts, export-compliance answers (the app uses standard encryption), and store privacy labels ("Data not collected" is accurate for this architecture).
