# Clarity (working name)

Private, local-first personal finance for iOS, Android and desktop web. No bank connections, no account, no server. It answers five questions:
- How much money do I have?
- How much can I safely spend?
- What's coming up?
- Where will I be at the end of the month?
- Am I on track?

> Status: **Phase 1, built and tested in a Linux dev container.** The mobile app and Safari/Edge are **not yet verified on real devices**. See `docs/device-test-script.md` and `docs/implementation-report.md`.

## Repository
```
packages/   shared · engine · import · security · data · design-system   (pure TypeScript, shared by both apps)
apps/web    desktop web app (React + Vite, IndexedDB, WebCrypto)
apps/mobile iOS + Android app (Expo / React Native, SQLite, Keychain/Keystore biometrics)
docs/       calculation rules · security · architecture · competitive analysis · device test script · report
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

```bash
cd apps/mobile && npx tsc --noEmit && npx jest && npx expo export --platform ios --platform android
```

## Key documents
- `docs/calculation-rules.md`: every financial rule, with a worked example.
- `docs/security.md`: keys, recovery, backups, deletion, threat model, KDF benchmark.
- `docs/architecture.md`: shared vs platform code and data flow.
- `docs/implementation-report.md`: what is done, what is verified, and what is not.
- `PROJECT_MEMORY.md`: durable decisions and lessons.
