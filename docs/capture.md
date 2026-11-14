# Clarity Capture

Describe financial activity in plain language ("Yesterday I spent $45 at Walmart on groceries, $18 at Starbucks for coffee, and today I paid $65 for gas at Shell"). Clarity prepares **drafts** for review; only approved drafts become transactions.

## Where the text is processed
**On the device.** `packages/capture` is a deterministic interpreter: rules, word lists, the user's categories and their merchant history. There is no network call, no model and no provider; it works offline, and the CSP still blocks every other origin. The `Interpreter` interface (`runsOn: 'device' | 'cloud'`) and `parseDrafts()` (which validates untrusted output) are the seam for adding a cloud AI later. That would need the user's consent and a server; see `accounts-architecture.md`.

## Pipeline
1. **Interpret** (`interpret.ts`): split into one activity per amount, with "$120 at Costco: $70 …, $30 …" kept as one split transaction. For each activity it reads:
   - dates (`dates.ts`), which carry forward through the message;
   - amounts (`amounts.ts`), using string arithmetic in integer cents;
   - the kind of activity: transfer, savings, card payment, refund, income or expense;
   - merchant, category, accounts and splits.
2. **Validate** (`schema.ts` → `parseDrafts`): types, positive whole cents, real ISO dates, known kinds. Unknown category or account ids are dropped. At most 50 items and 4,000 characters.
3. **Review** (`review.ts` → `reviewDraft`): deterministic issues, recomputed on every edit.
   - *Blocking*: missing amount, date, merchant or account; an approximate amount; another currency; an unclear type; a date that wasn't mentioned (today is filled in) or could be read two ways; a card or savings account that doesn't exist; parts that don't add up; a split part without a category; a possible duplicate.
   - *Confirmable*: some blocking issues can be confirmed instead of changed.
   - *Notices*: a default account (shown only when the user has several accounts), a description used instead of a merchant, a future date, a date before the account was added (kept as history; no balance change).
4. **Approve** (`toTxInput` + `addTransactions`): the same validated commands as manual entry, applied as one atomic write. If any item fails or storage fails, nothing is saved and the drafts stay. Provenance is `{ source: 'capture', rawDescription: <the user's words> }`, stored encrypted.

## Rules that protect accuracy
- The interpreter never sets a value it did not read. Defaults (today's date, the default account, the base currency) are labelled, and the date default blocks approval until confirmed.
- Transfers, card payments and savings contributions are transfers: never income or spending. A purchase *with* the card is an expense on the card; a payment *to* the card is a transfer.
- Categories come from, in order: the user's words, matched to their own category names first; their past choices for that merchant (corrections are remembered this way); the built-in keyword rules. New categories are never created.
- Drafts live only in memory (`apps/web/src/state/capture.ts`) and are cleared on lock. They never affect balances, budgets, the forecast or Safe to Spend.

## Tests
- `packages/capture/test/capture.test.ts`: parsing, review rules, schema, atomic batch, storage failure, effects on the dashboard and budget.
- `apps/web/e2e/capture.spec.ts`: the UI flows, including a simulated IndexedDB failure.

## Not in this phase
Voice, receipts, recurring descriptions, conversational corrections, a cloud model, and the native mobile app screen (the package is shared and ready for it).
