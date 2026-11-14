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

## 8. Owner decisions still open
- App name and icon. "Clarity" is a working name and the trademark has not been checked.
- Bundle IDs. The placeholder `app.clarity.budget.dev` must be changed.
- Pricing / business model.
- Web hosting is on Render (`render.yaml`, owner-managed). Open items:
  - the hostname (see §7);
  - syncing the Blueprint to create the separate test site (`clarity-budget-test`).
- Apple Developer Program and Google Play accounts, export-compliance answers (the app uses standard encryption), and store privacy labels ("Data not collected" is accurate for this architecture).
