/**
 * Exact product terminology. UI on every platform must use these strings for
 * these concepts so wording never drifts between mobile and desktop.
 */
export const TERMS = {
  appName: 'Clarity',
  projectedMonthEnd: 'Projected month-end balance',
  recordedBalance: 'Current recorded balance',
  availableCash: 'Available cash',
  safeToSpend: 'Safe to Spend',
  /** Only this calendar month (Dashboard.lowestThroughMonthEnd); Safe to Spend can look further. */
  lowestBalance: 'Lowest balance this month',
  lowestBeforeIncome: 'Lowest before next income',
  endOfDay: 'Projected end of today',
  canIAfford: 'Can I afford this?',
  whyThisNumber: 'Why this number?',
  upcoming: 'Upcoming',
  addTransaction: 'Add Transaction',
  importStatement: 'Import Statement',
  privacyCenter: 'Privacy Center',
  minReserve: 'Minimum cash reserve',
  cardOwed: 'Owed on cards',
  shortBy: 'Short by',
  tabs: { home: 'Home', transactions: 'Transactions', planning: 'Planning', settings: 'Settings' },
} as const;

export const OCCURRENCE_STATUS_LABEL = {
  confirmed: 'Paid',
  expected: 'Scheduled',
  estimated: 'Estimated',
  unknown: 'Amount unknown',
  skipped: 'Skipped',
  overdue: 'Overdue',
  scheduled_tx: 'Planned',
} as const;

export const INCOME_STATUS_LABEL = {
  confirmed: 'Received',
  expected: 'Expected',
  estimated: 'Estimated',
  unknown: 'Amount unknown',
  skipped: 'Skipped',
  overdue: 'Not recorded',
  scheduled_tx: 'Planned',
} as const;

export const NO_SYNC_NOTICE =
  'Your data lives only on this device. Changes made here do not appear on your other devices until you move them with an encrypted backup.';

/** What each Upcoming status means (web: tooltip + screen-reader text; mobile: status help). Same words on both apps. */
export const STATUS_HELP: Record<keyof typeof OCCURRENCE_STATUS_LABEL, (income: boolean) => string> = {
  expected: (i) => (i ? 'Fixed amount, not received yet. Counted in projections.' : 'Fixed amount, not paid yet. Counted in projections.'),
  estimated: () => 'The amount is an estimate. Counted in projections; record the real amount when it happens.',
  unknown: () => 'No amount yet, so it is not counted. Add the amount to include it.',
  overdue: (i) => (i ? 'Not recorded yet, so it is not counted.' : 'The date has passed and no payment is recorded. Counted as due today.'),
  scheduled_tx: () => 'A future-dated transaction you entered. It counts on its date.',
  confirmed: (i) => (i ? 'Recorded as received.' : 'Recorded as paid.'),
  skipped: () => 'Skipped. Not counted.',
};

/** Shown above the Upcoming list on both apps. */
export const UPCOMING_NOTE = 'Nothing here is recorded until you record it or mark it paid. Estimated amounts (≈) may change.';

/** Heading for items after the Upcoming window that Safe to Spend still counts (both apps). */
export const UPCOMING_LATER_TITLE = 'Later · also counted in Safe to Spend';

/**
 * Phase 4A.5.6: what a balance you type in means (onboarding, new account, Update balance). Matches the engine:
 * the figure is the bank's posted balance; pending items are tracked separately; transactions recorded afterwards
 * are added unless marked "Already included".
 */
export const BALANCE_ENTRY_HINT =
  "Enter the posted (cleared) balance your bank shows right now, without pending items. Anything you record in Clarity after this is added to it, including transactions dated today, so if it's already in this balance, tick “Already included” when you record it.";
export const UPDATE_BALANCE_HINT =
  'Enter the posted (cleared) balance your bank shows right now, without pending items. Clarity compares it with its own posted balance and records the difference as an adjustment with your reason; history isn\'t changed and pending items stay pending.';
export const UPDATE_BALANCE_PENDING_NOTE =
  "These are still pending in Clarity. If any of them has cleared at your bank, mark it posted first, so it isn't counted twice.";
export const ALREADY_INCLUDED_LABEL = (date: string) => `Already included in the balance I entered on ${date}`;
export const ALREADY_INCLUDED_HINT = "Kept in your history but not added to the account balance again.";
