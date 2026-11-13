# Web redesign report (2026-11-13)

Scope: the desktop web app (`apps/web`), including its phone-width layout. Checked in Chromium only. The deployed site could not be opened from the development environment (outbound access is blocked), so the inspection used the same build run locally. Before screenshots are in `docs/screenshots/before`, after screenshots in `docs/screenshots/after`.

## Inventory before the redesign
| Area | State before |
|---|---|
| Welcome, passphrase, recovery key, lock, restore | Working |
| Onboarding (balance, pay, bill, first overview) | Working |
| Home dashboard | Working; three equal cards, non-interactive chart |
| Transactions (table, filters, bulk actions, keyboard) | Working |
| Add / edit transaction, transfers, refunds, splits, pending | Working |
| Can I afford this?, Why this number? | Working |
| Planning (timeline, balance on a date, income, bills, transfers, skip/move/override/pause) | Working |
| Statement import (CSV: mapping, review, duplicates, reconciliation, undo) | Working |
| Settings, Privacy Center, self-test | Working |
| Budget | **Did not exist** |
| Reports | **Did not exist** |
| Savings goals | **Does not exist** (not built; see limitations) |
| Phone-width layout | Sidebar wrapped into a top bar; usable but not designed |

## What changed
**Design system**
- New tokens (revised after feedback, using copilot.money as the visual reference): cool blue-tinted backgrounds, white cards, navy text, one blue accent, green/orange/red status colors, 8 saturated category hues, soft blue-tinted shadows, radii 8/12/20/26 with pill buttons. The first version's warm neutrals and teal were dropped as "brownish". All text and status colors pass WCAG AA in both themes (automated test).
- Typeface: the system font on Apple devices, self-hosted Inter elsewhere; tabular numerals for every amount.
- One stylesheet rewritten from scratch: buttons, inputs, selects, segmented controls, badges, cards, tables, lists, dialogs, bottom sheets, drawer, toasts, empty states, progress meters, stepper, charts.
- Glass is used only on the sidebar, the phone tab bar and toasts. Financial data sits on solid surfaces.
- Motion: short fades and rises on pages, dialogs and menus; all disabled under "reduce motion".

**Navigation**
- Desktop: slimmer sidebar with Home, Transactions, Budget, Planning, Reports; Add Transaction; Import Statement and Settings; privacy note and Lock at the bottom. Keys 1–6.
- Phone width: floating bottom tab bar (Home, Transactions, Add, Planning, More). Dialogs become bottom sheets. Inputs are 44 px tall and 16 px text.

**Dashboard**
- Projected month-end balance is the single hero number, with the change from today in words.
- Interactive forecast chart: recorded balance (solid) vs projection (dashed), income and bill markers, lowest point, reserve line, range (month-end / 30 / 90 days), hover and keyboard tooltips with that day's items.
- Safe to Spend is its own panel showing the engine's arithmetic: available cash, income and bills before the lowest point, the lowest point, the reserve, the result. A shortfall is shown as "Short by".
- Supporting figures in one row: current recorded balance, lowest through month-end, lowest before next income, projected end of today. Each has "Why this number?".
- Next income, Upcoming, Needs attention (only when present) and Recent transactions.

**New pages (built on new, tested engine functions)**
- **Budget:** monthly amount per category, spent, left / over, progress with a month-progress mark, grouped by category group, inline editing, month navigation, links to the matching transactions.
- **Reports:** income vs spending by month (6 or 12 months), month detail, spending by category with links to the transactions, month-by-month table with totals.

**Other pages**
- Transactions: toolbar filters, totals strip, category dots, phone layout with category and account under the merchant; filters can arrive from Budget and Reports links.
- Import: four-step indicator, clearer upload area, three assurances (stays on device, you approve every row, duplicates flagged).
- Onboarding, lock, settings, planning, privacy, dialogs: restyled with the same components.
- Sample data now includes recorded paychecks, bills and five earlier months so Budget and Reports show realistic states.

## Functionality preserved
Everything in the inventory marked "Working" still works and is covered by the browser tests. That includes lock/unlock, recovery key, backup and restore, delete all data, import with undo, transfers, refunds, splits, duplicate warning, undo, keyboard shortcuts, offline use, demo mode, and the test that no financial data leaves the device. No financial calculation was changed for visual reasons.

## Bugs found and fixed
1. Upcoming items charged to a credit card showed **$0.00**. They now show the charge and say "Charged to a card, not from cash".
2. The old chart could draw the lowest-point marker off the line when estimated income existed. The chart now marks the lowest point of the line it draws.
3. Reports bars drew a sliver for months with zero income. Removed.
4. Phone width: the monthly group row in the transactions table added a phantom column and squeezed the merchant text.
5. Earlier in this session: the app could show a blank screen if the browser refused storage. It now shows a message.

## Test results (Chromium, this environment)
- Unit tests: 151 passed (5 new: budget, monthly series, balance history, category budgets, category palette contrast).
- Browser tests: 24 passed. New ones cover the Safe to Spend breakdown, chart hover/keyboard/range (checked against a hand calculation), recent transactions, the full budget flow, reports and their links, and the phone-width layout with no sideways scrolling on every page.
- Type checks and lint: pass. Phone-app type check and its 13 tests: pass.

## Remaining limitations
- **Not verified:** Safari, Firefox, Edge, and real phones. The redesign has only been seen in Chromium.
- **Savings goals** are not built: there is no data for them yet (goal, target, contributions).
- **Budgets are one amount per category, repeating monthly.** No per-month overrides, rollover or "assign every dollar" workflow.
- **Reports** have no savings-progress or forecast-vs-actual views (the data does not exist yet).
- **Chart "actual" history** only goes back to when the newest spendable account was added, at most 14 days.
- **Native mobile app:** picks up the new colors but not the new dashboard layout, Budget or Reports.
- **Settings → Categories** is still a dense chip list; it works but is the least refined screen.
- The black screen reported on the deployed site has not been reproduced. The app now reports storage problems instead of showing nothing.
