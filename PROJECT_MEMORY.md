# Project memory — Clarity (working name)

Durable decisions and facts. Keep concise. Labels: **[Decision]** confirmed by the owner · **[Verified]** implemented and tested · **[Assumption]** working assumption · **[Open]** unresolved · **[Superseded]**.

## Purpose and users
- **[Decision]** Privacy-first personal finance app for ordinary people. It answers:
  - How much do I have?
  - How much can I safely spend?
  - What's coming up?
  - Where will I be at month-end?
  - Am I on track?
- **[Decision]** It must feel calm and effortless ("two minutes a day"), never like accounting.

## Platforms and architecture
- **[Decision]** Two primary products, one monorepo (npm workspaces):
  - `apps/mobile`: Expo / React Native for iOS and Android.
  - `apps/web`: React + Vite for desktop browsers.
  - Shared `packages/*`: shared, engine, import, security, data, design-system.
- **[Superseded]** v1/v2 plan "web PWA only" was replaced by the dual-platform requirement.
- **[Decision]** Local-first. No bank connections, no Plaid, no server, no external AI. All statement processing happens on the device.
- **[Decision]** No sync in Phase 1. The data model supports a future end-to-end-encrypted sync: IDs, updatedAt, deviceId, tombstones.
- **[Decision]** Build order: shared packages → web → mobile → cross-platform QA. Web goes first because it can be verified in the dev container.

## Financial rules (details in docs/calculation-rules.md)
- **[Verified]** Integer cents, ISO date strings. Every amount is its signed effect on its account. Cards are negative when owed.
- **[Verified]** Card payment = transfer (never spending). Transfers are atomic pairs. Savings are counted only as scheduled transfers, never deducted twice.
- **[Verified]** Safe to Spend = lowest daily low through the horizon − reserve.
  - Horizon = later of month-end and next fixed paycheck.
  - Negative results are shown as "Short by".
  - Estimated and unknown income are excluded.
- **[Verified]** Each day applies outflows before inflows. Overdue bills are counted today; overdue income is not counted.
- **[Decision]** Phase 1 uses a single currency per workspace. Other currencies are excluded from totals, never mixed.

## Security (details in docs/security.md)
- **[Verified]** Random master key. Passphrase slot uses Argon2id (19 MiB, t=2, p=1); recovery-key slot uses HKDF. AES-256-GCM per record with AAD.
- **[Verified]** Web provider (WebCrypto + hash-wasm) and mobile provider (noble) are byte-compatible; backups cross platforms.
- **[Open]** Argon2id timing on real phones, to be measured on the self-test screen. If too slow, add a native module (format already supports it).

## Terminology (exact UI strings in packages/shared/src/terms.ts)
Safe to Spend · Projected month-end balance · Current recorded balance · Available cash · Lowest projected balance · Lowest before next income · Projected end of today · Can I afford this? · Why this number? · Privacy Center · Import Statement · Add Transaction.

## Design
- **[Decision]** Apple-inspired, restrained Liquid Glass. Glass is used only on floating chrome (navigation, sheets, toasts); data sits on solid surfaces.
- Palette: one accent (blue), no purple gradients, no emoji, Lucide icons, Inter with tabular numerals.
- **[Verified]** All text and semantic colors meet WCAG AA in light and dark (test).
- **[Decision]** Reference images 2–3 (large orange/teal 3D gradient blobs) contradict the spec's "no excessive gradients". We borrow their layout, not the blobs.

## Commands
- `npm test`: all package tests (Vitest).
- `npm run typecheck`: strict TS for packages, DOM provider and tests.
- `node scripts/kdf-benchmark.mjs`: KDF timings.
- `GEN_GOLDEN=1 npx vitest run packages/engine/test/golden.gen.test.ts`: regenerate golden outputs. Review the diff before committing.

## Implementation status (2026-11-13, branch phase-1)
- **[Verified]** Web app is complete for Phase 1. Unit, end-to-end (Chromium) and network-audit tests pass.
- **[Verified]** The mobile app type-checks, passes its Jest tests and bundles for iOS and Android. It has **not** been run on a device.
- **[Decision]** Mobile split editing is deferred to the web app; mobile preserves splits when editing.
- **[Decision]** Mobile background auto-lock is capped at 5 minutes.
- **[Verified]** One React version (19.3.0) is pinned via root `overrides`. Expo SDK 58 requires it, and two copies break hooks.

