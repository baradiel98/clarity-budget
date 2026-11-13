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

