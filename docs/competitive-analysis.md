# Competitive analysis (November 2026)

**Method.** Web search on 2026-11-13. Most pricing figures come from third-party reviews and price trackers, because the vendors' own pricing pages could not be reached from this environment. Where sources disagree, the range is shown. Everything here should be re-checked on the vendors' sites before it is used publicly (marketing, App Store text). "Not found" means *not found in the sources reviewed*, not "does not exist".

## Summary
| | YNAB | Monarch Money | Copilot Money | Rocket Money | PocketGuard | Actual Budget | **Clarity (this project)** |
|---|---|---|---|---|---|---|---|
| Price (2026, reported) | $14.99/mo or $109/yr; 34-day trial | $14.99/mo or $99.99/yr | ~$13/mo or $95/yr | Free tier; Premium ~$6–14/mo (sources disagree) | Sources disagree ($34.99–$74.99/yr) | Free, open source (MIT) | Not decided |
| Platforms | iOS, Android, web | iOS, Android, web | iPhone, iPad, Mac, web. **No Android app** | iOS, Android, web | iOS, Android, web | Desktop/web, self-host | iOS, Android, desktop web |
| Bank connection | Optional (direct import in select regions) | Plaid-based aggregation | Aggregation | Aggregation (core to product) | Aggregation | Optional | **None, by design** |
| File / statement import | OFX, QFX, CSV (as a fallback where direct import isn't available) | Not found | Not found | Not found | Not found | QIF, OFX, QFX, CAMT.053, CSV | CSV now; others planned |
| Local-first / no vendor copy of data | No (cloud account) | No | No | No | No | **Yes** (optional self-hosted E2EE sync) | **Yes** (no sync yet) |
| "Safe to spend" style number | Not its model (zero-based "assign every dollar") | Not found | Not found | Not found | **Yes ("In My Pocket")** | Not found | **Yes, with full itemized breakdown** |
| Forward cash-flow forecast | Not found | Not found | Not found | Not found | Partial (bills considered) | Not found | **Yes: daily timeline, lowest point, any-date balance** |

## Competitors

**YNAB**
- Reported at $14.99/month or $109/year, with a 34-day trial ([Penny Hoarder](https://www.thepennyhoarder.com/budgeting/ynab-review/?p=136641), [Recurdash](https://recurdash.com/subscription-pricing/ynab)).
- Supports file import (OFX/QFX/CSV) where direct bank import is unavailable ([TechYorker](https://techyorker.com/products/ynab/), [Beancount comparison](https://beancount.io/compare/ynab-alternatives)).
- Anecdotal user complaints about bank sync reliability in some regions; low-quality source, treat with caution.
- Its zero-based method is powerful but has a learning curve. That is a deliberate philosophy, not a flaw.

**Monarch Money**
- Reported at $14.99/month or $99.99/year ([Penny Hoarder](https://www.thepennyhoarder.com/budgeting/monarch-money-review/)).
- Bank connections go through Plaid. Critics raise Plaid's data collection as the privacy concern ([Penny Hoarder](https://www.thepennyhoarder.com/budgeting/monarch-money-review/), [Costbench](https://costbench.com/software/personal-finance/monarch-money/hidden-costs/)).

**Copilot Money**
- Reported at ~$95/year or $13/month.
- The official FAQ lists Web, iPhone, iPad and Mac, and **no Android** ([Copilot FAQ](https://www.copilot.money/faq), [FinCompareLab](https://www.fincomparelab.com/?p=664)).
- Some reviewers say the web app is less complete than the iOS app.

**Rocket Money**
- Premium is reported at roughly $6–14/month on a "choose your price" model ([Rocket Money](https://www.rocketmoney.com/learn/personal-finance/how-much-does-rocket-money-cost), [FinCompareLab](https://www.fincomparelab.com/guides/rocket-money-pricing/)).
- The BBB profile lists 273 complaints over 3 years, often about charges after cancellation ([BBB](https://prod.bbb.org/us/md/silver-spring/profile/billing-services/rocket-money-inc-0241-236043013/complaints)).
- One source claims a new Premium+ tier for bill negotiation from November 2026; this is **unverified**.

**PocketGuard**
- Built around one "In My Pocket" safe-to-spend number calculated from bills, income and savings goals ([Penny Hoarder](https://www.thepennyhoarder.com/budgeting/pocketguard-review/)).
- Pricing reports conflict, and a 2026 review notes the price doubled within 10 months ([Motley Fool](https://www.fool.com/money/personal-finance/pocketguard-review/)).
- **Implication: "Safe to Spend" alone is not unique.**

**Actual Budget**
- Open source (MIT), local-first and works offline ([actualbudget.org](https://actualbudget.org/)).
- Imports QIF/OFX/QFX/CAMT.053/CSV. Bank sync is optional, and so is end-to-end-encrypted sync through a self-hosted server ([actualbudget.org](https://actualbudget.org/), [LinuxLinks](https://www.linuxlinks.com/actual-budget-fast-privacy-focused-app-manage-finances/)).
- **This is the closest competitor on privacy.** It is ahead of Clarity on import formats and sync.

## Honest positioning

**What is *not* unique:**
- local-first, no-bank budgeting (Actual Budget);
- statement file import (YNAB, Actual);
- a safe-to-spend number (PocketGuard).

**What Clarity can credibly claim, if it delivers it well:**
1. A **forward-looking daily cash-flow forecast** as the main screen: the lowest point, when it happens and why, and the balance on any date. Among the apps reviewed, the others centre on past spending or budgeting categories. Our differentiation here is depth and clarity, not the idea itself.
2. **Every number explains itself** ("Why this number?" with line items and assumptions). Safe to Spend may be negative and is shown as a shortfall, never hidden.
3. **Privacy you can verify plus convenience.** No account, encryption with a user-held key, a cross-platform encrypted backup, and an automated test proving the web app sends no financial data over the network. It also has a first-class native mobile app (Actual's focus is desktop/web).
4. A **careful statement-import review**: duplicates are never assumed from the amount alone, the app asks instead of guessing an ambiguous date format, and it reconciles against the statement's closing balance.

**Gaps vs competitors to plan for (later phases, not commitments):**
- OFX/QFX/QIF import (Actual and YNAB already have it).
- Optional end-to-end-encrypted sync (Actual has self-hosted E2EE sync). Clarity's data model is ready for it.

**Common frustrations worth designing against** (complaint sources are mixed quality):
- bank connections breaking (aggregation);
- surprise price increases;
- hard-to-cancel subscriptions.

Clarity avoids the first by design. The other two are business decisions for the owner.

## Sources
- [YNAB review — The Penny Hoarder](https://www.thepennyhoarder.com/budgeting/ynab-review/?p=136641)
- [YNAB pricing — Recurdash](https://recurdash.com/subscription-pricing/ynab)
- [YNAB — TechYorker](https://techyorker.com/products/ynab/)
- [YNAB alternatives — Beancount](https://beancount.io/compare/ynab-alternatives)
- [Monarch Money review — The Penny Hoarder](https://www.thepennyhoarder.com/budgeting/monarch-money-review/)
- [Monarch hidden costs — Costbench](https://costbench.com/software/personal-finance/monarch-money/hidden-costs/)
- [Copilot Money FAQ](https://www.copilot.money/faq)
- [Copilot Money pricing — FinCompareLab](https://www.fincomparelab.com/?p=664)
- [Rocket Money cost — rocketmoney.com](https://www.rocketmoney.com/learn/personal-finance/how-much-does-rocket-money-cost)
- [Rocket Money pricing — FinCompareLab](https://www.fincomparelab.com/guides/rocket-money-pricing/)
- [Rocket Money complaints — BBB](https://prod.bbb.org/us/md/silver-spring/profile/billing-services/rocket-money-inc-0241-236043013/complaints)
- [PocketGuard review — The Penny Hoarder](https://www.thepennyhoarder.com/budgeting/pocketguard-review/)
- [PocketGuard review — The Motley Fool](https://www.fool.com/money/personal-finance/pocketguard-review/)
- [Actual Budget](https://actualbudget.org/)
- [Actual Budget — LinuxLinks](https://www.linuxlinks.com/actual-budget-fast-privacy-focused-app-manage-finances/)