## Web redesign (2026-11-13)
- **[Decision]** The owner asked for a product-wide redesign of the web app (Apple-inspired; Copilot Money and YNAB as quality references, not templates).
- **[Decision]** Budget and Reports pages were added because the redesign brief describes them and lists budgeting in its definition of done. Savings goals were **not** built (no data model for them yet).
- **[Verified]** Web navigation: Home, Transactions, Budget, Planning, Reports, Settings (keys 1–6), plus Import Statement. Phone width uses a bottom tab bar: Home, Transactions, Add, Planning, More.
- **[Superseded]** Warm neutral backgrounds with a deep teal accent. The user rejected this as "brownish, ugly" (Nov 2026).
- **[Decision, user]** Visual reference is copilot.money: cool blue-tinted light background, white cards, navy text, a clear blue accent, soft blue shadows, pill buttons. Borrow the feel only, not their branding, logo, emoji, font (Matter, licensed) or layouts. The site is light-only, so Clarity's dark mode is our own cool navy version.
- **[Verified]** Tokens now: bg #F2F6FC, text #12263F, accent #2559DB (Copilot's #437CEF fails AA for text, so it is deliberately deeper), dark bg #0A0F19 / accent #79A6FF. Radii 8/12/20/26, buttons and segmented controls are pills. `chartPositive` is a brighter green for fills only (never text). Spending bars use the accent blue. Category hues are saturated (blue, pink, teal, violet, orange, green, sky, rose). App icons regenerated in blue from `packages/design-system/icon.svg`.
- **[Lesson]** Avoid warm/beige neutrals and earthy category hues: the user reads them as brown.
- **[Decision, user]** Home has a stronger blue glow: an ambient blue light behind the overview, and a layered blue shadow plus light blue tint on the Projected month-end and Safe to Spend cards. Other cards stay plain. Tints are capped (Safe to Spend top at 10% accent) so all text stays ≥4.5:1.
- **[Lesson]** Decorative layers must not extend past the content width (a -24px inset caused 8px of horizontal scroll on phones). `redesign.spec.ts` phone test catches this.
- **[Verified]** Mobile Home has the same glow (`glowStyle`/`ambientGlow` in `apps/mobile/src/ui/theme.tsx`, using RN 0.88 `boxShadow` and `backgroundImage`; a contrast test covers the tints). Device rendering not yet verified; colored shadows need Android 9+.
- **[Lesson]** The user saw no change on the live site after deploys: the PWA service worker serves the cached version until the page reloads, and iPhones keep tabs alive. Fix: Settings shows `App version` (git commit) with **Check for updates**, the app re-checks when it returns to the foreground, and a "new version is ready" banner offers Reload (never auto-reload: it would lock the app and could lose typing). **[Verified by user, 2026-11-13]** iPhone picked up the new version (3910f60) after the steps in `docs/device-test-script.md`; PC updated on its own.
- **[Verified]** The root `npm run typecheck` does not cover `apps/web/src`; the web app is type-checked by `npm run typecheck -w @clarity/web` (also part of its build). Run both.
- **[Verified]** `Category.budgetCents` (optional) stores a monthly budget. No migration needed. The mobile app ignores it for now.
- **[Decision]** The dashboard chart marks the lowest point of the plotted projection (which includes estimated income). The "Lowest projected balance" tile stays conservative (fixed income only). They differ only when estimated income exists.
- **[Open]** The native mobile app has the new colors (shared tokens) but not the new Budget and Reports screens or the new dashboard layout.

## Known limitations / not yet verified
- **[Open]** No device testing has been possible from the dev container. Not yet verified:
  - iOS and Android;
  - Safari and Edge;
  - Face ID and fingerprint;
  - haptics.
- **[Decision]** Out of scope for Phase 1:
  - PDF, OFX, QFX, XLSX and OCR import;
  - insights;
  - AI recommendations;
  - goals and debt;
  - advanced reports;
  - sync;
  - web biometrics.

## Lessons
- **[Verified]** iPhone Safari stuck on "Loading Clarity…" (2026-11-13) was caused by the AdGuard content blocker blocking the site's scripts. Allow-listing the site fixed it. When the loading screen shows the version line but nothing else happens, suspect a content blocker first.
- Bank CSV dates like 09/12/2026 are genuinely ambiguous. The app must ask, never guess (e2e covers this).
- Playwright: wait for the dialog to close after Save. Saves are async (encryption), so shortcuts pressed earlier go to the dialog.
- Testing Library 14 for React Native has an async `render`/`fireEvent`. Jest mock factories may only reference `mock*` variables.
- Secure storage can throw on some devices or environments. Startup must never depend on it succeeding.
- A test expecting the next paycheck after month-end exposed a horizon bug: the forecast only looked to month-end. Fixed by looking ahead 62 days for the next income.
- In test fixtures, `trackFrom` must be set deliberately. Past occurrences after it are (correctly) overdue.

