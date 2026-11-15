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
- **[Decision, user]** Home has a stronger blue glow: an ambient blue light behind the overview, and a layered blue shadow plus light blue tint on the two headline cards (Projected month-end and Safe to Spend until 4B.2; since 4B.2 Current recorded balance and Safe to Spend). Other cards stay plain. Tints are capped (Safe to Spend top at 10% accent) so all text stays ≥4.5:1.
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
  - ~~a "Key balances" 2×2 grid (recorded, lowest, lowest before income, end of today)~~ **[Superseded in 4B.2]**: the recorded balance is the headline card and the other figures appear only when they are not repeats;
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

## Phase 4A.5.8 (2026-11-14): balance reconciliation and inclusion safeguards (audit 4A.5.7, D1–D9)
- **[Fixed] D1** Minus signs were stripped from balance inputs (−$100 saved as +$100). Balances are signed now (`parseSignedAmountInput`, `parseBalanceEntry`, `AmountInput signed`, mobile minus-capable keyboard, onboarding "overdrawn" choice).
- **[Fixed] D4** Cards used `abs()`; a card in credit couldn't be represented or reconciled. Now entered as Owed / In credit; the data layer takes the signed amount owed (`0 - x`, never −0).
- **[Fixed] D3/D9** "Already included" is valid only on posted items dated from the opening date through the confirmed date; the data layer refuses otherwise (`inclusionProblem`), the engine ignores invalid legacy flags (`isHistoryOnly`), the UI hides the box for pending items.
- **[Fixed] D2** Update balance refuses a difference equal to pending items (sets of ≤3, `pendingMatches`) until the item is marked posted (`markTransactionPosted`) or the user confirms it's unrelated (recorded with a note). Never posts automatically.
- **[Fixed] D5** Transfer legs are decided per account (`includedInBalance` / `toIncludedInBalance`).
- **[Fixed] D6** **[Confirmed decision, owner, 2026-11-14: "strictly before"]** Posted items dated BEFORE the latest confirmed date are history only by default; ones ON that date count by default (box offered unticked). The literal "on or before" version was implemented first and changed 10 first-day browser flows (a coffee after onboarding wasn't counted), so the owner chose "strictly before". Applies to Add, Capture, mark-paid and import.
- **[Fixed] D7** History-only labels on web and mobile; **[Fixed] D8** a matching Update balance stores `Account.balanceConfirmedDate`, no $0 transaction.
- **[Fixed, found while testing]** Editing a balance adjustment turned it into an expense with the opposite sign; adjustments can't be edited now (delete, or Update balance again). A spendable account overdrawn today with nothing paid out wasn't warned about; now "X is overdrawn: −$50.00 today".
- **[Kept, owner decision open]** A non-spendable account below zero (savings at −$50) isn't counted in Safe to Spend (Phase 4A.4.4 rule). I tried counting it and reverted it: it contradicted that documented rule.
- **[Lesson]** Reproduce a decision's consequences across existing flows before committing to it: the D6 default looked local but changed every same-day entry.
- **[Verified]** `packages/data/test/reconciliation-safeguards.test.ts` (40), `reconciliation-ledger.test.ts` (300 random sequences vs an independent ledger after every step), import test; web `e2e/phase4a58.spec.ts` (7); mobile `test/reconciliation.test.tsx` (4, component tests, not a device).

## Phase 4A.5.9 (2026-11-14): final reconciliation integrity audit
- **[Confirmed decision, owner]** Negative savings (any account not counted as spendable, active or archived, base currency) reduce Safe to Spend by the amount owed; positive/zero add nothing. Supersedes the Phase 4A.4.4 "not counted" rule for non-spendable accounts; 4 older tests updated to the new rule.
- **[Implementation]** Counted once: debt counted today and the account zeroed in the projection (existing archived mechanism); money arriving later repays it first (`repay()`, `ForecastEvent.repaidCents`), so a transfer into overdrawn savings isn't counted on top of the debt. Verified against an independent day-by-day model (300 random scenarios).
- **[Verified defect, fixed]** Statement-import reconciliation compared the statement (posted) with the recorded balance (pending included): a pending deposit not on the statement → −$300 adjustment (spendable $990 → $690); a pending purchase → +$120 (overstated). Now posted vs posted; rows that look like a pending item clearing are flagged and left out by default; pending matches block the adjustment until resolved or confirmed unrelated; statements ending before the confirmed date don't adjust.
- **[Fixed]** Partial matches: same-direction pending items that could explain part of an Update balance or import difference are named and need confirmation (linear check; exact combinations still ≤3 items).
- **[Verified, no change]** Transfers with different confirmed dates: each leg decided per account; edit keeps each leg's state; delete removes both; pending legs never history; posting counts both once.
- **[Known limitation]** If the user includes a statement row flagged as a pending item clearing AND later marks that pending item posted, it is counted twice; the row's note warns against exactly that.
- **[Lesson]** Check the fixture before doubting the code: two "failures" this phase were my own inconsistent test data (a statement's running balance; an afford boundary that the per-account rule answers "move first").

## Phase 4A.5.10 (2026-11-14): statement-import duplicate protection
- **[Verified defect, fixed]** Including a statement row flagged as a pending transaction clearing, then marking the pending one posted, counted the deposit twice ($1,590 vs $1,290). Cause: the flag lived only in the transient import preview; `commitImport` wrote an independent transaction with no link, so nothing connected the two records afterwards.
- **[Fix]** A flagged row needs an explicit `pendingResolution` (data layer refuses otherwise). "Same": no new transaction; the pending one (id kept) is posted once and records `Transaction.statementMatch` (undo restores it; edits keep it; re-import says "Already matched"). "Different": imported with `provenance.separateFrom`. Never automatic. Web and mobile review offer Same / Different / Leave out; matched transactions are labelled "Matched to statement".
- **[Fixed]** Partial-match wording no longer implies an exhaustive search ("some or all … exact combinations of up to 3 items only"); every same-direction item is listed (no cap). Proof that 4+ item combinations can't pass silently is in calculation-rules.md.
- **[Known limitation]** Statements imported before Phase 4A.5.10 that already contain such a duplicate are not detected retroactively.

## Phase 4A.5.12 (2026-11-14): statement matching, duplicate prevention, transfer integrity (audit 4A.5.11 F1–F6)
- **[Verified defects, fixed]**
  - F1/F2: only the first same-amount pending item was offered, in file order, and could not be changed; truthful answers still double-counted ($1,600 vs $1,300; $1,900 vs $1,600).
  - F3/F6: an item clearing for a different amount was never detected ($1,590 vs $1,290; $890 vs $940).
  - F4/F5: the other account's statement row became new income or a second transfer ($700 vs $600 savings; $800/$700 vs $900/$600).
- **[Fix]** `packages/import/src/matching.ts`: `findMatchCandidates` + `MATCH_WINDOWS` (pending −3/+10 days, any amount, same direction; posted transfer legs −3/+7 days, exact amount; earlier candidates kept). The review lists all (closest first), pre-selects nothing; `ImportDecision.match` = { txId } | { none, seen }; the data layer re-checks against current data. Different amounts are never merged or changed automatically. A posted transfer leg is linked, never duplicated.
- **[Fix]** One workflow: rows decide; the balance check points to the row; live candidates (status changes show at once); undo message (`describeImportUndo`); button "Link N to existing".
- **[Found while testing, fixed]** The same review committed twice imported the row as new once its candidate was linked; now refused.
- **[Verified]** 380 randomized runs vs a bank ledger with a truthful user: 380 correct, 0 incorrect (421 rows with several candidates, 477 with different-amount candidates, 146 with transfer candidates).
- **[Known limitations]**
  - Different-amount candidates can list several unrelated pending items in the same direction (no tolerance by design); the user rules them out.
  - A statement whose rows all share one date is read oldest-first (pre-existing).
  - Duplicates created by imports before Phase 4A.5.10 aren't detected retroactively.


## Phase 4A.5.14 (2026-11-15): independent transfer settlement and reconciliation integrity (audit 4A.5.13 D1–D9)
- **[Confirmed decisions, owner]** Each transfer leg settles independently. An incoming pending transfer is not spendable until that account's leg posts; an outgoing pending transfer reduces the sender at once. Transfer neutrality holds once both legs posted, not in transit. Undo reverses only its own leg and its own changes. Fees are explicit; a transfer amount is never altered silently. Stale pending items stay discoverable. Several tabs may be open, but stale/conflicting commits are refused.
- **[Verified defects, fixed]**
  - D1: linking, "Mark posted" and Update balance posted BOTH legs; now one leg only (`commitImport`, `markTransactionPosted`, `reconcilePreview`).
  - D2: `isPendingCredit` excluded transfer legs, so money in transit was spendable; it now includes the receiving leg (engine; archived/negative accounts use the same rule).
  - D3: undo restored both legs to the matched leg's old status, over other imports' links. Now per leg, only `setStatus`; refused when a later import is linked to something it created.
  - D4: pending items more than 10 days old were never candidates (a check cashed 15 days later was counted twice). Now listed as 'stale' candidates.
  - D5: editing a linked/imported transaction let the same row in again. Exact-duplicate detection now uses the row's own amount/date (`statementMatch.amountCents`, `provenance.rowDate/rowAmountCents`); a linked item can't be made pending by editing.
  - D6: posted transfer legs with a different amount weren't listed. Now any amount, with a fee option.
  - D7: the web form kept a hidden pending flag when switching to Transfer. Transfers now have a visible Status choice (both posted / sent · awaiting deposit / received / neither), on web and mobile.
  - D8: the done screen said "Imported N transactions" for linked rows. Now `describeImportResult`.
  - D9: commits weren't protected across tabs. Now there are snapshots on decisions, an exact-duplicate re-check at commit, and a storage revision compare-and-write (`StorageAdapter.writeRowsIfRevision`, `StaleDataError`, store reload).
- **[Data model, no migration]** New optional fields:
  - On transactions: `postedDate`, `transferFeeOf`.
  - On `StatementMatch`: `amountCents`, `setStatus`, `previousPostedDate`, `fee`, `postedFeeTxId`.
  - On provenance: `rowDate`, `rowAmountCents`.
  - On `ImportBatch.counts`: `markedPosted`, `fees`, `awaiting`.
  - Old data stays valid (legs had equal statuses).
- **[Decision, mine; documented]**
  - Posted, unlinked transfer legs match over −3/+10 days (was +7), plus as stale when the amount is exact. This covers a leg the user marked posted by hand before an 8–11-day settlement.
  - A posting date is recorded only from a statement row. When marked posted by hand, the transaction counts from its own date.
- **[Superseded by 4A.5.15]** A card payment pending at the card issuer was counted against checking AND the card debt (twice). Corrected in Phase 4A.5.15 (owner decision).
- **[Lesson]** In web `Transactions.tsx`, helpers after the component's `return` must be function declarations: a `const` there crashed the page ("settlement is not defined"), found by the browser suite.
- **[Known limitations]**
  - A fee can be confirmed only for a sender-charged difference: less arrived, or more left. A receiving-bank fee isn't modelled.
  - A leg marked posted by hand whose statement arrives more than 10 days later with a different amount isn't listed.
  - A toast "Undo" from an out-of-date tab is refused without a message (data is reloaded).
  - Cross-tab safety relies on IndexedDB read-write transactions being serialized per store, which is browser behaviour. It was tested in Chromium only.

## Phase 4A.5.15 (2026-11-15): card payments in transit counted once
- **[Confirmed decision, owner]** An initiated card payment not yet fully settled counts exactly once against Safe to Spend: from the paying account (its sending leg, pending or posted), never again as card debt. It is a forecast-reservation rule only: no status, posted balance, id or link changes. 4A.5.14 independent settlement stays; incoming pending transfers to cash accounts stay unspendable.
- **[Root cause, verified]**
  - `pendingCreditTotal` adds a card's pending credits back to its debt (Phase 4A.5.4, for pending refunds).
  - Since 4A.5.14 the card leg of a pending payment was one of them, while checking's pending debit also counted it.
  - Future-dated pending payments were also excluded from the forecast (`isPendingCredit` in step 1).
- **[Fix]** `isCardPaymentInTransit` (engine/balances.ts): the pending card side of a recorded transfer whose sending leg exists.
  - It is excluded from card pending credits and from the forecast exclusion.
  - `Forecast.cardPaymentsInTransit` feeds a "Why this number?" line.
  - Same engine path for Safe to Spend, afford, warnings, forecast, explanations; web and mobile render the same lines.
- **[Verified]** 20 data tests (both settlement orders, every transition, partial/multiple/multi-card, overpayment, card in credit, savings source, refunds, scheduled payments, failed payments, edit, statement links and undo, archived, same day, past/future dates, shortfall/afford/explanation) including a 300-run randomized model (3,600 steps; Safe to Spend never moved when a leg posted). Plus 1 browser test and 1 mobile component test.
- **[Known limitations]**
  - A failed or reversed payment counts as on its way until the user deletes it or undoes its import.
  - The card leg dated before the card's opening date is history and doesn't offset (the usual opening-date rule).

## Phase 4A.5.17 (2026-11-15): pending opening-balance items and returned card payments (audit 4A.5.16 F1–F4)
- **[Confirmed decision, owner]** The opening balance is the bank's posted balance on the opening date, so it excludes pending items, whatever their date.
- **[Fixed] F2:**
  - What was wrong: `affectsBalance` ignored everything dated before the opening date. A pending $200 debit gave $1,000 instead of $800, and with a card payment E2 gave $700 instead of $500 and E1 $300 instead of $500.
  - Fix: `inOpeningBalance` treats a pre-opening item as history only if it posted by the opening date.
  - A pending item counts, and keeps counting after it posts. A `postedDate` is now recorded when a pre-opening item is marked posted by hand (today) or linked (row date).
  - The "Before account added" reason now says it was posted by then.
- **[Fixed] F1, returned card payments:**
  - A statement row of exactly the opposite amount, in an account the payment touched, within 0–30 days, is a 'return' candidate. It is never included by default.
  - Confirming it creates a transfer back (`returnOf`): this side is the posted row, the other side is pending.
  - The payment is no longer in transit. If the issuer never posted it, both card-side legs are pending and cancel (`isVoidedReturnLeg`).
  - A link and a return of the same payment may be in one statement; two of the same kind may not.
  - Undo and re-import are safe. `describeImportResult` adds "N returned card payment(s) recorded".
- **[Fixed] F3:** the "Why this number?" line for a payment in transit now says what to do if it is returned or rejected.
- **[Fixed] F4:** card payments say "Sent · awaiting posting by Visa". The Add form's card options say "awaiting posting by the card issuer"; bank transfers still say "awaiting deposit".
- **[Lesson]** My first randomized model assumed a returned payment that was already inside the card's opening balance wouldn't restore the debt. That was wrong: the issuer reverses it, so the card owes it again. The engine was right, and I fixed the model.
- **[Known limitations]**
  - A return typed in by hand as income (not imported) isn't detected.
  - A partial return (a different amount) isn't offered.
  - The review still shows the Type/Category pickers on a return row, although they are ignored for a return.
  - A pending item from before an account was added that later turns out to have been in the entered balance must be marked posted with a statement row dated before the opening date (or deleted).

## Phase 4A.5.18 (2026-11-15): returned-payment safeguards (manual entry, partial, older; opening correction)
- **[Data model, verified safe]** Partial returns use the existing transfer-back representation (`returnOf`); no new state.
  - Engine: while the issuer has posted neither side, the returned part leaves the in-transit amount and the card's recorded/pending totals (`returnedWhileUnposted`, `effectiveAmount`). Afterwards each return's card side is a pending debit.
  - The 4A.5.17 full-return behaviour is unchanged (same numbers).
- **[Fixed / added]**
  - Manual-entry detection (`returnOptionsForEntry`, web and mobile Add/Edit). An explicit decision is required: return, separate income, or close to decide later.
  - `recordPaymentReturn`, including correcting an existing income transaction (`replaceTxId`).
  - Partial and multiple returns, capped at the payment total (`paymentReturnStatus`).
  - Older-than-30-day returns: suggested with description evidence, and always selectable by the user.
  - Review rows confirmed as returns hide type/category and say what is recorded. The button reads "Record N returned payment(s)".
  - ~~Deleting a payment deletes its returns.~~ **Superseded (4A.7):** deleting a payment with returns is refused.
  - Opening correction `markPostedBeforeOpening`, with a button in the Edit form.
- **[Decisions, mine; documented]**
  - Partial amounts and older payments are suggested only with description evidence; otherwise the user picks them via "This is a returned card payment…".
  - "Decide later" means closing the form without saving.
- **[Lesson]** The first engine generalisation kept the returned share in the card's recorded balance (−$300 instead of −$500); Safe to Spend was right but the account figure misleading. `effectiveAmount` fixes it.
- **[Known limitations]**
  - ~~A return typed in as income through other paths (Clarity Capture, recurring confirmation) isn't checked.~~ **Superseded (4A.6/4A.7):** recurring confirmation already used the Add form's check; Capture now checks too.
  - Partial returns of transfer fees aren't modelled.
  - The opening correction is offered for non-transfer items only; a transfer leg uses the statement-link route.

## Phase 4A.7 (2026-11-15): transaction lifecycle integrity (audit 4A.6 H1, H2, H3, M1, M2)
- **[Confirmed policy, owner-specified in the phase brief]** A card payment and its returns stay linked. Unsafe actions are refused, never auto-resolved:
  - undoing the import that created a payment with recorded returns is refused (no partial undo, no return deleted to make it work);
  - deleting such a payment is refused (supersedes 4A.5.18's cascade delete);
  - editing it below the returned total, to another account or card, to a non-transfer, or after its first return date is refused;
  - Capture asks the same return question as the Add form, and saves confirmed returns through `recordPaymentReturn`.
- **[Verified implementation]**
  - `packages/data/src/commands.ts`: `paymentReturns`, `deleteProblem`, `deleteTransactions` (bulk; returns first), `returnEditProblem` (in `updateTransaction`, which now also keeps `returnOf` on an edited return), the dependent-return check in `importUndoProblem`, `CaptureItem` and `saveCaptured` (with a data-layer check for undecided captured income), and `recordPaymentReturn({ provenance })`.
  - `packages/capture`: `draftReturnOptions`, `chosenReturnOf`, `toCaptureItem`, the `possible_return`/`return_unavailable` issues, and the draft fields `returnChoice`/`askReturn` (never copied from interpreter output).
  - Web and mobile Capture show the decision. Web and mobile delete paths explain refusals: the web Edit form error, the list toast "Nothing was deleted: …", the mobile Edit form message, and the list alert "Can't delete this payment".
- **[Data model]** No schema change and no migration. Only optional draft fields (in memory, never stored) and an optional `provenance` input.
- **[Decisions, mine; documented]**
  - Resolving a dependency means deleting the return, or undoing the import that recorded it.
  - Undoing an import that only linked (posted) a payment stays allowed.
  - A card payment captured in the same entry doesn't trigger the check on a deposit.
  - A captured return is named after the merchant the user wrote, or "Returned payment".
- **[Lesson]** Sample-data (demo) mode turns Capture approval off, so browser tests of Capture saving must use a fresh workspace.
- **[Lesson]** A guard in one entry path (the Add form) doesn't protect the books: every entry, edit, delete and undo command needs the same rule at the data layer.
- **[Known limitations]**
  - If the user deletes an imported return and then its payment (both explicit), re-importing the return's statement offers the row as ordinary income (no payment left to match). The file is flagged as already imported, but the row isn't.
  - Partial returns of transfer fees aren't modelled.
  - Not verified on simulators, devices, Safari or with a screen reader.

## Phase 4A.8 (2026-11-15): same-statement card returns and import integrity (audit 4A.7.1 N1–N4)
- **[Confirmed policy, from the phase brief]**
  - A payment row and its return row in one statement are paired only as a user-confirmed proposal. The return row stays unselected until decided; rejecting it imports the money as new.
  - `commitImport` re-derives and re-validates the pairing and is atomic.
  - Fees never reduce a payment below its returned total, checked in both the matching layer and the data command.
  - Capture hides Category once a return is chosen.
- **[Verified implementation]**
  - **Import package:**
    - `packages/import/src/statementReturns.ts`: `statementReturnOptions`.
    - `categorize.ts`: `cardPaymentEvidence`.
    - The pipeline adds `statementReturnOf` and `suggestedOtherAccountId` to candidates.
    - `matching.ts`: `RETURN_RE` (now exported), `returnedBlocksFee`, and the candidate field `feeBlockedByReturnsCents`.
  - **Data (`commands.ts`):**
    - `ImportDecision.pairing`, plus the `commitImport` pairing pass (after all rows), the fee check, and the final "returns ≤ payment" check.
    - `rowChoiceDecision`, `STATEMENT_RETURN_CHOICE` / `isStatementReturnChoice`, and `statementReturnRowText`.
    - `isLinkChoice` ignores `row:N` choices.
  - **Web and mobile review:**
    - pairing options ("row:N" choices) and the "payment row must be a card transfer" check;
    - the suggested card prefilled, with rows still unselected.
- **[Data model]** No schema change and no migration: only optional fields on review candidates and decisions, which are never stored.
- **[Decisions, mine; documented]**
  - A payment row that only says "payment" (no card evidence) is still offered as a weaker proposal, because the return wording is strong evidence.
  - A payment row that could also be an existing transaction is still offered. If the user links it instead, the pairing is refused and the return must be recorded against the existing payment.
  - Partial returns of up to the payment's amount are offered.
- **[Lesson]**
  - Excluding payment rows with any existing match candidate silently disabled pairing whenever a pending outgoing item existed. The randomized model caught it (0 pairings), and the rule was refined.
  - A new same-statement return initially double-counted earlier returns from the same import. The several-returns test caught it.
- **[New finding, fixed in 4A.9]** The import review pre-ticked a suggested scheduled-item link (`occurrenceMatch`) by amount and date even when the row is a card payment and the item is a bill: in the sample data, "PAYMENT TO STORE CARD −$100" was matched to the Electricity bill, overstating Safe to Spend by $91.40. This existed before 4A.8 (the row was then an expense, with the same pre-ticked link). Recommended next.
- **[Known limitations]**
  - Same-statement pairing covers non-card statements. On a card statement, a payment row and its reversal row aren't paired: that remains the existing matching against payments already in Clarity.
  - Re-importing only the return's statement after the user deleted both the payment and the return (the two in separate files) still offers the row as new money. Pairing needs both rows in one review, and no row-level deletion history is kept (deliberately not added: it would need a stored schema change).

## Phase 4A.9 (2026-11-15): scheduled-item matching integrity
- **[Root cause, verified]** `suggestOccurrenceMatch` accepted any unpaid occurrence in the same account and direction within ±7 days whose amount fit (25% for estimates). The description only ranked candidates. The import review (web and mobile) and the Add form (web and mobile) ticked the link by default. A link marks the occurrence confirmed and drops it from the forecast: sample-data Electricity ($91.40 estimate) linked to "PAYMENT TO STORE CARD −$100" gave Safe to Spend $2,268.57 instead of $2,177.17.
- **[Confirmed policy, from the phase brief]**
  - Amount and date alone never link: weak or ambiguous suggestions are shown unticked; the user can reject any suggestion.
  - The import commit validates every link against current data.
  - No forced selection.
- **[Verified implementation]**
  - **Engine (`packages/engine/src/matching.ts`):** `occurrenceEligible` (adds kind fit), `occurrenceEvidence` (name or history), `suggestOccurrenceLink` (strong / ambiguous); `suggestOccurrenceMatch` kept as a wrapper.
  - **Import:** the pipeline passes the row's likely kind and card. `occurrenceMatch` gains `strong`, `evidence`, `ambiguous` and `date`.
  - **Data:** the `commitImport` link checks and `occurrenceRefProblem` (in `addTransaction` / `updateTransaction`).
  - **UI:** the review (web and mobile) and the Add form (web and mobile) tick only strong suggestions and explain weak ones.
- **[Data model]** No schema change and no migration. The new candidate fields are optional (reviews built before 4A.9 lack them and so default to unticked).
- **[Decisions, mine; documented]**
  - Evidence means: all distinctive name words appear in the description; or token similarity ≥ 0.5; or the same payee was linked to the item before.
  - A link chosen in the Add form or by Mark paid may have a different amount or date (it records what was paid).
  - A data-command caller sending `linkOccurrence: true` for a row with no suggestion is ignored, as before.
- **[Lesson]** The engine only generates occurrences from the day an item was added (`trackFrom`): tests needing past occurrences must create the item earlier.
- **[Known limitations]**
  - ~~"Mark paid" on an occurrence already paid by an unlinked transaction creates a second transaction.~~ **Fixed in 4A.10.**
  - Evidence is word-based: a payee whose statement name shares no word with the item's name ("OAKWOOD MGMT" for "Rent") is strong only after the user links it once (history).

## Phase 4A.10 (2026-11-15): link existing transactions to scheduled items
- **[Defect, verified]** Mark paid always added a new transaction. With a $300 rent already imported unlinked (checking $1,000, Rent $300 Sep 15 and Oct 15), checking went to $400 (truth $700), spending to $600 (truth $300), and Safe to Spend stayed $100 (truth $400).
- **[Confirmed policy, from the phase brief]**
  - The user explicitly picks an existing transaction or "No, record a new payment"; nothing is preselected.
  - Linking adds no transaction and changes no amount, status or statement identity.
  - One transaction ↔ one occurrence.
  - The 4A.9 matching rules are unchanged.
- **[Verified implementation]**
  - **Engine:** `occurrenceLinkProblem` and `LINK_WINDOW_DAYS` (31).
  - **Data:**
    - `findOccurrence`, `linkCandidatesForOccurrence` (structural fit plus an amount fit or evidence), `linkCandidateLabel`;
    - `linkTransactionToOccurrence` (with `replace`) and `unlinkTransactionFromOccurrence`;
    - `occurrenceRefProblem` now also checks type and direction;
    - `updateTransaction` refuses an edit that no longer fits a kept link (unlink first).
  - **UI:** web `AddTransaction` and mobile `app/add.tsx`:
    - the Mark paid choice, with the form hidden while linking and a "Link transaction" button;
    - "Records the scheduled payment … · Unlink" in the Edit form.
- **[Decisions, mine; documented]**
  - The link window is 31 days around the due date.
  - The candidate list needs an amount fit or name/history evidence, so a month of unrelated purchases isn't offered (found in the first browser run: Shell, groceries…). The link command accepts any amount, because the link is the user's explicit choice.
  - Amount and date edits keep a link.
  - Reassigning a link is explicit (`replace`), or Unlink and link again.
- **[Data model]** No schema change and no migration: the existing `occurrenceRef` field.
- **[Known limitations]**
  - There is no "link to a scheduled item" action starting from a transaction: linking starts from the scheduled item (Mark paid). The Edit form only unlinks.
  - ~~A payment more than 31 days from its due date can't be linked.~~ **Fixed in 4A.11** for overdue occurrences (up to 62 days after, on request).

## Phase 4A.11 (2026-11-15): overdue payment linking and orphaned-link recovery (audit of 4A.10, D1 and D2)
- **[Confirmed policy, from the phase brief]**
  - The 31-day list stays the default. For an overdue occurrence only, a deliberate "Show older transactions" lists payments up to 62 days after the due date, with days shown and nothing selected.
  - When no transaction is selected, the dialog explains Skip vs a new payment; nothing is automatic.
  - The Edit form always offers Unlink and explains a missing or changed item. Links are never moved silently.
- **[Verified implementation]**
  - **Engine:** `OVERDUE_LINK_WINDOW_DAYS`, and the `older` option of `occurrenceLinkProblem` (overdue occurrences only, re-checked on the current data).
  - **Data:**
    - `linkCandidatesForOccurrence(…, { older })`, with candidates gaining a `daysAfterDue` field;
    - `linkCandidateLabel(…, { showDays })`;
    - `linkTransactionToOccurrence(…, { older })`;
    - `linkedOccurrenceState` (ok / item_missing / occurrence_missing / invalid).
  - **UI:** web `AddTransaction`, mobile `app/add.tsx`.
- **[Data model]** No schema change and no migration.
- **[Decisions, mine; documented]**
  - The early side (before the due date) keeps the 31-day limit.
  - "invalid" checks type, account and direction only; a kept link's date may have been edited on purpose.
  - The Skip explanation points to Planning rather than adding a Skip button to the dialog (not requested).
- **[Lesson]** In demo (sample-data) mode the idle lock is off, so browser tests can move the clock forward (plus a focus event) to make sample bills overdue.
- **[Known limitations]**
  - An overdue occurrence is shown only up to 62 days back, so a payment for an older bill can't be linked. Its occurrence no longer counts either.
  - An "invalid" link (the bill moved to another account) is reported but still counts as paid until the user unlinks it.


## Phase 4A final check (2026-11-15, read-only): stale and legacy links
- **[Verified by probe]** No path through the apps makes Safe to Spend too high:
  - moving a bill to another account, or changing a transfer's destination: no effect;
  - changing a schedule: the forecast is too cautious (flagged in the Edit form);
  - changing an item's type would overstate it, but neither app lets an existing item's type change.
- **[Open, low]** After a bill moves to another account, the Edit form flags a correct link as "no longer fits… Unlink it" and refuses other edits. Unlinking lowers Safe to Spend by the bill amount and can't be undone by re-linking.
- **[Open, low]** Data written before 4A.9 can hold two transactions linked to one due date (two rows of one statement). Balances are unaffected and the forecast counts it once; variable-bill estimates are skewed slightly. Editing either transaction is refused until one is unlinked (the message says so). No repair is needed.
- **[Decision]** Phase 4A financial engine declared complete at f7bcb82.

## Phase 4B audit (2026-11-15, read-only): product experience priorities
- **[Open]** In priority order:
  1. wording and clutter fixes (done in 4B.1);
  2. Home hierarchy and repeated figures (owner to decide whether Safe to Spend becomes the headline);
  3. a "Paid this month" section in Planning;
  4. a catch-up review for overdue and unrecorded items;
  5. a mobile device test before any mobile redesign.
- **[Keep]**
  - onboarding flow;
  - Capture's review-before-approval model and field-source labels;
  - the Add dialog;
  - "Why this number?";
  - exact terms;
  - the restrained visual style.

## Phase 4B.1 (2026-11-15): small product experience improvements
- **[Verified implementation]** Web and mobile:
  1. The Safe to Spend "after the low point" sentence agrees in number: "Rent ($1,200.00) comes … so it doesn't lower Safe to Spend". Wording only (`packages/engine/src/plan.ts`).
  2. The web "Next after …" caption has an 8px gap below the explanation (`.sts-note`). Mobile already had one.
  3. Web Home no longer has its own header Add Transaction button. Entry stays in the sidebar (desktop), the tab bar "+" (narrow windows), the `N` shortcut and the empty-state button. Mobile Home had none (tab bar "+").
  4. Capture says "No account was mentioned in N drafts, so X is used for them." once per batch when 2 or more drafts use the same default account (`batchAccountNote`, `draftCardIssues` in `packages/capture`). A single draft keeps its own note. Review issues, readiness, approval and field-source labels are unchanged.
  5. The first onboarding question shows `BALANCE_ENTRY_SHORT` ("The posted balance your bank shows right now.") with a "More about this balance" disclosure (web: `aria-expanded`/`aria-controls`; mobile: `accessibilityState.expanded`). It reveals the unchanged `BALANCE_ENTRY_HINT`. Account dialogs and Update balance still show the full hint.
- **[Data model]** No change. No calculation changed.
- **[Tests changed on purpose]**
  - `phase3c.spec.ts` now uses the sidebar button (the Home header button is gone).
  - `phase4a56.spec.ts` opens the disclosure before checking the hint text.

## Phase 4B.2 (2026-11-15): Home hierarchy and clarity
- **[Decision, user]** Home's order of importance:
  1. Current recorded balance (How much do I have?);
  2. Safe to Spend (How much can I safely spend?), prominent and never below the forecast;
  3. Projected month-end balance (Where am I heading?), as a supporting figure.
- **[Verified implementation]** Web and mobile, from the shared view model:
  - **Web:**
    - A hero card shows the recorded balance (`available-cash`).
    - Safe to Spend sits beside it.
    - A forecast card holds month-end, any non-repeated low point and the chart.
    - Grid areas put Safe to Spend right after the balance on one column (≤1080px).
    - The separate "Key balances" row is gone.
  - **Mobile:** recorded-balance card (`recorded-balance`), then Safe to Spend, then a Projected month-end card with the supporting figures and the chart. The "Key balances" card and the duplicate "Lowest … on …" chart caption are gone.
  - **`buildHomeView().show`** (`packages/data/src/homeView.ts`): a figure is hidden only when it is the very same amount on the very same date as one already shown.
    - `stsLow` is hidden when it equals today's balance, or equals Safe to Spend itself (no reserve).
    - `monthLow` is hidden when it is Safe to Spend's low, or today's balance.
    - `lowBeforeIncome` is hidden when it is either of those points, or there is none. Mobile still shows "—, No income with a known amount is scheduled", because mobile Home has no Next income card.
    - `endOfDay` is hidden when `quietToday`, or when it equals today's low already shown.
  - **Distinct labels** (`LOWEST_THROUGH`, `LOWEST_MONTH_SUB` in terms.ts):
    - Safe to Spend's card: "Lowest through Dec 31 · Dec 1  $2,627.17".
    - The forecast card: "Lowest balance this month · Nov 18 · through Nov 30  $2,779.83".
  - **Safe to Spend card** keeps the amount (or Short by), caption, its low, "Next after …", the not-counted income note, Can I afford this? and Why this number?. The breakdown and the "after the low point" sentence moved into Why this number? (`view.stsExplanation`: the engine's explanation, with that sentence added to the summary; lines and assumptions unchanged).
- **[Verified]** No calculation changed. Every Home amount in the cross-platform fixture is unchanged; the fixture now also records which figures are hidden and why.
- **[Kept]** The user-approved blue glow, now on the two headline cards (balance and Safe to Spend). No new gradients.
- **[Lesson]** Full-page Playwright screenshots can show the forecast chart empty (the viewport is resized during capture); viewport screenshots show it. Not an app defect.
- **[Lesson]** Keyboard shortcuts are ignored while a dialog is still closing (`anyOpen`), so a test that presses a shortcut right after Escape must wait or click instead.
