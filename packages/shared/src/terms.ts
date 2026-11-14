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
  "Enter the posted (cleared) balance your bank shows right now, without pending items. If the account is overdrawn, type a minus sign (for example -50.00). Anything you record afterwards that's dated today or later is added to it; if something dated today is already in this balance, tick “Already included” when you record it.";
/** Phase 4A.5.8: cards are entered as Owed or In credit, never with a sign. */
export const CARD_BALANCE_ENTRY_HINT =
  "Enter the posted (cleared) balance on your card statement right now, without pending items. Choose “In credit” if the card owes you money (for example after a refund).";
export const UPDATE_BALANCE_HINT =
  "Enter the posted (cleared) balance your bank shows right now, without pending items (type a minus sign if it's overdrawn). Clarity compares it with its own posted balance and records the difference as an adjustment with your reason; history isn't changed and pending items stay pending. Posted transactions you record later that are dated before today are treated as already in this balance.";
export const UPDATE_BALANCE_PENDING_NOTE =
  "These are still pending in Clarity. If any of them has cleared at your bank, mark it posted first, so it isn't counted twice.";
export const SIGNED_BALANCE_ERROR = 'Enter a balance like 1250.00, or -50.00 if the account is overdrawn.';
export const CARD_BALANCE_ERROR = 'Enter the amount without a sign, then choose Owed or In credit.';
export const ALREADY_INCLUDED_LABEL = (date: string, account?: string) => (account ? `Already included in ${account}'s balance as of ${date}` : `Already included in this account's balance as of ${date}`);
export const ALREADY_INCLUDED_HINT = "Kept in your history but not added to the account balance again.";
/** Phase 4A.5.8: labels for transactions kept in history but not added to the balance again. */
export const HISTORY_ONLY_BADGE = 'Already in balance';
export const HISTORY_ONLY_REASON = (date: string) => `Already included in balance as of ${date}. Kept in history, not added again.`;
export const BEFORE_OPENING_BADGE = 'Before account added';
export const BEFORE_OPENING_REASON = (date: string) => `Dated before this account was added on ${date}, so it's already reflected in the opening balance. Kept in history, not added again.`;
/** Phase 4A.5.8: Update balance safeguards. */
export const PENDING_MATCH_TITLE = 'This difference matches pending items';
export const PENDING_MATCH_NOTE =
  "If one of them has cleared at your bank, mark it posted and Clarity will recalculate. Recording the difference as an adjustment instead would count it twice once the item posts.";
/** Phase 4A.5.9: a pending item in the same direction could explain part of the difference. */
export const PENDING_PARTIAL_TITLE = 'Pending items could explain some or all of this difference';
export const PENDING_PARTIAL_NOTE = (difference: string) =>
  `If one or more of them has cleared at your bank (perhaps for a different amount), mark it posted and Clarity will recalculate. Clarity checks exact combinations of up to 3 items only, so several of these together could also make up the whole difference. If you record ${difference} now instead and they clear later, the overlapping part is counted twice.`;
/** Phase 4A.5.10: a statement row with the same amount as a pending transaction needs an explicit decision. */
export const PENDING_TWIN_SAME = (merchant: string) => `Same transaction: mark “${merchant}” posted (nothing new is added)`;
export const PENDING_TWIN_SEPARATE = 'Different transaction: import it as well';
export const PENDING_TWIN_SKIP = 'Leave it out';
export const PENDING_MATCH_UNRELATED = "The difference isn't related to these pending items; record the adjustment and keep them pending";
export const RECONCILED_MESSAGE = (account: string, date: string) => `${account} matches your bank's posted balance as of ${date}. No adjustment needed.`;
