# Financial calculation rules

These rules are implemented in `packages/engine` and are the **only** source of financial numbers on every platform. Each rule has tests in `packages/engine/test`. Golden scenarios (`packages/engine/src/golden`) are recomputed on device by the self-test screens to prove both apps produce identical results.

## Representation
- **Money** is an integer number of minor units (cents). No floating point is used anywhere in a calculation. `parseAmountInput` and `parseStatementAmount` parse text with string operations, never `parseFloat`.
- **Dates** are local calendar dates as `YYYY-MM-DD` strings. Date arithmetic uses integer day numbers, so results never depend on the device time zone or DST. The app converts "now" to a date string exactly once (`localISODate`).
- **Currency:** Phase 1 supports one base currency per workspace. The engine refuses to aggregate accounts in another currency (they are excluded from totals and a warning is shown) instead of producing wrong totals.

## Sign convention
Every transaction amount is its effect on **that account's** balance.

| Account | Positive balance means | Purchase | Payment / deposit |
|---|---|---|---|
| Checking, savings, cash | money you have | negative | positive |
| Credit card | (never; balance ≤ 0) | negative (more owed) | positive (less owed) |

A card owing $500 has balance **−$500**, displayed as "Owed $500".

| Kind | Sign | Counts as |
|---|---|---|
| expense | < 0 | spending |
| refund | > 0 | reduces spending in its category |
| income | > 0 | income |
| transfer | either (two legs that cancel) | **never** income or spending |
| adjustment | either, with a reason | **never** income or spending |

**No double counting of credit cards:** a card purchase is an expense on the card. Paying the card is a transfer from checking (−X) to the card (+X), so it is not spending. Totals for spending come only from `expense` and `refund`.

**Transfers** are always two legs sharing `transferGroupId`. They are created, edited and deleted together in one atomic write. A lone leg fails validation.

