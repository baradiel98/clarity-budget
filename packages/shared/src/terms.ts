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
  lowestBalance: 'Lowest projected balance',
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
