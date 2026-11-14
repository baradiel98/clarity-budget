# Clarity (working name)

Private, local-first personal finance for iOS, Android and desktop web. No bank connections, no account, no server. It answers five questions:
- How much money do I have?
- How much can I safely spend?
- What's coming up?
- Where will I be at the end of the month?
- Am I on track?

> Status: **Phase 1.** Automated tests run in a Linux container with Chromium only.
> - The web app is hosted on Render (`render.yaml`). The owner uses it in Safari on an iPhone, but no structured device test has been run there.
> - The native iOS/Android app has **not** been run on a device or simulator: only its tests and bundle builds are verified.
>
> See `docs/implementation-report.md` for exactly what is verified and `docs/device-test-script.md` for the device checklist.

## Repository
```
packages/   shared · engine · import · security · data · capture · design-system   (pure TypeScript, shared by both apps)
apps/web    desktop web app (React + Vite, IndexedDB, WebCrypto)
apps/mobile iOS + Android app (Expo / React Native, SQLite, Keychain/Keystore biometrics)
docs/       calculation rules · security · architecture · capture · accounts plan · device test script · report
```

## Run
Requires Node 20+.

```bash
npm install
```

Desktop web:

```bash
npm run dev -w @clarity/web
```

Mobile, using the Expo Go app (Face ID needs a development build):

```bash
cd apps/mobile && npx expo start
```

## Check
```bash
npm run typecheck && npm run lint && npm test
```

```bash
npm run build -w @clarity/web && npm run e2e -w @clarity/web
```

(The web app is also type-checked by its build; the root `typecheck` covers the packages.)

```bash
cd apps/mobile && npx tsc --noEmit && npx jest && npx expo export --platform ios --platform android
```

## Clarity Capture: plain-language entry, read on the device
"Yesterday I spent $45 at Walmart on groceries and $18 at Starbucks" becomes draft transactions. They are saved only after you review and approve them.
- **How it reads text:** `packages/capture` is a deterministic, rule-based interpreter: patterns, word lists, your categories and your merchant history. It is **not** an AI model or LLM, and nothing is sent anywhere.
- **What happens with unclear text:** wording it doesn't understand is flagged for you rather than guessed.

Details: `docs/capture.md`.

## Key documents
- `docs/calculation-rules.md`: every financial rule, with a worked example.
- `docs/security.md`: keys, recovery, backups, deletion, threat model, KDF benchmark.
- `docs/architecture.md`: shared vs platform code and data flow.
- `docs/capture.md`: how Clarity Capture interprets text and what blocks approval.
- `docs/accounts-architecture.md`: a **proposal** (not built) for optional accounts and sync.
- `docs/implementation-report.md`: what is done, what is verified, and what is not.
- `PROJECT_MEMORY.md`: durable decisions and lessons.
