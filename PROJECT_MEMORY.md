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
- Palette: one accent (deep teal), no purple gradients, no emoji, Lucide icons, Inter with tabular numerals.
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
- **[Verified]** Tokens: warm neutral backgrounds, deep teal accent, system font on Apple devices with Inter elsewhere, radii 8/10/16/22. Category hues come from `categorical` tokens.
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
