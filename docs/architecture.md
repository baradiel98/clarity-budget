# Architecture

```
clarity-budget/
  packages/
    shared/         types, money (integer cents), dates (ISO strings), default categories, exact UI terminology
    engine/         balances, recurrence, occurrences, forecast, Safe to Spend, Can I afford, explanations, validation, golden self-test
    import/         statement parsers (CSV now; OFX/QFX/XLSX/PDF slots), mapping/date/sign detection, categorization, duplicates, reconciliation
    security/       crypto provider interface, key slots, record encryption, backup format, vectors; providers: webcrypto (web), noble (mobile)
    data/           workspace store (encrypt → atomic write → memory), commands, undo, migrations, CSV export, demo data
    design-system/  tokens (colors, type, spacing, radii, motion, glass) → CSS variables for web, objects for mobile
  apps/
    web/            React + Vite desktop app (Dexie storage adapter, WebCrypto provider)
    mobile/         Expo / React Native app (SQLite storage adapter, noble provider, SecureStore + biometrics)
  docs/             calculation rules, security, competitive analysis, device test script
```

## Shared vs platform-specific
| Concern | Shared package | Web | Mobile |
|---|---|---|---|
| Financial math | engine | — | — |
| Statement parsing | import | file input, `File.text()` | document picker, expo-file-system |
| Crypto format | security | `createWebCryptoProvider` | `createNobleProvider(expo-crypto)` |
| Storage | data (`StorageAdapter`) | `DexieAdapter` | `SQLiteAdapter` |
| Unlock | data (`WorkspaceStore`) | passphrase | biometrics (SecureStore) + passphrase |
| UI | design-system tokens, terms | React DOM components, sidebar layout | React Native components, tab layout |

## Data flow
1. The app obtains `today` (`localISODate(new Date())`) and the decrypted `WorkspaceData` from `WorkspaceStore`.
2. Screens call `engineInput(data, today)` → `buildDashboard`, `computeSafeToSpend`, `canIAfford`, `balanceOnDate`. Screens never compute money themselves.
3. User actions call pure commands (`addTransaction`, `commitImport`, …) that validate and return `Op[]`.
4. `store.apply(ops)` encrypts each changed row and writes them atomically through the adapter, then updates memory and notifies subscribers. Undo stores inverse ops.

## Package rules
- Packages are pure TypeScript with no DOM or React Native imports (tsconfig `lib: ES2022`; the web provider is type-checked separately with DOM).
- Packages are consumed as TypeScript source by Vite and Metro (no build step).
