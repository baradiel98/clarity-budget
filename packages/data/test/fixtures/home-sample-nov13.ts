/**
 * Cross-platform contract: what Home must show for the sample workspace on Fri, Nov 13, 2026.
 * Plain constants (no imports) so all three suites can read it:
 *   - packages/data/test/home-view.test.ts      checks these against the engine (the source of truth);
 *   - apps/mobile/test/home.test.tsx            checks the native Home renders them;
 *   - apps/web/e2e/phase3.spec.ts               checks the web Home renders them.
 * If the engine's numbers change on purpose, update this file once; never edit one app to match.
 */
export const SAMPLE_TODAY = '2026-11-13';
export const SAMPLE_NOW = Date.UTC(2026, 10, 13);

export const HOME_SAMPLE = {
  monthEnd: '$4,077.17',
  monthEndDelta: '$1,205.94 more than you have today, by Nov 30.',
  safeToSpend: '$2,579.83',
  safeToSpendLine: 'What you can spend today and still cover everything scheduled through Nov 30. Your balance is lowest on Nov 18.',
  safeToSpendAfterLow: "Phone, Card payment and Savings ($562.66) come after Nov 18, once $1,860.00 has come in. Your balance stays at or above the Nov 18 low through Nov 30, so they don't lower Safe to Spend.",
  recordedBalance: '$2,871.23',
  lowest: '$2,779.83',
  lowestSub: 'Nov 18 · through month-end',
  lowestBeforeIncome: '$2,779.83',
  lowestBeforeIncomeSub: 'Same low point (Nov 18), before your Nov 19 income',
  endOfDay: '$2,871.23',
  endOfDaySub: 'Nothing else is scheduled today',
  upcomingUntil: 'Nov 30',
  /** [date, name, status label, amount as shown (≈ = estimated)] */
  upcoming: [
    ['Wed, Nov 18', 'Electricity', 'Estimated', '≈−$91.40'],
    ['Thu, Nov 19', 'Paycheck', 'Expected', '+$1,860.00'],
    ['Sun, Nov 22', 'Phone', 'Scheduled', '−$65.00'],
    ['Wed, Nov 25', 'Card payment', 'Estimated', '≈−$247.66'],
    ['Mon, Nov 30', 'Savings', 'Scheduled', '−$250.00'],
  ],
  /** [date, title, category, amount] newest first */
  recent: [
    ['Nov 12', 'Whole Foods', 'Groceries', '−$64.12'],
    ['Nov 10', 'Shell', 'Fuel', '−$48.20'],
    ['Nov 9', 'Streaming', 'Subscriptions', '−$15.49'],
    ['Nov 8', 'Corner Bistro', 'Dining out', '−$38.60'],
    ['Nov 7', 'Trader Joe’s', 'Groceries', '−$52.33'],
    ['Nov 5', 'Paycheck', 'Paycheck', '+$1,860.00'],
  ],
} as const;