## Unlock screen (Nov 2026)
- **[Decision, user]** The unlock screen is always dark (deep navy #070B14, one blue light), brand = logo + "Clarity" wordmark, heading "Unlock Clarity", subtitle "Your financial world, securely stored on this device." (checked as accurate). No lock icon.
- **[Decision]** Help link is "Forgot your passphrase?" not "Having trouble accessing your account?": Clarity has no account. Help is an in-panel view; erasing still needs the type-DELETE dialog.
- **[Verified]** Redesign is UI-only: no diff in packages/security or packages/data. Tests: `e2e/lock.spec.ts` (10).
- **[Lesson]** A grid with `place-items: center` sizes its column from content, so a child's `width: min(400px, 100%)` can overflow a phone. Use `grid-template-columns: minmax(0, 1fr)`.
- **[Lesson]** Playwright `getByLabel('Passphrase')` also matches "Show passphrase"; use `{ exact: true }`.
- **[Open]** After unlocking with the recovery key, the passphrase cannot be changed (change requires the current passphrase). Needs a separate, deliberate fix in WorkspaceStore + Settings.
- **[Open]** The native mobile lock screen has not been redesigned to match.

## Accounts and motion (Nov 2026)
- **[Decision, user]** Wants email + password accounts with a server ("Real accounts + server"). This round shipped only a labelled, unconnected preview (`/preview/sign-in`) plus the plan in `docs/accounts-architecture.md` (zero-knowledge: client derives authKey/accountKEK from the password via Argon2id + HKDF; the server stores ciphertext only; existing data is migrated by adding an account key slot, with no re-encryption).
- **[Verified]** The passphrase is the encryption secret (it wraps the master key); it is not a login. It must not be removed until the account slot exists. The unlock screen is unchanged and still the only way in.
- **[Open, owner]** Optional vs required accounts; one password vs two secrets; own API vs managed auth; hosting and email budget; external security review.
- **[Decision]** The motion system is CSS-only (no animation library). Numbers never count up; changed values fade in already correct. Reduced motion makes everything instant, including delays. Tests: `e2e/motion.spec.ts`, `e2e/account-preview.spec.ts`.
- **[Lesson]** The reduced-motion rule must also zero `animation-delay`, or staggered items stay invisible during their delay.
- **[Open]** Mobile jest failed twice in this session when run right after other heavy suites, and could not be reproduced in 11 isolated runs. Not investigated further; mobile code was unchanged in that round.

## Onboarding pay step (Nov 2026)
- **[Fixed, verified]** The five pay-frequency options were a single segmented control that overflowed on phones ("Irregular" outside the box, 54px of horizontal scroll at 390px). They are now a wrapping grid of radio choices; tested at 320/390/1440px.
- **[Decision, user]** Several paychecks can go into the same account (for example a shared account with a partner): "Add another paycheck" (up to 4), each with its own name, schedule and amount. `OnboardingInput.pays` in `packages/data` (the old `pay` field still works; the mobile app uses it).
- **[Added]** An "Upcoming paydays" preview shows the next three dates, worked out by the engine's `scheduleDates`. Date fields get consistent styling (`appearance: none`) because iOS Safari centres and resizes them; this is unverified on a real iPhone.
- **[Open]** The native mobile app's onboarding still has the old single-paycheck segmented control (likely the same overflow). Not changed.

## Remember this device and test mode (Nov 2026)
- **[Decision, user]** No passphrase on every visit. A web "Remember this device" option (7 or 30 days): a non-extractable WebCrypto AES-GCM device key in IndexedDB `clarity-device` wraps a copy of the master key; the passphrase is never stored. Details, state rules and limits are in `docs/security.md` → "Remembered devices".
- **[Decision]** Manual Lock and the automatic inactivity lock PAUSE remembered access (passphrase once, then it continues). Otherwise a lock could be bypassed by refreshing. This is open to the user's preference.
- **[Lesson]** A lock must take effect even if the tab is closed immediately after it. The IndexedDB write is asynchronous, so a synchronous `localStorage` "locked" flag backs it up (found by a test).
- **[Decision]** Test mode is a compile-time flag (`__CLARITY_TEST_MODE__`): on in `vite` dev and in builds with `CLARITY_TEST_MODE=1`; compiled out of production (tested by grepping the bundle). It uses a separate `clarity-test` database with sample data and the passphrase "clarity sample data". The `clarity-budget-test` service in render.yaml is the test site; the owner must sync the Blueprint in Render.
- **[Verified]** `WorkspaceStore.copyMasterKey()` and `vaultId` were added; no change to encryption or the record format.
- Tests: `e2e/remember.spec.ts` (11, production build) and `e2e/test-mode.spec.ts` (3, test build on port 4174; Playwright projects "production" and "test-mode").

## Clarity Capture (Nov 2026)
- **[Decision, user]** On-device interpretation only ("On-device first"). No external AI; the Privacy Center says so. A cloud model would need consent plus the server from the accounts plan. Design and rules: `docs/capture.md`.
- **[Verified]** `packages/capture` (pure TypeScript, shared with mobile): the interpreter, `parseDrafts` (validates untrusted output), `reviewDraft` (deterministic issues), `toTxInput`. `addTransactions` in data is atomic. Provenance source `'capture'` keeps the user's words.
- **[Decision]** Dates that weren't mentioned are filled with today but block approval until confirmed. Approximate amounts and possible duplicates must be confirmed. Card payments and savings are transfers. Categories are never invented.
- **[Lesson]** Transactions dated before an account's opening date are history (no balance change). Capture now says so, because users backfilling recent purchases would otherwise be confused.
- **[Verified]** Mobile app Capture screen (modal; Home card and Transactions button). Logic tests pass and the iOS/Android bundles build. Not yet tried on a device.
- **[Open]** Voice and receipt input; a cloud interpreter.

## Phase 1 audit (2026-11-14)
- **[Verified]** AdGuard cause: the Tracking Protection rule `/clarity-*.js` (aimed at Microsoft Clarity) matches every script URL on the `clarity-budget-…` hostname. It was reproduced with AdGuard's tsurlfilter engine on the current filter sources (`docs/implementation-report.md` §7). The code-side change only improves the static loading hint.
- **[Recommendation, owner]** Use a hostname without `clarity-` (hosting change; not done).
- **[Lesson]** When testing against AdGuard lists, exclude `$app=` rules: they never apply in Safari and otherwise make everything look allowed.
- **[Lesson]** Pushing `phase-1` deploys to Render. When the owner says "don't deploy", commit locally only.
- **[Verified]** Capture audit fixed 11 silently-wrong readings (regressions in `packages/capture/test/audit.test.ts`). Engine audit: 14 new edge-case tests passed unchanged.
- **[Open]** A card paid beyond what is owed shows a negative owed amount; the UI has no "credit" wording.

## Phase 2 (2026-11-14)
- **[Verified]** The "$250 discrepancy" was not an engine error: a $250 savings transfer on Nov 30 was counted in the month-end but hidden by Upcoming's 14-day window. Rule: Upcoming covers at least through month-end (`upcomingUntil`); identity test in `packages/data/test/dashboard-reconcile.test.ts`.
- **[Decision]** Safe to Spend explanations list the items after the low point (`afterLow`, engine text). The UI shows the engine's text verbatim.
- **[Decision]** Transactions totals cover recorded transactions only (date ≤ today), like Reports. Planned items are shown separately.
- **[Decision]** One content width: `--content-max: 1440px` on `.main-inner`.
- **[Superseded by Phase 3]** On phones, long Upcoming names could truncate when an estimate marker and a button shared the row. Fixed in Phase 3.

## Phase 3 (2026-11-14): mobile refinement, chart, cross-platform
- **[Verified, Chromium]** Web Upcoming rows: names wrap in full. On ≤560px the amount and button move to a second line on the right. Tested at 320/360/390/430 with 60+ character names and −$1,234,567.89 (`apps/web/e2e/phase3.spec.ts`).
- **[Verified, Chromium]** Large headline amounts were overflowing the hero card on phones (found by the Phase 3 test).
  - Fix: `.overview` uses `minmax(0,1fr)` when single-column.
  - Hero and Safe to Spend sizes are now `min(design size, 100cqi / (chars × 0.62))`, via the `fitChars()` style var.
- **[Decision]** Chart y-labels sit in a gutter sized from the widest label, never inside the plot.
  - The "Lowest …" label tries 12 positions around the dot and takes the first that misses the line.
  - If none fits (narrow phones), it becomes a caption above the chart ("Lowest $X · date"), and the dot stays.
  - The test uses `isPointInStroke` against the drawn lines.
- **[Decision]** Home presentation facts come from one shared view model, `buildHomeView` / `recentRow` in `packages/data/src/homeView.ts`:
  - same-low / quiet-today flags, recent transactions, Safe to Spend breakdown sums.
  - Status help wording (`STATUS_HELP`, `UPCOMING_NOTE`) is in `packages/shared/src/terms.ts`.
  - Both apps use it; the dashboard numbers are the engine's, unchanged.
- **[Decision]** Native Home (`apps/mobile/src/features/Home.tsx`, a testable `HomeView`) now has the same information as web:
  - month-end with delta;
  - Safe to Spend with the after-low note;
  - a "Key balances" 2×2 grid (recorded, lowest, lowest before income, end of today), where tapping a label opens "Why this number?";
  - Upcoming with ≈, full names, card note, and a "What do these labels mean?" toggle;
  - Recent transactions.

  The previous "lowest window" toggle and duplicate figures under the chart were removed.
- **[Verified]** Cross-platform contract: `packages/data/test/fixtures/home-sample-nov13.ts` is checked against the engine (vitest), the native Home (jest) and the web Home (Playwright).
- **[Not verified]** Native rendering on a device or simulator: `adjustsFontSizeToFit`, wrapping and touch targets are unit-tested only.
- **[Lesson]** Playwright `fullPage` screenshots resize the viewport mid-capture, and can show the hero figures or chart blank. Use a tall viewport with `clip` for visual checks.


## Phase 3A (2026-11-14, commit 828adbf, tags phase3a-checkpoint-before / phase3a-complete)
- **[Verified, Chromium]** Planning timeline rows fit their card on phones; amounts and balances are never cut. Phone layout: amount top-right, ··· under it.
- **[Verified, Chromium]** Transactions renders a stacked list below 760px instead of the table (`useMedia(NARROW)`). Selection and bulk actions work on phones.
- **[Lesson]** In `Transactions.tsx` the helpers sit after the component's `return`. Only function *declarations* exist there; a `const` arrow is never initialised, and calling it throws in the event handler. This silently broke row selection.
- **[Lesson]** Never define components inside a component's render (`function Row()` used as `<Row/>`). It remounts every row on each render and loses focus. Call them as plain render functions.
- **[Decision]** Variable bills show the forecast amount (engine `historyEstimate`) with ≈, plus "your usual: $X", via `recurringAmountView` in `packages/data`. $88.00 is the user's usual amount; $91.40 is the average of the last 3 payments.
- **[Decision]** Settings section nav is a wrapped grid on narrow screens, not a hidden horizontal scroll.
- **[Decision]** A CSV with headers but no rows is rejected (`NO_DATA_ROWS_MESSAGE`). Prepare in Capture is disabled for blank text.
- **[Decision]** Sample data includes 7 fictional budgets ($960/month).

## Phase 3C (2026-11-14): accessibility, interaction polish, test reliability
- **[Decision]** One name for the spendable-accounts total on the dashboard: **"Current recorded balance"** (`TERMS.recordedBalance`). This covers the Safe to Spend breakdown, Key balances and the engine's "Why this number?" lines. Wording only; no figure changed.
- **[Decision]** Dialogs restore focus to the opener captured at first render; an `autoFocus` field had already taken focus by the time effects ran.
- **[Decision]** `Field` links its error (or hint) to the control with `aria-describedby` and sets `aria-invalid`. Errors keep `role="alert"`.
- **[Decision]** The Planning actions menu follows the menu-button pattern: focus moves in, arrows/Home/End, Escape returns to ···, Tab or an outside click closes. Choosing an item refocuses ··· first, so a dialog it opens can restore focus there.
- **[Decision]** Phone sheets: the footer is sticky at the bottom (negative offset equal to the sheet padding, so nothing shows below it).
- **[Decision]** The phone tab bar is opaque. Dark-mode `.btn-danger` uses dark text (#FF8A80 with white text was 2.3:1). `kbd` shortcut hints are `aria-hidden`.
- **[Lesson]** Sticky-footer checks must wait for the sheet's opening slide to finish; measuring right after the click reads a 40px-shifted position.
- **[Lesson, test]** `storage.test.ts` scanned ciphertext JSON for "650". It matched real-clock timestamps (`1794650…`, an ~11-day window) and could match random base64. The test now uses a fixed clock, seeded test-only random bytes, and checks decoded ciphertext for ≥8-byte plaintext fragments, with a positive control.
- **[Not verified]** VoiceOver/TalkBack. Screen-reader behaviour is checked through the accessibility tree in Chromium only.

## Phase 4A (2026-11-14): Safe to Spend horizon (financial correctness)
- **[Verified defect, fixed]** Safe to Spend's horizon was "the later of this month-end and the first fixed paycheck on/after today". When a paycheck fell before month-end, a bill due just after month-end (rent on the 1st) was dropped from the forecast. Safe to Spend could then report money needed days later.
  - Engine-reproduced: Nov 28, $1,850.25, no income, rent $1,400 on Dec 1 → reported $1,850.25.
  - The sample data had the same defect: $2,579.83 ignored the Dec 1 rent.
- **[Decision]** The horizon is the **later of the end of next month and the first dependable paycheck after this month** (`horizonFor`, documented in `docs/calculation-rules.md`).
  - Only fixed-amount income counts, on its date. Outflows are applied before inflows on the same day.
  - Rejected: "through the first paycheck after month-end" alone (a small paycheck just before a large bill hides a shortfall), and a pure rolling window (doesn't fit the month-based product).
- **[Decision]** Everything Safe to Spend counts must be findable:
  - `Dashboard.upcomingLater` / `upcomingLaterUntil` power the "Later · also counted in Safe to Spend" list (first 4 + "N more through <date>");
  - Planning's timeline runs to `planningWindowEnd` (≥ horizon);
  - the onboarding overview lists the counted outflows.

  The dashboard chart (`Dashboard.forecast`) stays on the Upcoming window.
- **[Verified]** Sample Nov 13: Safe to Spend **$2,427.17** (low $2,627.17 on Dec 1, $200 reserve). The cross-platform fixture is updated; golden data was regenerated and each change reviewed.
- **[Lesson]** The engine test builder defaults `trackFrom` to 2026-09-01. A recurring item must get `startDate`/`trackFrom` at its first real date, or earlier months show up as overdue and distort the result.
- **[Limitation]** Anything after the horizon is not counted. "Why this number?" says so and Planning shows it.

## Phase 4A.2 (2026-11-14): account-level integrity and Safe to Spend disclosure
- **[Verified defect, fixed] D1:** the forecast applied every transfer leg without checking the sending account, so a scheduled transfer from an empty savings account created money in checking.
  - Audited case (rent $1,200): old +$100 → now **short by $900**. With rent $1,400: old −$100 → now −$1,100.
  - My Phase 4A.1 report stated rent as $1,400 while its test used $1,200; both versions are now tested.
- **[Decision]** Transfers out of non-spendable asset accounts are capped at the account's projected balance at that moment, after its own outflows that day; the unfunded part is flagged and never counted.
  - Transfers out of spendable accounts count in full.
  - Credit cards are not capped (borrowing; limits not tracked).
- **[Decision] R2:** Safe to Spend stays combined across spendable accounts, but `Forecast.accountShortfalls` + the warning "X would go to −$… on …; move $… into X" make the assumption explicit. No automatic transfers.
- **[Decision]** Disclosure text comes from the engine (`SafeToSpend.caption`, `nextAfterNote`, `AffordResult.headline/scope`), so both apps say the same thing.
  - "Lowest projected balance" is renamed "Lowest balance this month" (`TERMS.lowestBalance`).
- **[Finding]** Add Transaction already links a matching planned entry to the bill ("This pays Rent due Dec 1…"), so the audit's duplicate only arises from unlinked data. The engine flags it ("Possible duplicate"), and both stay counted.
- **[Lesson]** Safe to Spend is the minimum over every day *including today*; hand-derived expectations must include today's balance (one of my own test expectations missed it).

## Phase 4A.4 (2026-11-14): financial integrity corrections (audit F1–F8)
- **[Verified defect, fixed] F1:** a bill paid from savings or another non-spendable account was never counted against spendable cash. Now savings pays what it holds; the rest is counted against the spendable accounts (`coverCents` / `Forecast.coveredPayments`).
  - Audit case (Checking $1,000, Savings $0, tuition $500): $1,000 → **$500**.
  - Applies to card payments from savings too.
- **[Verified defect, fixed] F2:** planned cash advances raised Safe to Spend. Now Safe to Spend subtracts advance money still owed.
  - A card payment reduces what is owed, never below what the card owes after it, so it pays purchases first.
  - Audit case: +$100 → **−$900**, whatever the repayment date or amount.
- **[Verified defect, fixed] F3:** "Can I afford this?" now has two more answers:
  - `unverified`: the date is after the horizon;
  - `move_first`: the account it's paid from can't cover it.

  Neither is ever shown as "Yes". Bills with no amount are named.
- **[Verified defect, fixed] F4:** every account-shortfall day is recorded. One warning per account lists them all, and the amount to move is the deepest.
- **[Decision] Same-day order** (docs/calculation-rules.md):
  1. morning: moves out of spendable accounts, then payments;
  2. account check;
  3. afternoon: income and advances;
  4. evening: transfers out of savings, capped by then, repeated for chains.

  The combined low is unchanged (money in after money out).
  - Competing transfers from one source: card payments, then moves that stay outside spendable cash, then moves into it, pro rata. Never by name.
  - Fixes F5 (same-day top-up) and F6 (paycheck-and-sweep).
- **[Decision, conservative]** Money moved in from savings, paychecks and advances still arrive after the same day's bills. Not changed, because it would raise Safe to Spend on timing the app can't know.
- **[Fixed] F7:** a duplicate is matched by name when amounts tie; ambiguous cases list the candidates.
- **[Fixed] F8:** warnings show the actual (possibly negative) balance.
- **[Limitations]** Interest, fees and card limits are not modelled.
  - An advance into savings is still counted as owed (conservative).
  - Foreign-currency or archived non-spendable accounts are not covered by F1.
- **[Lesson]** Probe the audit scenarios before and after with the same script. Every 4A.3 example is now a named test in `packages/engine/test/financial-integrity.test.ts`.

## Phase 4A.4.2 (2026-11-14): archived accounts, complete warnings, currency safeguards
- **[Verified defect, fixed]** Bills on archived accounts were dropped from Safe to Spend. Archived base-currency accounts now follow the savings rule: pay from what they hold, cover the rest from spendable cash.
  - Audit case: $1,000 → **$200**.
  - An archived account's balance is never spendable.
  - The warning "N scheduled items still use X, which is archived" lists each item.
- **[Decision] Archiving workflow.** `accountUsage` and `archiveAccount(ctx, id, { reassign, pause })` live in packages/data, with `describeUsage` and `archiveTargets` shared by web and mobile.
  - The web dialog (Settings) and mobile screen (`app/manage/archive.tsx`) offer keep / move / pause per item. Nothing changes unless chosen.
- **[Verified defect, fixed]** "N more in Planning" led to a page with no warnings. Planning (web and mobile) now shows the complete engine list, grouped by severity.
  - `Warning.items` and `Warning.accountId` were added.
  - The engine sorts warnings critical → warning → info.
  - Account-shortfall text always states the lowest amount and date.
- **[Transparency]** An unfunded transfer that competed with others names them, with requested / counted / not-counted amounts, and says the order is a cautious assumption. The priority is unchanged.
- **[Defensive]** Transfers between currencies count only the sender's debit. A cross-currency full-balance card payment is not counted and is warned about. "Can I afford this?" from a foreign-currency account is `unverified`.
- **[Limitations]**
  - The mobile archive screen and mobile Planning list are tested at component/data level, not by rendering the routed screens.
  - Planned future transactions on an archived account are listed but not reassigned (edit them in Transactions).

## Phase 4A.4.4 (2026-11-14): archived liabilities, card-debt integrity, currency accuracy
- **[Verified defect, fixed]** Archiving an overdrawn spendable account hid the debt ($500 → $1,000). Now:
  - an `archived_balance` forecast item counts the debt against spendable cash today;
  - the account is brought to $0 in the projection (counted once);
  - archived non-spendable accounts keep their pre-archive treatment.
- **[Verified defect, fixed]** An archived card's "no payment scheduled" warning disappeared. `balanceSummary` now keeps archived accounts that owe money, and lists accounts in another currency (archived too) before anything else.
- **[Verified defect, fixed]** The archived account warning claimed foreign-currency items were counted. Currency is now checked first.
- **[Verified defect, fixed]** A planned advance from a foreign-currency card was subtracted from base-currency Safe to Spend. Borrowed money now counts only for base-currency cards.
- **[Finding / decision open]** Cash advance $90 → Safe to Spend $190 is consistent with the card model: the payment repaid the advance, and the later purchases are uncounted purchase debt (same without the advance).
  - Fixed the disclosure with the `card-projected:` warning.
  - Whether to deduct projected uncovered card balances is an owner decision.
- **[Verified defect, fixed]** Foreign amounts were shown with $. Warnings, items, Upcoming and the Planning timeline now use the account currency.
- **[Fixed]** Repeated dates of one schedule are one warning with every date.
- **[Documented, tested]** The existing pause/resume rule is stated in both archive reviews (`PAUSE_NOTE`).
- **[Decision open]** Archiving caps the archived account's own scheduled transfers out. This is the only remaining way archiving raises Safe to Spend (600 generated scenarios).

## Phase 4A.5 (2026-11-14): card liability and archived transfers (owner decisions)
- **[Owner decision, implemented]** Card debt counts without a scheduled payment.
  - At the horizon, what each base-currency card still owes (all activity on its date; archived cards included) is set aside from the end-of-horizon cash.
  - Safe to Spend = min(daily own-money low, end cash − card debt) − reserve.
  - Assumption: the debt must be covered by the end of the forecast, so in-horizon income can cover it. This makes paying on Dec 31 and paying after the horizon give the same result.
- **[Owner decision, kept]** Transfers out of archived accounts are capped at their balance; the unfunded part is flagged. Regression tests were added.
- **[Changed tests, by decision]** Five existing tests and one e2e comment encoded the old rule, "card debt only through a scheduled payment"; updated with hand-derived values.
  - Sample data is unchanged ($2,427.17): its card is paid in full on Dec 31.
- **[New]** Unreliable cards (another currency, or unknown amounts) are warned about, and "Can I afford this?" is qualified "— not counting X".

## Phase 4A.5.2 (2026-11-14): Policy B for card debt (owner decision after audit 4A.5.1)
- **[Owner decision, implemented]** Card debt that no scheduled payment or refund covers is owed now; a scheduled payment sets when the debt it covers is counted.
  - The rule runs per day, per base-currency card, at the low point: uncovered = owed − later credits (through the horizon + 62 days), oldest debt first.
  - Reserve per card: max(uncovered, advance still owed).
  - The end-of-horizon check is kept for payments planned after the horizon.
  - `ForecastDay.cards`, `SafeToSpend.cardDebtToday` and `LowPoint.cardReserves` were added.
- **[Verified]** It fixes the audit's overstatements:
  - scenario 1: $500 → $100;
  - partial payment: $400 → $100;
  - two cards: $400 → $100;
  - forecast end moving from Dec 31 to Feb 1: $100 / $500 → $100 / $100.
- **[Presentation fixed]** "Why this number?" always names the card debt at the low point, and planned dates are marked as user-entered.
- **[Changed tests, by decision]** Five unit tests, one e2e assertion and one mobile assertion that encoded the Phase 4A.5 timing were updated with hand-derived values. Sample data is still $2,427.17.
- **[Limitation]** Statement due dates, interest, fees and card limits are not modelled. A user-entered payment date is trusted as the expected date.

## Phase 4A.5.4 (2026-11-14): card credits are not payments (audit 4A.5.3)
- **[Verified defect, fixed]** Every positive amount reaching a card counted as "covering" its debt, so future refunds, fixed cashback and refunds after the horizon raised today's Safe to Spend. Examples:
  - $200 refund Dec 10: $300 → $100;
  - $600 refund: $500 → $100;
  - refund Jan 20: $500 → $100.
- **[Fix]** `apply(..., isPayment)` in forecast.ts. Only transfer legs into a card (payments) count as coverage (`paymentsCents`). Refunds and credits lower the balance on their day (`otherCreditsCents`).
- **[Fix]** Pending non-transfer credits on base cards (`Forecast.pendingCardCredits`) are added back to card debt until they post. The recorded balance is unchanged.
- **[Fix]** The warning amount equals what is reserved. Refunds are never called payments. "Why this number?" names pending credits and the next expected credit. A payment after the horizon says "set aside on Dec 31".
- **[Changed tests]** Two tests that encoded the defect are now $100 and $300.
  - The owner's table value "$400 debt, $200 posted refund, later $200 payment → $100" is $300 by arithmetic. $100 would count the refunded $200 twice; tested at $300 and reported.
- **[Verified]** 500 random scenarios now equal an independent reference model (250 with refunds).
- **[Kept]** The 62-day lookahead is unchanged and documented.

## Phase 4A.5.6 (2026-11-14): pending cash credits and starting-balance integrity (audit 4A.5.5)
- **[Verified defect, fixed]** Pending credits into checking, savings, cash and archived accounts were spendable. `accountBalance` includes pending items and the forecast started from it. Examples: $500 + $300 pending refund → $800 (now $500); pending + $700 bill → $100 (now −$200); pending into savings funded a transfer and a savings bill.
- **[Fix]** `forecast.ts` starts non-card accounts at recorded − pending credits (`isPendingCredit`, `pendingCreditTotal`) and excludes future-dated pending credits (`'pending_credit'`). Recorded balances are unchanged. "Why this number?" starts from the recorded balance and takes out "<account>: pending credit not yet available". Non-spendable accounts get an info line. The recorded-balance explanation notes the pending amount.
- **[Verified defect, fixed]** Update balance compared the bank figure with the recorded balance, so a pending deposit was absorbed (O4 gave $200). It now compares posted with posted (`postedBalance`).
- **[Confirmed decision: convention]** Entered balances are the bank's posted balance without pending items. Later records are added, including today's. "Already included in the balance I entered on {date}" (`Transaction.includedInBalance`) records an item as history only. Only the user knows whether the bank figure already includes an item, so it's an explicit control, not a guess.
- **[Known limitation]**
  - A pending credit is treated as never arriving within the forecast until marked posted.
  - Reconciling while a cleared item is still pending in Clarity double counts unless it's marked posted first; the dialog warns.
  - Old adjustments are not rewritten.
- **[Lesson]** In a randomized reference test, generate only dates that the rule under test covers. A past unrecorded one-off is a separate rule, and one seed failed for that reason; the reference was wrong, not the engine.
- **[Verified]** Engine tests `pending-credits.test.ts` (33, including 300 invariant scenarios and 200 against an independent model); data `balance-convention.test.ts` (5); web e2e `phase4a56.spec.ts` (4); mobile `pending-credits.test.tsx` (2).