**Splits** must add up exactly to the total and have the same sign. **Pending** transactions count in the *recorded* balance, with a label. Changing pending to confirmed never changes an amount.
- **Pending credits are not spendable (Phase 4A.5.6).** A pending credit is a pending, positive transaction (refund, income, cashback; **Phase 4A.5.14: also the receiving leg of a transfer**, see Transfer settlement below). On checking, savings, cash and archived accounts it is in the recorded balance but **not** in the money the forecast starts from, so it cannot fund a transfer or bill, cover a shortfall or debt, raise Safe to Spend, or make "Can I afford this?" say yes. It counts on the day it is marked posted, exactly once. A future-dated pending credit is excluded too ("pending, not counted until it clears"). Pending **debits** stay counted. Cards: pending credits are added back to card debt (Phase 4A.5.4). Accounts in another currency stay excluded.
- **Transfer settlement (Phase 4A.5.14, owner decisions; supersedes "both legs post together").** Each leg of a transfer belongs to its own bank and settles on its own: its own status, posting date (`postedDate`, from the statement row), statement link, import and undo history. A transfer can be *not posted by either bank*, *sent · awaiting deposit* (sending leg posted, receiving pending), *received · not yet posted by the sending bank*, or *posted by both banks*. Nothing ever infers that one bank posted because the other did:
  - Linking a statement row to a transfer leg, "Mark posted", and Update balance post **that leg only** (plus a transfer fee recorded on that leg's account, which the bank shows as one row). A row imported as a new transfer posts this account's leg; the other account's leg is **pending** (awaiting its statement) unless dated before that account's confirmed balance date, which already includes it (posted, history only, Phase 4A.5.8 rule).
  - **Money in transit:** the sending leg (a debit) counts as soon as it is recorded; the receiving leg is a pending credit, so it can't raise Safe to Spend, fund a bill or another transfer, cover a shortfall, repay an overdrawn savings or archived balance, or make "Can I afford this?" say yes until the receiving bank posts it. Transfer neutrality therefore holds once **both** legs have posted, not while money is in transit (savings → checking $100 pending: Safe to Spend unchanged, not +$100; checking → savings: −$100 at once). Card payments: see the next point (Phase 4A.5.15).
  - **Card payments in transit (Phase 4A.5.15, owner decision; corrects 4A.5.14, which counted them twice).** A card payment that has been initiated (a recorded transfer from another account to the card) but not yet posted by the card issuer is counted **exactly once**: its sending leg is counted against the account it comes from (pending or posted, as for any debit), and the card debt it pays is **not** reserved again. It is a forecast-reservation rule only: the card leg stays pending, the card's posted balance and the paying account's posted balance are unchanged, ids and statement links are untouched. Example: checking $1,000, card owes $500, $200 payment pending at both banks → Safe to Spend $500 (checking $800, card $300), not $300. It doesn't matter which side posts first; Safe to Spend doesn't move when either side posts. Phase 4A.5.17: a recorded paying debit always counts against its account (as a pending or posted debit, or inside its opening or confirmed balance), so the offset never outruns the cash side; a returned payment is no longer in transit (see Returned card payments). Card payments are labelled "Sent · awaiting posting by Visa" ("awaiting deposit" stays for transfers between bank accounts). `isCardPaymentInTransit` (engine/balances.ts) excludes the card leg from the card's pending credits (`pendingCreditTotal`), so every calculation (Safe to Spend, "Can I afford this?", shortfall warnings, the forecast, "Why this number?") uses it; a future-dated pending payment moves both sides on its date. Limits: the offset is never more than the debt (what owes `max(0, …)`; an overpayment or a card already in credit leaves a credit that is never spendable); a pending **refund** on a card is still held back until it posts (Phase 4A.5.4); a **scheduled** payment that hasn't been recorded follows the scheduled-payment rules. A failed or reversed payment must be deleted (or its import undone): while it is recorded it is treated as on its way. "Why this number?" lists it: "Visa: $200.00 payment from Checking not yet posted by the card issuer — already counted from Checking, so the $200.00 of card debt it pays isn't counted again".
  - **Returned card payments (Phase 4A.5.17).** A statement row is a possible **return** of a card payment recorded in Clarity when all of these hold:
    - it is in an account the payment touched (the paying account, or the card);
    - its amount is exactly the payment's, in the opposite direction;
    - it is dated from the payment's date up to 30 days after (`MATCH_WINDOWS.returned`);
    - the payment has no recorded return yet.

    Words like "RETURNED", "REVERSAL" or "REJECTED" only rank the option first; they are never needed and never enough. The row is never selected by default. The user chooses "It's the return of this card payment" (several payments of the same amount are all listed), "Different transaction: import it as new", or "Leave it out". The return can't be imported silently as income.

    Confirming it records a **transfer back** (`returnOf` = the payment):
    - This account's side is the statement row (posted). The other side is pending, awaiting that institution's statement (on the card, the issuer's reversal).
    - The payment itself is not changed or posted: its legs, statuses, links and history stay. It simply stops counting as paying the card ("Payment returned"; no longer in transit), so the card's debt counts in full again and the returned money is back. It is not income.
    - If the card issuer never posted the payment, the payment's card side and the return's card side are both pending and cancel (`isVoidedReturnLeg`): the card is unchanged. They count again if the issuer posts either.
    - A payment's debit and its return can be in the same statement.
    - Re-importing recognises the return row. Undo removes the return, and the payment is on its way (or posted) again.

    Example: checking $1,000, Visa owes $500, a $200 payment pending at both banks, then the checking statement shows the −$200 debit and a +$200 return. Linking the debit and confirming the return gives Safe to Spend $500 (it was $700 when the return was imported as income). A return typed in by hand as income (not imported) isn't detected; "Why this number?" says what to do: choose the return option when the returned money shows on a statement, or delete the payment if it never left the account.
  - **Returned payments, continued (Phase 4A.5.18).**
    - **Partial returns.** A return can be any amount up to what is left of the payment. Several returns of one payment may be recorded (in one statement or over time); their total can never exceed the payment ("only $50.00 of this $200.00 payment is left to return"), so duplicates are refused.
    - While the card issuer has posted neither the payment nor a return, the returned part simply stops being "on its way": $200 paid and $80 returned leaves $120 lowering the card debt, and the card shows $120 (`returnedWhileUnposted`, `effectiveAmount`). Once the issuer posts the payment, each return's card side counts as a pending debit until the issuer posts the reversal.
    - The return's other side is always pending, awaiting that institution.
    - **Suggestions stay conservative.** The whole remaining amount within 30 days is suggested. A smaller amount (partial) or a payment more than 30 days old is suggested only when the description says so ("RETURNED", "REVERSAL", …).
    - **Linking by hand.** The user can always pick any eligible payment themselves: "This is a returned card payment…" in the Add/Edit form lists every payment from that account that still has something left to return, any age, any amount up to what's left. An older return is never treated as income just because it falls outside the window.
    - **Entered by hand.** Income or a refund typed into an account that a card payment came from is checked with the same rules (`returnOptionsForEntry`). When a return is plausible the form asks first: "It's the return of this card payment", "No, it's separate income", or close the form and decide later. Saving is refused until the user chooses; nothing is classified automatically.
    - **Same accounting everywhere.** Confirming records exactly what the import review records (`recordPaymentReturn`, the same builder as the import). An existing income transaction can be corrected into a return: it is replaced, keeping its date, status, import identity and statement link, so re-importing still recognises the row. "Separate income" is kept on record (`provenance.separateFrom`).
    - A return entered by hand and later shown on a statement is offered as that return's own transaction (a link), never as a second return. ~~Deleting a payment deletes its returns.~~ Superseded by Phase 4A.7 below.
    - **Review row.** A row confirmed as a return shows "Returned card payment — Linked as the return of $80.00 of the $200.00 payment to Visa on Sep 10, not imported as income" in place of its type and category. The button says "Record 1 returned payment", and the result "1 returned card payment recorded".
  - **Returned payments: lifecycle integrity (Phase 4A.7, audit 4A.6 H1, H2, H3, M1, M2).** A payment and its returns stay linked, whichever way either was entered. Every rule is enforced by the data commands (both apps go through them), not only by the screens.
    - **Clarity Capture** checks money coming in (an income or refund draft) with the same rules as the Add form (`draftReturnOptions`, built on `findReturnCandidates`). When a return is plausible, the draft "Needs attention" until the user chooses "It's the return of this card payment" (or a partial return), "No, it's separate income", or leaves the draft for later. The other drafts in the same entry can still be approved. A confirmed return is saved through `recordPaymentReturn` (`saveCaptured`), exactly like a return entered by hand or confirmed in the import review. The interpreter can never make this choice: `parseDrafts` never copies it. `saveCaptured` refuses captured income that could be a return unless the user said it's separate for every current suggestion (`provenance.separateFrom`), so a payment recorded in another tab since the review asks again. A card payment captured in the same entry as a deposit doesn't count (the user reviewed them together).
    - **Undoing an import** that added a card payment is refused while a return is recorded against that payment by hand, by Capture or by a later import (`importUndoProblem`). The message names each return and how to remove it ("Undo the import that recorded a return (Import history), or delete the return itself, first. Nothing was changed."). Nothing is partially undone and no return is deleted to make the undo possible. A return recorded by the same import is removed with it. Undoing an import that only linked (posted) a payment is allowed: the return stays valid. The check runs on the data the command commits against; another tab's newer data is refused at storage (revision check).
    - **Deleting a payment** that has returns is refused (`deleteProblem`), from either leg, the Edit form or the list (bulk delete deletes returns before payments, so a payment selected with all its returns can go). Deleting a return itself is always allowed: the payment counts as paying the card again. This replaces 4A.5.18's cascade, which silently erased the returns and their statement evidence. Import history stays consistent, and re-importing a statement whose return is still recorded finds it as an exact duplicate.
    - **Editing a payment** that has returns (`returnEditProblem`): its amount can't go below the total returned (equal is allowed: fully returned), its paying account and card can't change, it stays a transfer, and it can't be dated after its first return. The description, notes and settlement status can change, and its statement link and import identity are kept. **Editing a return** keeps it a return (`returnOf` is kept), keeps its accounts, can't be dated before the payment, and can't exceed what is left of the payment. To correct a returned payment otherwise, remove its returns first, then edit or delete it.

    Examples (checking $1,000, Visa owes $500, $200 payment; truth by hand): returned via Capture → $500 (was $700). Fully returned payment edited to $100 → refused, $500 (was $600, with $100 created). Undo of the payment's import after its return → refused, $500 (was checking $1,200 and Visa $700 with an orphaned return).
  - **Card payment and its return in the same statement (Phase 4A.8, audit 4A.7.1 N1).** A statement can show a payment ("PAYMENT TO VISA −$200") and its return ("RETURNED PAYMENT +$200") when neither is in Clarity yet: a first import, or after the user deleted both. The import review pairs rows of that same statement as a **proposal only** (`statementReturnOptions`).
    - **When a pairing is offered:** all of these must hold, never the amount alone:
      - a non-card account's statement;
      - the money-in row says it is a return (RETURNED, REVERSAL, REJECTED, NSF, …);
      - the money-out row looks like a card payment, or at least says "payment";
      - the return is no larger than the payment, dated on or after it, within 30 days;
      - neither row is already in Clarity.
    - **The user's choice.** Every possible payment row is listed, exact amounts and card wording first, then the closest date. The return row stays unselected until the user picks "It's the return of the card payment in row N" or "No, it's a separate transaction", or leaves it out.
    - **What is recorded.** The payment row must be imported in the same import as a transfer to a credit card. `commitImport` creates it first, then records the return with the same builder and cap as every other return (`buildPaymentReturn`). Each row is its own account's posted statement row. Visa's side of both stays pending: nothing is posted for the other bank. Undo removes both.
    - **Checked at commit.** The pairing is re-derived from the rows being imported, and the import is refused, with nothing changed, if any of these holds:
      - the payment row was left out, isn't a card transfer, or was linked to an existing transaction instead;
      - the pairing wasn't offered;
      - a row changed;
      - a row was added elsewhere since (for example, in another tab).
    - **A rejected pairing** imports the money as new (the user's decision), so it counts. Example (checking $1,000, Visa owes $500): paired → $500; "separate" → $700.
  - **Card-payment wording (Phase 4A.8, N4).** An outgoing row counts as a card payment (a transfer, unselected until the card is confirmed) when its description says so ("PAYMENT THANK YOU", "AUTOPAY", "CARD PAYMENT", …), or says "payment" (PAYMENT, PMT, PYMT) together with a card name or network ("PAYMENT TO VISA", "VISA PAYMENT", "CHASE FREEDOM PMT").
    - The review suggests the one card the description names, by account name, or by a network only one card's name contains.
    - "Payment" alone ("PAYMENT TO CITY WATER", "ONLINE PAYMENT 1234") or a card word alone ("VISA GIFT CARD") is not a card payment.
  - **Transfer fees never shrink a returned payment (Phase 4A.8, N2).** Linking a statement row that shows less arriving than was paid, as "the payment plus a fee", makes the payment what arrived. That is not offered when more than that was already returned. The review shows "Can't be linked: $200.00 of this payment was already returned, so it can't become $150.00 with a transfer fee…".
    - `commitImport` checks this again itself (the fee branch).
    - After every import, `commitImport` also checks that no card payment it touched has more returned than its amount, whatever the order of the rows (a fee row and a reversal row on one card statement). Otherwise the whole import is refused.
  - **Opening-balance correction (Phase 4A.5.18).** A pending item dated before an account was added counts (Phase 4A.5.17). If it had in fact already posted then, so it is inside the balance the user entered, there are two routes:
    - link it to its statement row, dated before the opening date, which puts it in the opening balance;
    - with no statement, the Edit form's "It had already posted when I added {account}" (`markPostedBeforeOpening`), which marks it posted with no later posting date, so it counts as history.

    Both are the user's decision; the posted-balance convention is unchanged.
  - A posted balance "as of" a date leaves out a leg posted later (its `postedDate`), like the bank's own balance that day; a leg marked posted by hand has no known posting date and counts from its own date.
  - **Transfer fees** are explicit. When the amount on a statement differs from the transfer and the difference can be a fee (less arrived than was sent, or more left the sending account than was transferred), the row can be linked only if the user confirms the fee: the transfer becomes what arrived (both legs) and the fee is a separate expense ("Transfer fee", "Fees & interest") in the **sending** account, with that leg's status, so its bank total is unchanged ($100 sent, $95 received → transfer $95, fee $5, checking −$100, savings +$95). A transfer leg that already carries a fee is matched with it as one amount (−$95 − $5 = −$100). Any other difference (more arrived than was sent) can't be linked: the row stays unresolved ("Leave it out") unless the user says it's a different transaction. Nothing is changed silently; undo removes the fee and restores the amount, and refuses if the transfer was edited since.
  - Editing a transfer keeps each leg's own status unless the form changes it; a leg linked to a statement row can't be made pending by editing (undo the import instead). Deleting a transfer deletes its fee.
- **Opening balance and pending items (Phase 4A.5.17, owner decision; supersedes "everything dated before the opening date is history").** The opening balance is the bank's **posted** balance on the opening date, so it excludes anything still pending then, whatever its date. A transaction dated before the opening date is history (already in the opening balance, labelled "Before account added") only if it had posted by then. One still pending counts: a pending debit reduces the account; a pending credit, refund or incoming transfer is not spendable until it posts. Once it posts it keeps counting: its posting date (`postedDate`: the statement row's date, or today when marked posted by hand) is on or after the opening date. A statement row dated before the opening date shows it posted before, so it was in the opening balance. Update balance and statement reconciliation compare posted with posted, so a pending item is never counted twice (`inOpeningBalance` in engine/balances.ts). Before 4A.5.17 a pending $200 debit made two days before the account was added was ignored ($1,000 instead of $800).
- Four separate figures: **recorded balance** (everything, pending included; never changed by this rule), **pending credits** (shown per account), **spendable money** (recorded − pending credits, the forecast's start), **projected balances** (forecast).

## Balances
- **Recorded balance** of an account = opening balance + every transaction dated on/after the account's opening date and on/before today.
- Transactions dated **before the opening date** are history only (for example, an older imported statement). They are already reflected in the opening balance.
- Transactions dated **after today** are *planned*. They appear in the forecast on their date, not in today's balance.
- **Available cash** = sum of active, spendable, non-card accounts in the base currency. **Owed on cards** is shown separately and never mixed into cash.
- **Update balance** creates an `adjustment` transaction for the difference, with a reason. History is never edited.
- **Balance convention (Phase 4A.5.6, revised in Phase 4A.5.8).** Every balance the user types in (onboarding, a new account, Update balance) is the bank's **posted (cleared) balance right now, without pending items**.
  - **Signed (Phase 4A.5.8).** Checking, savings and cash are signed: an overdrawn account is entered with a minus sign (`-50.00`) and stored negative; the sign is never dropped. Invalid text gets a message ("Enter a balance like 1250.00, or -50.00 if the account is overdrawn."). Web inputs keep the minus; mobile uses a keyboard with a minus key, and onboarding's keypad (no minus key) has an explicit "This account is overdrawn" choice. One parser, `parseBalanceEntry` (shared), serves web and mobile.
  - **Cards (Phase 4A.5.8).** A card is entered as an amount plus **Owed** or **In credit**; a typed minus sign is refused ("Enter the amount without a sign, then choose Owed or In credit."). The data layer receives the amount owed, signed (positive owed, negative in credit) and stores the negative of it (owed = negative balance, credit = positive). Before Phase 4A.5.8 the data layer took `abs()`, so a card in credit could not be represented or reconciled. A card in credit is shown as "In credit $50.00"; it isn't spendable and nothing is owed.
  - **Confirmed balance date.** The opening date, and every Update balance — including one that matched exactly (stored on the account as `balanceConfirmedDate`; no $0 transaction) or an adjustment. `balanceAsOfDate` = the latest of these.
  - **History only (`includedInBalance`, with `includedAsOf`).** A transaction kept for history but not added to the balance again. Valid only on a **posted** transaction dated from the opening date through the account's confirmed date (never pending, never future-dated). The data layer refuses the flag otherwise with a message; the engine ignores an invalid flag that bypassed it (a pending item stays pending; a future one stays in the forecast).
  - **Default for backdated entries (owner decision, Phase 4A.5.8: strictly before).** A posted transaction **dated before** the account's latest confirmed date, entered after that confirmation, is history only by default ("Already included in balance as of Nov 20"). One **dated on** the confirmed date counts by default (a purchase made after reconciling usually isn't in the bank's figure); "Already included" is offered unticked. The user's explicit choice is never overridden; on an edit the stored state is kept. Applies to Add Transaction, Capture, mark-paid and statement import (import review says "Before this account's confirmed balance (Sep 8): already included in it").
  - **Transfers.** Each leg is one account's effect and is decided against **that account's** confirmed date (`includedInBalance` for the sending side, `toIncludedInBalance` for the receiving side). Both legs always exist and stay linked; a leg is history only when that account's confirmed balance already contains it, so no money is created or lost relative to the balances the user confirmed. Transfers between currencies are refused (unchanged).
  - **Labels.** History-only transactions show "Already in balance · Nov 20" (reason: "Already included in balance as of Nov 20. Kept in history, not added again."); ones before the opening date show "Before account added".
  - **Update balance compares posted with posted:** the adjustment is bank posted balance − Clarity's posted balance (recorded − every pending item). Pending items are never absorbed into an adjustment (case O4: $500 posted, $300 pending deposit, update to $500 → no adjustment; $500 spendable, $800 recorded).
  - **No silent passes (Phase 4A.5.10).** Every same-direction pending item is listed (no cap). Any combination of pending items, of any size, that adds up to a positive difference contains at least one deposit (a negative one, at least one purchase), so a combination too large for the exact search (more than 3 items) always leaves at least one item listed and the adjustment needs confirmation. The wording says so: "Pending items could explain some or all of this difference … Clarity checks exact combinations of up to 3 items only".
  - **Partial matches (Phase 4A.5.9).** A pending item in the same direction as the difference (a deposit for a positive one, a purchase for a negative one) that isn't part of an exact set could explain part of it (it may have cleared for a different amount, or with something else). It is shown ("Pending items could explain part of this difference"), with the consequence: recording the difference now and later marking the item posted counts the overlapping part twice. Recording needs the same confirmation; nothing is posted automatically. This check is linear (no combination search); exact combinations are still searched up to 3 items, and any item of a longer combination still appears as a partial match, so nothing passes silently.
  - **Pending-match safeguard (Phase 4A.5.8).** If the difference equals the amount of one pending item, or of a set of up to 3 pending items (credits and debits, signed), one of them may have cleared at the bank. Update balance shows each matching item (date, description, type, amount), offers **Mark posted** for each, and refuses to record the adjustment until the user either marks the cleared item posted (Clarity recalculates; usually the balance then matches exactly) or confirms the difference is unrelated (the adjustment is recorded with "Confirmed not related to pending items (kept pending): …" and the items stay pending). Nothing is marked posted automatically; several matches (same amounts, coincidences) are all shown.
  - **Exact match (Phase 4A.5.8).** "Confirm balance" records the confirmed date only; no transaction; "… matches your bank's posted balance as of Nov 13. No adjustment needed."
  - **Balance adjustments can't be edited** (Phase 4A.5.8): editing one as an expense or income flipped its sign; delete it or use Update balance again.
  - Adjustments recorded before Phase 4A.5.6 (under the old recorded-vs-recorded comparison) are not rewritten.
- **Statement import reconciliation (Phase 4A.5.9).** A statement's ending balance is a posted balance, so it is compared with Clarity's **posted** balance after the import (pending items left out), the same convention as onboarding, a new account and Update balance. Before Phase 4A.5.9 it was compared with the recorded balance (pending included): a pending deposit not on the statement produced a −$300 adjustment ($990 spendable became $690), and a pending purchase a +$120 one (overstating by $120).
  - **Statement matching (Phase 4A.5.12; supersedes the single "pending twin" of 4A.5.9/4A.5.10).** For each statement row, `findMatchCandidates` (packages/import/src/matching.ts; windows in `MATCH_WINDOWS`) lists EVERY existing transaction in that account it could be:
    - **pending** transactions in the same direction (money in / money out), **any amount**, dated from 3 days before to 10 days after the row date (card holds and deposits commonly post within a week; 10 adds weekends/holidays). No amount tolerance is used: a different amount is always shown with the difference ("statement differs by −$10.00") and only ever linked if the user picks it;
    - **posted, unlinked transfer legs** dated from 3 days before to 10 days after (Phase 4A.5.14: was 7 days and exact amount only); any amount, with the difference shown, so a fee can be confirmed (see Transfer settlement). Each leg is matched on its own; with per-leg settlement a posted unlinked leg is one marked posted by hand (or entered as posted) before its statement;
    - **stale candidates (Phase 4A.5.14):** pending transactions in the same direction dated MORE than 10 days before the row (a check entered Sep 2 and cashed Sep 17), any amount, and older posted unlinked transfer legs of exactly the row's amount. Listed after the others under "Older pending transactions (outside the normal 10-day matching window)", each with its age ("entered 15 days before this row"); never chosen automatically; "different" must include them. Items dated before the account's opening date aren't in its balance and aren't listed. Before 4A.5.14 such a check was not listed: the row was imported and the check stayed pending, counted twice ($600 instead of $800) with the balance check saying "Matches";
    - anything that was a candidate when the review was built, even if posted since (shown as "posted"), so a review never goes stale silently.
    Already-linked transactions are excluded. Order: same amount first (closest date first), then different amounts (smallest difference, then closest date); description only breaks ties. Each candidate shows date, description, amount, account and status. **Nothing is pre-selected**; a row with candidates can't be imported until the user picks "It's this one: …" (that exact transaction), "Different transaction: none of these" or "Leave it out". One transaction can be chosen by one row only. File order never decides anything (Phase 4A.5.11 F1/F2).
    - **The data layer decides with the current data at commit:** a chosen transaction must still be a candidate (else "review it again"); "different" must list every current candidate (a new one that appeared since → refused); a row that had candidates is never imported without a decision, even if they were linked since (the same review committed twice adds nothing).
    - **Snapshots (Phase 4A.5.14):** each decision carries what the user saw of every candidate (id, account, amount, date, status, kind and version). At commit a chosen candidate, and every candidate a "different" decision ruled out, must be exactly as seen and still unlinked; anything edited, posted, deleted or linked to another row since is refused ("changed after you reviewed this row … Review it again"). Every row that was not already in Clarity when the review was built is checked again: if it is in Clarity now (added or linked since, e.g. in another tab), the commit is refused.
    - **Re-import after edits (Phase 4A.5.14):** a linked transaction stores the row's own amount (`statementMatch.amountCents`), and an imported one the row's date and amount (`provenance.rowDate/rowAmountCents`), so re-importing the statement still recognises the row after the user edits the amount, date or description (before: editing a linked $60 dinner to $55 let the row in again).
    - **What the import did** is reported separately: "N new transactions imported · N existing transactions linked (N marked posted) · N transfer fees recorded · N transfers awaiting the other bank" (done screen and history). Linking is never called importing. Undo says what it reverted per leg, including "the other side in Savings is unchanged (pending)".
    - **It's this one:** the transaction keeps its id and amount; a pending one is marked posted (Phase 4A.5.14: that leg only, never the other side of a transfer), a posted one (e.g. a transfer leg) is just linked; nothing new is added. If the amounts differ, the original amount is kept and the balance check shows the difference, which the user can record as an adjustment or fix by editing (never changed automatically).
    - **Different transaction:** imported, with `provenance.separateFrom` listing every candidate the user ruled out.
    - **One place to decide:** in the import's balance check, a pending item that is a candidate of a row says "resolve it in row N above" instead of offering its own Mark posted. Undo says what it reverted ("Import undone. Removed N imported transactions; “X” is pending again and no longer linked to the statement."). The import button says what will happen ("Link 1 to existing").
  - (Phase 4A.5.10, refined above.) A statement row that could be a pending Clarity transaction can only be imported with an explicit decision (the data layer refuses otherwise; nothing is ever matched automatically):
    - **Same transaction:** no new transaction. The pending one keeps its id, merchant, date and category, is marked posted (Phase 4A.5.14: that leg only), and records `statementMatch` (import, row, the statement's date and description, its previous status). Listed as "Matched to statement". Undoing the import restores the previous status (Phase 4A.5.14: only if this import changed it, only that leg, and never over a later import's link: undo is refused when a later import is linked to something this import created) and removes the link; edits keep the link; re-importing the statement recognises the row ("Already matched to …").
    - **Different transaction:** imported as well, with `provenance.separateFrom` recording the decision; both count by their own status and account dates.
    - **Leave it out** (default).
    - Before Phase 4A.5.10 the row could be included without a decision; if the pending one was later marked posted, the deposit was counted twice ($1,590 instead of $1,290).
  - If the difference matches pending items exactly or partly, the review names them with **Mark posted**, and the adjustment can only be recorded after the user confirms they're unrelated (recorded with that note).
  - A statement that ends before the account's confirmed balance date is not used to adjust it ("…so its ending balance isn't used to adjust it"). Rows dated before the confirmed date are history (Phase 4A.5.8 rule); transfer rows decide each leg against its own account's date.
- **Overdrawn accounts (Phase 4A.5.8).** A spendable account already below zero today is counted in Safe to Spend directly and, when other spendable accounts can cover it, warned about ("Wallet is overdrawn: −$50.00 today").
- **Savings and other non-spendable accounts (Phase 4A.5.9, owner decision; supersedes the Phase 4A.4.4 rule for them).** A positive or zero balance has no effect on Safe to Spend. A **negative** balance is owed and reduces Safe to Spend by that amount, active or archived ("Savings is overdrawn by $50.00"; archived: "… is archived and overdrawn by …"). Example: Checking $1,000 + Savings −$50 + Cash $100 = $1,050. Positive archived balances are unchanged (still not spendable). Other currencies are excluded.
  - **Counted once.** The debt is counted against the spendable accounts today and the account is treated as $0 in the projection, so a bill paid from it later is counted in full once (−$50 owed + a $100 bill = $150). Money that later arrives in it (a transfer from checking, income, a move from another savings account) **repays the debt first**: that part is given back to the spendable accounts on that day ("$50.00 of it repays an overdrawn balance already counted"), the rest lands in the account. So a $100 transfer into savings at −$50 costs $100 in total, not $150. Pending credits into it don't repay it until they post. Warnings about the account report its real (negative) balance.
  - A savings account marked spendable is spendable money (counted directly, once).

## Recurring schedules
- Frequencies: once, every N days, weekly, every 2 weeks (from a real anchor date), twice monthly, monthly, quarterly, annually (monthly with interval 1/3/12).
- Day 29–31 falls back to the last day of shorter months (Jan 31 → Feb 28, or Feb 29 in leap years). A "last day" anchor is supported.
- **Weekend rule** (`none` | `before` | `after`) moves a Saturday/Sunday date to Friday or Monday, only when configured.
- **Exceptions** per occurrence: skip, move (new date), override (new amount).
- **Pause:** no occurrences from the pause date. When resumed, the paused period is never reported as overdue.
- **Amounts:** `fixed`; `variable` (estimated as the average of the last 3 recorded payments, or else the user's estimate); `unknown` (income "It varies", counts as $0); `card_full_balance` (the card's projected owed balance on that day).

### Occurrence status
| Status | Meaning | In forecast? |
|---|---|---|
| confirmed | a transaction is linked (`occurrenceRef`) | no (already in the balance) |
| expected | fixed amount, today or later | yes |
| estimated | variable, history average or card balance | yes, labelled |
| unknown | income with no amount | no, listed with a prompt |
| skipped | user skipped it | no |
| overdue | date passed, nothing recorded (within 62 days, after `trackFrom`) | **bills:** yes, counted *today*. **income:** no, flagged "not recorded" |


### Linking a transaction to a scheduled item (Phase 4A.9)
A link (`occurrenceRef`) marks that occurrence **confirmed**, so it leaves the forecast: a wrong link removes a real upcoming bill from Safe to Spend. The rules:

- **Eligible** (`occurrenceEligible`), all of:
  - not already recorded or skipped;
  - the same account and direction;
  - dated within ±7 days of the occurrence (overdue: up to 20 days after it);
  - an amount that fits: exact for a fixed or overridden amount, within 25% of an estimate, and for an unknown amount or a card's full balance a description resembling the name;
  - (new) the kind fits: an expense pays a bill or subscription; income is expected income; a transfer is a scheduled transfer or savings move to the same other account; a refund never settles anything.
- **Evidence beyond amount and date** (`occurrenceEvidence`):
  - *name*: every distinctive word of the item's name is in the description ("Rent" in "ACH RENT OAKWOOD"; words such as "bill", "payment" or "card" don't count), or the two are very similar;
  - *history*: the user linked a transaction with the same payee to this item before.
- **Strong**: evidence plus no equally good alternative (no other item with evidence; no other occurrence of the same item equally close). Only a strong suggestion is ticked by default, in the import review and the Add form.
- **Anything else is a suggestion only**: shown as "Electricity?" with "Could be Electricity (due Nov 18): only the amount and date are close. Not linked unless you tick it." The row imports normally and unlinked unless the user ticks it.
- **`commitImport` checks every link against the current data.** The import is refused, with nothing changed, if any of these holds:
  - the item no longer exists, or the occurrence was changed, paused or skipped;
  - the occurrence is already recorded by another transaction;
  - two rows link the same occurrence;
  - the row no longer fits it with the kind and account chosen.
- **`addTransaction` / `updateTransaction`** (Mark paid, the Add form, linking later) refuse a link to an item that no longer exists, to one scheduled from another account, or to an occurrence another transaction already records. Amount and date may differ: the user records what was actually paid.

Example (sample data, Nov 13): Electricity, variable, estimated $91.40, due Nov 18. A "PAYMENT TO STORE CARD −$100" row on Nov 12 used to be linked to it by default, so Safe to Spend showed $2,268.57 instead of $2,177.17. Since 4A.9 a card payment can't settle a bill. "ONLINE PMT 7781 −$100" is only a suggestion, not ticked: imported unlinked, Electricity stays due, $2,327.17. "CITY ELECTRICITY CO −$91.40" is strong: linked, Electricity paid, $2,427.17.
## Forecast
A day-by-day timeline of available cash from today to the horizon. On each day the **outflows are applied before inflows**: a bill due on payday must be covered by money you already have. The day's *low* (after outflows) is what "lowest balance" and Safe to Spend use.

Events in the timeline:
- planned (future-dated) transactions;
- recurring occurrences, including transfers and savings, which reduce cash only if money leaves a spendable account;
- overdue bills (placed today);
- hypothetical purchases ("Can I afford this?"), which are never saved.

## Headline numbers
- **Projected end of today** = today's recorded cash + today's remaining scheduled items.
- **Upcoming (dashboard)** lists overdue items and everything from today through **at least month-end** (or 14 days, whichever is later). The cash items listed therefore add up to the projected month-end; a test checks this identity on 90 consecutive days of sample data.
- **Later, counted in Safe to Spend (dashboard, Phase 4A):** items after the Upcoming window through the Safe to Spend horizon (`Dashboard.upcomingLater`). The dashboard shows the first few and says how many more there are through the horizon date, with a link to Planning. Nothing Safe to Spend depends on is hidden from the user.
- **Projected month-end balance** = timeline value at the end of the last day of the month. It **includes estimated income**, and the explanation says how much of it is estimated.
- **Lowest projected balance (through month-end)** = minimum daily low from today to month-end. It shows the date and the obligations that cause it, and whether payday comes before or after.
- **Lowest before next income** = minimum daily low from today to the next paycheck with a fixed amount. If no such paycheck is scheduled, it isn't shown.
- **Safe to Spend** = (lowest daily low of available cash from today to the horizon) − minimum cash reserve.
  - **Horizon (Phase 4A):** the **later** of
    1. the **end of next month**, and
    2. the **first dependable paycheck after this month ends** (fixed amount, expected; searched up to 62 days past month-end).

    Every scheduled outflow from today through the horizon counts: bills, subscriptions, planned transactions, savings transfers and card payments. That includes a bill on the 1st of next month and any bill before the next paycheck.
  - **Why this rule:**
    - *Before Phase 4A* the horizon was "the later of this month-end and the first paycheck on or after today". When a paycheck fell earlier in the month, a bill due right after month-end (rent on the 1st) was dropped. Safe to Spend could then report money that is needed days later.
    - *"Through the first paycheck after month-end" alone* is not enough. A small paycheck just before a large bill (e.g. $500 on Dec 4, rent $1,400 on Dec 5) would hide the shortfall.
    - *Covering all of next month* is the smallest month-based window that cannot drop a bill on the 1st.

    Dependable income in the window still counts on the day it arrives (outflows first on the same day). So a normal pay cycle doesn't make Safe to Spend artificially low; it only drops when a known shortfall exists before the horizon.
  - **What Safe to Spend promises:** spend it today, and your projected available cash stays at or above the minimum reserve on every day through the horizon, provided the dependable income arrives as scheduled.
  - **Not promised:** anything scheduled after the horizon (stated in "Why this number?"; Planning shows it), and income that is irregular, estimated or of unknown amount (never counted).
  - Only fixed-amount income counts. Estimated income is excluded and listed.
  - Savings and card payments are already in the timeline as transfers, so nothing is subtracted twice.
  - **Card debt is counted (Phase 4A.5, owner decision):** see "Card liability" below. Before Phase 4A.5, card purchases with no payment scheduled were not deducted.
  - The result **may be negative** and is shown as "Short by $X", never clamped to zero.
  - Identity, checked by tests: available cash + income before the low point − obligations on or before it = low point.
  - **Items after the low point** (through the horizon) are listed in the explanation (`afterLow`). By definition they never take the balance below the low point, so they don't lower Safe to Spend. For example: Nov 13 sample data, low on Nov 18, then Paycheck +$1,860.00 and Phone, Card payment and Savings −$562.66 through Nov 30.
- **Same-day order (Phase 4A.4).** Every day of the forecast is settled in this fixed order. It is deterministic, identical on web and mobile (one engine), and no step can create money: every amount moved out of an account is capped at what that account actually holds at that step.
  1. **Morning: money you move out of spendable accounts** (to another spendable account, to savings, or a card payment). Both legs settle now. The combined total already assumes money moves freely between spendable accounts, so a same-day move into Cash funds a bill paid from Cash that day.
  2. **Morning: bills and other payments** (subscriptions, planned purchases, "Can I afford this?" purchases, overdue bills).
     - From a spendable account: paid in full; the account may go below zero (see the account check).
     - From a **non-spendable account** (savings): paid from what that account holds. The rest has to come from the spendable accounts, so it is **counted against them** (`Forecast.coveredPayments`; the event's `coverCents`). Nothing is moved or scheduled for the user; the dashboard says how much to move and by when.
  3. **Account check:** every spendable account that paid something that day and is below zero is recorded, **every day it happens** (`Forecast.accountShortfalls`).
  4. **Afternoon: income, refunds and card cash advances** arrive.
  5. **Evening: transfers out of non-spendable accounts.** Each moves at most what the sending account holds by now, including that day's income and incoming moves (so a paycheck into savings funds a same-day sweep to checking). Repeated until nothing changes, so a same-day chain (Savings A → Savings B → Checking) passes money along; a cycle between empty accounts moves nothing.
     - When the account can't cover all of that day's transfers: **card payments first** (an obligation; any unpaid part is counted against the spendable accounts like a bill), then **moves that stay outside the spendable accounts**, then **moves into spendable accounts**, shared in proportion within each group. Any shortage therefore falls on money Safe to Spend would count (the conservative choice). Names never decide priority; leftover cents go by event id.
     - The unfunded part never arrives and is not counted (`Forecast.unfundedTransfers`, with the sending account's actual projected balance, which may be negative).
  - **The combined low point is unchanged:** start of day + all of the day's money going out (including covered payments), before anything comes in. Money arriving from savings, income and cash advances is counted after the day's bills. This is the timing the app cannot know, so it stays conservative: a sweep from savings does not pay a checking bill due the same day.
  - **Why this order:** moves you make between your own spendable accounts are under your control and already assumed by the combined total (so treating them as settled first removes false warnings without changing Safe to Spend). Everything whose arrival time is uncertain (paychecks, transfers from other accounts, borrowed money) stays after the day's bills, as before. Before Phase 4A.4 all transfers out ran after bills and all money in ran last, which left false warnings for same-day top-ups (F5) and made a same-day paycheck-and-sweep look short (F6), and same-day transfers competing for one account were funded in alphabetical order of their names.
- **Transfers must be funded (Phase 4A.2).** A transfer out of a non-spendable asset account moves at most what that account is projected to hold (step 5 above). Transfers out of a spendable account count in full (the conservative direction for Safe to Spend); if that account would go negative, the account check flags it. Planned transfers recorded ahead of time (two future-dated legs) are treated as one transfer. Transfers are never income or spending.
- **Reconciliation (tested for every Phase 4A.4 scenario):** total across all accounts at the end = today's total + every non-transfer amount + money counted as moved in for covered payments; and the forecast's combined cash at the end = the spendable accounts' own end balances − that covered money.
- **Credit-card cash advances (Phase 4A.4).** A planned transfer out of a credit card into another account is borrowed money.
  - The receiving account and the card's balance owed both change by the full amount (the card is not capped: its limit is not known).
  - **Safe to Spend never counts borrowed money:** its low point subtracts the planned cash-advance money still owed on that day (`ForecastDay.advanceOwedAtLowCents`). A card payment reduces what is still owed, but never below what the card owes after the payment, so a payment goes to existing purchases first (conservative).
  - So an advance can't raise Safe to Spend, and its repayment is not counted twice. Audit example (Checking $300, $1,000 advance Nov 20, rent $1,200 Dec 1): **−$900** with no payment, a full payment Dec 15, a payment after the horizon, or a $50 payment.
  - Balances, "Lowest balance this month" and the month-end projection still show the real account balances (the borrowed money is really in checking).
  - Dashboard warning: "Cash advance: $1,000.00 borrowed from Visa …", including how much is not paid back by the end date, and that interest, fees and the card limit are not known.
- **Account-level check (Phase 4A.2, every shortfall since 4A.4).** Safe to Spend combines all spendable accounts; it assumes the user moves money between them when needed.
  - Every day a spendable account is projected below zero after that day's money going out is recorded.
  - The dashboard shows one warning per account when, on at least one of those days, the combined total is still at or above zero (otherwise the overall shortfall warning covers it). It lists every later date and amount, and the amount to move is the deepest one, before the first date ("Move $600.00 into Cash before Nov 20 to cover all of these").
  - The engine never creates or schedules a transfer itself.
- **Archived accounts (Phase 4A.4.2).** Archiving never removes what is scheduled.
  - An archived account is never spendable: its balance is not in Safe to Spend.
  - Bills and transfers out of it are still counted. It pays from what it holds; anything it can't cover is counted against the spendable accounts, the same rule as savings (the "covered payment" rule in step 2 above).
  - Money going into it (income, transfers in) is not counted as spendable.
  - Audit example: Checking $1,000, archived account $0, rent $800 from it → **$200** (was $1,000 with no warning). With $2,000 in the archived account, it pays the rent itself and Safe to Spend stays $1,000.
  - Dashboard warning: "N scheduled items still use Old checking, which is archived", listing each item and date.
  - **Archiving workflow** (web Settings, mobile Accounts): if active scheduled items use the account (`accountUsage`), a review lists each one. For each, the user chooses: keep it (still counted, as above), move it to another active account, or pause it (not counted until resumed). Nothing changes unless chosen; Cancel changes nothing. Planned future transactions are listed and stay on the account. `archiveAccount` applies only the chosen changes. Accounts that nothing uses are archived directly.
- **Different currencies (Phase 4A.4.2).** Clarity never converts currencies and never adds amounts in different currencies.
  - Accounts in another currency are left out of totals; their scheduled items are listed in the currency notice and are not counted.
  - A transfer between currencies counts only the money leaving the sending account; nothing is counted as arriving (`Forecast.currencyConflicts`, warning "… isn't converted"). So USD → EUR lowers Safe to Spend; EUR → USD adds nothing.
  - A full-balance card payment to a card in another currency has no amount in the sender's currency: it is not counted, and a warning says so.
  - "Can I afford this?" from an account in another currency answers "Can't check this: <account> is in <currency>", never "Yes".
  - Accounts in other currencies can't be created in the app today; this only protects existing data.
- **Warnings (Phase 4A.4.2).** The engine returns every warning, ordered critical, then warning, then info.
  - Each warning can carry `accountId` and `items`: every dated amount behind it. Account shortfalls list every date, and the short text always names the lowest amount and date ("Lowest: −$2,100.00 on Dec 17"), even when it summarises the others ("7 more").
  - Home shows the first five and "N more in Planning". Planning (web and mobile) shows the complete list, grouped by severity, with every date and amount. The same engine list is used on every screen, so nothing is duplicated or dropped.
- **Competing transfers from one account (Phase 4A.4.2).** When a transfer gets less than requested because other same-day transfers from the same account were funded first (step 5's priority) or shared with it, the warning names them and gives the amounts. Example: "Requested $500.00; counted $0.00; not counted $500.00. Counted first: Holiday fund ($500.00 of $500.00)." It also states that this order is a cautious forecast assumption, not how the bank will necessarily process them. The priority itself is unchanged.
- **Archived debts (Phase 4A.4.4).** Archiving never hides debt.
  - An archived account that was counted as spendable and is **overdrawn today** keeps counting against the spendable accounts: the forecast adds an "overdrawn balance" item today for the amount owed, and the account is treated as back at $0 afterwards, so later payments from it are not counted twice. Audit example: Checking $1,000 + another checking at −$500 → $500 before and after archiving (was $1,000 after).
  - An archived account that was not spendable (savings) is treated as before archiving. Since Phase 4A.5.9 (owner decision) a negative balance on it is counted in Safe to Spend both before and after archiving (so archiving still can't change the result); before Phase 4A.5.9 it was counted in neither.
  - A positive archived balance is never spendable.
  - Archived accounts that owe money (overdrawn, or a card with a balance) stay in the balance totals (`BalanceSummary.lines` with `archived: true`), so an archived card keeps the "no payment scheduled" warning, with "archiving doesn't clear what it owes".
  - The archive review shows the account's debt before archiving (`archiveBalanceReview`) and what happens to it.
  - **Transfers out of archived accounts (Phase 4A.5, owner decision: keep, with the cap):** scheduled transfers out of an archived account count only up to what it is projected to hold; the unfunded part is not counted and is flagged ("won't have the money" / "only $X of $Y"). A positive archived balance is never generally spendable; money moved out and back is counted once; transfers into non-spendable accounts (archived or savings) only ever lower Safe to Spend. Consequence, accepted: while an account is spendable its transfers out count in full; once archived they are capped, so archiving can raise Safe to Spend when that account's own planned transfers out exceed its balance (the only way, in 600 generated scenarios).
- **Currency of archived accounts (Phase 4A.4.4).** Currency is checked first: an archived account in another currency is in the currency notice, and its archived-account warning says its items are not counted ("Clarity doesn't convert currencies"), never that they are. Cash advances are subtracted from Safe to Spend only for cards in the base currency.
- **Card payments, cash advances and purchases (Phase 4A.4.4, model documented).**
  - A scheduled card payment reduces whatever the card owes when it is paid. It can't pay purchases that haven't happened yet; any excess is a credit on the card that later purchases use.
  - When a card owes both purchases and a planned cash advance, the payment is applied to the purchases first, so the advance stays counted as borrowed as long as the card still owes at least that much (conservative). Purchases on the same day as a payment count as owed before it.
  - Since Phase 4A.5 the card debt still owed at the end of the forecast is set aside (below), so the audit scenario ($500, $90 advance Nov 20, $400 payment Dec 21, $400 purchases) is **$100** whether the purchases are on Dec 20, 21 or 22 (Phase 4A.4.4: $190 for Dec 22).
  - New warning: a card projected to owe money at the end of the forecast that no later scheduled payment (within 62 days) pays — "Visa is projected to owe $90.00 on Dec 31, and no payment is scheduled for it". Not shown when the "no payment scheduled" warning for today's balance already applies.
- **Card liability (Phase 4A.5 → Policy B in Phase 4A.5.2, owner decisions).** Card debt is counted even when no payment is scheduled. Card debt that no payment the user scheduled covers is **owed now**; a scheduled payment (or refund) sets when the debt it covers is counted. Clarity stores no statement due dates: a scheduled payment's date is the user's planned date, never presented as a verified due date.
  - **Per day, per base-currency card (archived included), at the day's low point (after the day's money going out):**
    - *owed* = what the card owes then (`max(0, −balance)`; a card in credit owes nothing and its credit is never spendable);
    - *covering* = **payments** (money moved into the card from another account, scheduled or recorded ahead of time) after that point: later that day, later in the forecast, and within 62 days after it (the existing lookahead). A payment more than 62 days after the forecast ends doesn't count, so that debt is owed now;
    - *uncovered* = `max(0, owed − covering)`, reserved that day. Payments pay the oldest debt first, so a later payment always covers debt that already exists before any later purchase, and never a purchase that hasn't happened yet.
    - The planned cash-advance part stays borrowed until repaid (Phase 4A.4); because payments go to purchases first, an uncovered amount is the advance first. Reserved per card: `max(uncovered, advance still owed)`. Never both.
  - **Safe to Spend** = min over the days of (low − reserved) and of (cash at the end of the forecast − card debt still owed then) − reserve.
  - **Treatment by case:**
    - *starting balance:* owed today; reserved today unless later payments/refunds cover it;
    - *fixed-amount payments:* cover up to their amount, on their date;
    - *full-balance payments:* cover everything owed when paid;
    - *multiple or partial payments:* their total covers the oldest debt; any remainder is reserved now (warning "Visa: $300.00 of $400.00 isn't covered by a scheduled payment");
    - *purchases:* owed from their date; one after the last payment is reserved from that date;
    - *cash advances:* as purchases, plus the borrowed-money rule;
    - *refunds, cashback and other card credits (Phase 4A.5.4):* **not payments.** They lower what the card owes only from the day they arrive, never earlier, so a future refund can't make money spendable today (audit 4A.5.3: a $200 refund planned for Dec 10 used to raise Safe to Spend from $100 to $300). Estimated or unknown-amount credits are never counted;
    - *pending refunds and credits (Phase 4A.5.4):* the recorded balance still includes them (unchanged rule for pending transactions), but for card debt they are added back until they post. A pending transfer (a payment already made from an account) is not a credit of this kind and stays counted once;
    - *archived cards:* same;
    - *payment after the forecast ends:* covers the debt, which is then set aside at the end of the forecast (unchanged boundary rule);
    - *payments and same-day income:* payments come first (unchanged).
  - **Worked examples** (Nov 13, horizon Dec 31; $500 checking, card owes $400):
    - payment Nov 25 + paycheck Dec 4 → $100;
    - no payment → $100 (Phase 4A.5: $500);
    - payment Dec 10 after the paycheck → $500;
    - $100 partial payment Nov 25 → $100 (Phase 4A.5: $400);
    - two cards, Visa $300 paid Nov 20 and Amex $200 paid Dec 20, $400 checking → $100 (Phase 4A.5: $400); Amex unscheduled → −$100;
    - payment Jan 15 → $500 with the paycheck, $100 without;
    - $50 refund Dec 10 → $100 (Phase 4A.5.2: $150; corrected in 4A.5.4);
    - same-day paycheck and payment with $100 checking → −$300;
    - forecast end moving to a Feb 1 paycheck: $100 on both days (Phase 4A.5: $100 → $500);
    - sample data + a card owing $250 with no payment → $2,177.17.
  - **"Why this number?"** names each card at the low point:
    - "Visa: owed now" with the amount and "no payment is scheduled for it", or how much a planned payment covers;
    - "Cash advance still owed";
    - an info line "Visa: $400.00 owed — covered by the payment you planned for Dec 10 (a date you entered, not a statement due date)";
    - or "Visa still owed on Dec 31" for a payment planned after the forecast.
  - **Warnings:** "no payment scheduled … counts the $X as owed now"; "Visa: $X of $Y isn't covered by a scheduled payment"; "projected to owe … and no payment is scheduled for it".
  - "Can I afford this?" uses the same calculation (a purchase on a card is owed now unless a scheduled payment covers it).
  - **Cannot be calculated:** a card in another currency that owes money or has scheduled activity, or a card with something scheduled of unknown amount, is named, never converted, and "Can I afford this?" is qualified ("— not counting Euro card").
- **Amounts in their own currency (Phase 4A.4.4).** Warning text and itemised amounts use the currency of the account they belong to (€, £, $ …); an item's `currency` is set only when it differs from the base currency. Upcoming items and Planning timeline amounts on accounts in another currency are shown in that currency (`UpcomingItem.currency`).
- **Grouping (Phase 4A.4.4).** Repeated dates of one scheduled item that a non-spendable or archived account can't cover, transfers from one schedule that can't be funded, and cross-currency transfers from one schedule are one warning each, with every date and amount in `items`. Different items are never combined, even with the same amount. The archived-account warning counts distinct scheduled items.
- **Pause and resume (existing rule, now stated in the archive review).** Pausing skips every occurrence due while paused; resuming starts again from the resume date, and occurrences that fell due during the pause are not brought back and are not overdue. Resuming on the same day restores everything exactly once.
- **Possible duplicates (Phase 4A.2).** A planned transaction not linked to a bill, on the same account, for the same amount, within 3 days of a scheduled bill, is flagged ("Possible duplicate: Rent on Dec 1").
  - Since Phase 4A.4, when more than one bill matches, the bill is named only if the transaction's description clearly matches that bill's name best. Otherwise the warning lists the candidates and says it isn't clear which one it pays.
  - Both stay counted, the conservative choice, until the user resolves it. Nothing is merged automatically.
  - Add Transaction already links a matching entry to the bill, so this mainly catches data entered without that link.
- **Disclosure (Phase 4A.2).**
  - The Safe to Spend card shows the end date and the paycheck assumption ("Covers what's scheduled through Dec 31, if your paychecks arrive as scheduled.").
  - With no fixed-amount income it says "No regular income is scheduled, so this only covers bills through Dec 31."
  - It also names the next scheduled payment after the end date ("Next after Dec 31: Rent $1,400.00 on Jan 1 — not included.").
  - "Can I afford this?" answers "Yes, through Dec 31" and states the same scope.
  - "Lowest balance this month" is the this-month figure (Safe to Spend can look further).

- **Can I afford this?** reruns Safe to Spend with one hypothetical purchase:
  - *yes*: the low point stays at or above the reserve;
  - *tight*: the low point dips into the reserve but stays ≥ 0;
  - *no*: the low point goes below zero (shortfall shown);
  - *move_first* (Phase 4A.4): the total covers it, but the account it's paid from doesn't. Either the account would go below zero (a spendable account), or it is a non-spendable account and part of the purchase has to come from the spendable accounts (that part is counted). The answer is "Only if you move $X into <account> by <date>", where $X covers every day the account would be below zero. It is never shown as "Yes";
  - *unverified* (Phase 4A.4): the purchase date is after the Safe to Spend horizon, so nothing after that date is known: "Can't check <date> yet: the forecast ends <horizon>". Never "Yes".

  Bills with no amount entered are named in the answer ("Not counted because no amount is entered: …") rather than guessed.

  A purchase on a card affects cash only through a scheduled full-balance card payment.

### Worked example (golden scenario `normalMonth`)
Today is Sep 3; checking holds $1,200; the reserve is $100. Scheduled:
- electricity ~$90 (estimated) on Sep 10;
- phone $60 and paycheck $1,800 on Sep 12;
- paycheck $1,800 on Sep 26.

| Date | Low | End |
|---|---|---|
| Sep 3 | 1,200.00 | 1,200.00 |
| Sep 10 | 1,110.00 | 1,110.00 |
| Sep 12 | **1,050.00** (phone before pay) | 2,850.00 |
| Sep 26 | 2,850.00 | 4,650.00 |

So:
- Projected month-end: **$4,650**.
- Lowest: **$1,050 on Sep 12**.
- Safe to Spend: 1,050 − 100 = **$950**.

## Budget and reports
- A **budget** is one optional monthly amount per spending category. It repeats every month. Empty means "not tracked".
- **Spent** in a category = expenses − refunds for the month, with split transactions divided by their parts. Transfers, card payments and balance adjustments are never spending.
- **Left** = budget − spent. Negative is shown as "Over by $X" with an icon and words, not color alone.
- Identity (tested): spending in budgeted categories + spending not budgeted (including uncategorized) = total spending for the month.
- **Reports** use recorded transactions only, up to today. The current month is labelled "so far". Nothing estimated or scheduled is included.
- **Balance history** on the dashboard chart is the recorded available cash per day. It starts no earlier than the date the newest spendable account was added, because earlier balances are not known.

## Import rules (`packages/import`)
- **Dates:** if several formats fit (for example MM/DD vs DD/MM), the user must choose. The app never guesses.
- **Amounts:** these forms are all supported:
  - signed numbers and debit/credit columns;
  - `(12.30)`, `12.30-` and `DR`/`CR` suffixes;
  - comma decimal separators.

  A value with more than 2 decimals is an error row, never rounded.
- **Sign convention:** checked against the running balance column if one exists, otherwise inferred from the account type (card statements often list purchases as positive). The user confirms it.
- **Duplicates:**
  - **exact**: same transaction ID, or the same date + amount + original description from an earlier import. Excluded by default; the user can include it.
  - **likely**: same account and amount, within 2 days, with a similar description or an existing transfer. Flagged and excluded by default; the user decides.
  - The same amount alone is **never** treated as a duplicate.
  - Identical rows inside one file are kept (two coffees are two coffees).
- **Not selected by default:**
  - low-confidence rows (for example, a date far from today);
  - possible transfers, until the user picks the other account.
- **Reconciliation:** the statement's closing balance is compared with the app balance after import. A difference is only recorded as an adjustment if the user explicitly asks.
