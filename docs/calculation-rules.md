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

**Splits** must add up exactly to the total and have the same sign. **Pending** transactions count in balances and forecasts, with a label. Changing pending to confirmed never changes an amount.

## Balances
- **Recorded balance** of an account = opening balance + every transaction dated on/after the account's opening date and on/before today.
- Transactions dated **before the opening date** are history only (for example, an older imported statement). They are already reflected in the opening balance.
- Transactions dated **after today** are *planned*. They appear in the forecast on their date, not in today's balance.
- **Available cash** = sum of active, spendable, non-card accounts in the base currency. **Owed on cards** is shown separately and never mixed into cash.
- **Update balance** creates an `adjustment` transaction for the difference, with a reason. History is never edited.

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

## Forecast
A day-by-day timeline of available cash from today to the horizon. On each day the **outflows are applied before inflows**: a bill due on payday must be covered by money you already have. The day's *low* (after outflows) is what "lowest balance" and Safe to Spend use.

Events in the timeline:
- planned (future-dated) transactions;
- recurring occurrences, including transfers and savings, which reduce cash only if money leaves a spendable account;
- overdue bills (placed today);
- hypothetical purchases ("Can I afford this?"), which are never saved.

## Headline numbers
- **Projected end of today** = today's recorded cash + today's remaining scheduled items.
- **Projected month-end balance** = timeline value at the end of the last day of the month. It **includes estimated income**, and the explanation says how much of it is estimated.
- **Lowest projected balance (through month-end)** = minimum daily low from today to month-end. It shows the date and the obligations that cause it, and whether payday comes before or after.
- **Lowest before next income** = minimum daily low from today to the next paycheck with a fixed amount. If no such paycheck is scheduled, it isn't shown.
- **Safe to Spend** = (lowest daily low of available cash from today to the horizon) − minimum cash reserve.
  - The horizon is the later of month-end and the next paycheck with a fixed amount.
  - Only fixed-amount income counts. Estimated income is excluded and listed.
  - Savings and card payments are already in the timeline as transfers, so nothing is subtracted twice.
  - Card purchases with no payment scheduled are **not** deducted; a warning says so.
  - The result **may be negative** and is shown as "Short by $X", never clamped to zero.
  - Identity, checked by tests: available cash + income before the low point − obligations on or before it = low point.
- **Can I afford this?** reruns Safe to Spend with one hypothetical purchase:
  - *yes*: the low point stays at or above the reserve;
  - *tight*: the low point dips into the reserve but stays ≥ 0;
  - *no*: the low point goes below zero (shortfall shown).

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
