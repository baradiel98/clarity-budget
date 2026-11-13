/**
 * Domain types shared by every platform.
 *
 * Conventions (see docs/calculation-rules.md):
 * - Money is always an integer number of minor units ("cents"). Never a float.
 * - Dates are local calendar dates as ISO strings 'YYYY-MM-DD'. No time zones.
 * - A transaction amount is its effect on THAT account's balance.
 *   Asset accounts: positive balance = money you have.
 *   Credit cards: negative balance = money you owe.
 */

export type Cents = number;
export type ISODate = string;
export type CurrencyCode = string;
export type ID = string;

export type AccountType = 'checking' | 'savings' | 'cash' | 'credit_card';

export interface Account {
  id: ID;
  name: string;
  type: AccountType;
  currency: CurrencyCode;
  /** Balance at the moment the account was added (on openingDate). Card owed = negative. */
  openingBalanceCents: Cents;
  /** Transactions dated before this are history only and do not change the balance. */
  openingDate: ISODate;
  /** Counts toward "available cash" / Safe to Spend. Never true for credit cards. */
  spendable: boolean;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
}

export type TxKind = 'expense' | 'income' | 'transfer' | 'refund' | 'adjustment';
export type TxStatus = 'pending' | 'confirmed';

export interface Split {
  categoryId: ID;
  amountCents: Cents;
}

export interface Provenance {
  source: 'manual' | 'import' | 'onboarding' | 'recurring';
  importBatchId?: ID;
  rowNumber?: number;
  externalId?: string;
  /** Original statement description, preserved exactly. */
  rawDescription?: string;
}

export interface OccurrenceRef {
  recurringId: ID;
  /** The scheduled (pre-exception) date of the occurrence this transaction settles. */
  originalDate: ISODate;
}

export interface Transaction {
  id: ID;
  accountId: ID;
  date: ISODate;
  /** Signed effect on this account's balance. */
  amountCents: Cents;
  kind: TxKind;
  status: TxStatus;
  merchant: string;
  categoryId: ID | null;
  notes: string;
  splits?: Split[];
  /** Both legs of a transfer share this id. */
  transferGroupId?: ID;
  refundOfId?: ID;
  occurrenceRef?: OccurrenceRef;
  /** Reason text for adjustments (reconciliation trail). */
  adjustmentReason?: string;
  provenance: Provenance;
  createdAt: number;
  updatedAt: number;
}

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Sunday
export type DayOfMonth = number | 'last';

export type Schedule =
  | { freq: 'once'; date: ISODate }
  | { freq: 'every_n_days'; interval: number; anchor: ISODate }
  /** interval 1 = weekly, 2 = every two weeks. anchor = a real occurrence date. */
  | { freq: 'weekly'; interval: number; anchor: ISODate }
  | { freq: 'twice_monthly'; day1: DayOfMonth; day2: DayOfMonth }
  /** interval 1 = monthly, 3 = quarterly, 12 = annually; anchor gives the starting month. */
  | { freq: 'monthly'; interval: number; day: DayOfMonth; anchor: ISODate };

export type RecurringAmount =
  | { type: 'fixed'; cents: Cents }
  /** Varies; cents is the user's estimate used until history exists. */
  | { type: 'variable'; cents: Cents }
  /** Unknown ("It varies" income with no estimate). Counts as $0 and is flagged. */
  | { type: 'unknown' }
  /** Credit card payment of the full owed balance at that date. */
  | { type: 'card_full_balance' };

export type RecurringKind = 'income' | 'bill' | 'subscription' | 'transfer' | 'savings';
export type WeekendRule = 'none' | 'before' | 'after';

export interface RecurringItem {
  id: ID;
  name: string;
  kind: RecurringKind;
  /** Income: account receiving. Bills: account paying. Transfers/savings: source account. */
  accountId: ID;
  /** Destination for transfer / savings kinds (e.g. a credit card or savings account). */
  toAccountId?: ID;
  categoryId: ID | null;
  schedule: Schedule;
  /** Always a positive magnitude; direction comes from `kind`. */
  amount: RecurringAmount;
  weekendRule: WeekendRule;
  startDate: ISODate;
  endDate?: ISODate;
  /** Occurrences before this date are never reported as overdue (usually the creation date). */
  trackFrom: ISODate;
  paused: boolean;
  pausedFrom?: ISODate;
  createdAt: number;
  updatedAt: number;
}

export interface OccurrenceException {
  id: ID;
  recurringId: ID;
  originalDate: ISODate;
  action: 'skip' | 'move' | 'override';
  newDate?: ISODate;
  amountCents?: Cents;
  createdAt: number;
  updatedAt: number;
}

export interface Category {
  id: ID;
  name: string;
  group: string;
  /** lucide icon name */
  icon: string;
  kind: 'expense' | 'income';
  /** Optional monthly budget for an expense category. Absent or null = no budget set. */
  budgetCents?: Cents | null;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Settings {
  id: 'settings';
  baseCurrency: CurrencyCode;
  minReserveCents: Cents;
  defaultAccountId: ID | null;
  autoLockMinutes: number;
  theme: 'system' | 'light' | 'dark';
  lastBackupAt: number | null;
  txSinceBackup: number;
  backupReminderDays: number;
  backupReminderTxCount: number;
  onboardingComplete: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ColumnMapping {
  date: number;
  description: number;
  /** Either a single signed amount column... */
  amount?: number;
  /** ...or separate debit / credit columns. */
  debit?: number;
  credit?: number;
  balance?: number;
  externalId?: number;
}

export type DateFormat =
  | 'YYYY-MM-DD'
  | 'YYYY/MM/DD'
  | 'MM/DD/YYYY'
  | 'DD/MM/YYYY'
  | 'MM/DD/YY'
  | 'DD/MM/YY'
  | 'DD.MM.YYYY'
  | 'DD-MM-YYYY'
  | 'MM-DD-YYYY'
  | 'D MMM YYYY'
  | 'MMM D YYYY';

export type SignConvention = 'as_is' | 'invert';
export type DecimalSeparator = '.' | ',';

export interface MappingProfile {
  id: ID;
  /** Normalized header row joined with '|'. */
  headerSignature: string;
  delimiter: string;
  hasHeader: boolean;
  columns: ColumnMapping;
  dateFormat: DateFormat;
  decimalSeparator: DecimalSeparator;
  signConvention: SignConvention;
  createdAt: number;
  updatedAt: number;
}

export interface ReconciliationResult {
  statementBalanceCents: Cents | null;
  statementBalanceDate: ISODate | null;
  appBalanceCents: Cents | null;
  differenceCents: Cents | null;
  runningBalanceConsistent: boolean | null;
  adjustmentTransactionId?: ID;
}

export interface ImportBatch {
  id: ID;
  fileName: string;
  fileHash: string;
  parserId: string;
  mappingProfileId: ID | null;
  accountId: ID;
  importedAt: number;
  counts: { rows: number; imported: number; excluded: number; duplicates: number; errors: number };
  reconciliation: ReconciliationResult | null;
  undoneAt: number | null;
  createdAt: number;
  updatedAt: number;
}

/** Everything that belongs to one workspace, decrypted, in memory. */
export interface WorkspaceData {
  accounts: Account[];
  transactions: Transaction[];
  recurring: RecurringItem[];
  exceptions: OccurrenceException[];
  categories: Category[];
  settings: Settings;
  importBatches: ImportBatch[];
  mappingProfiles: MappingProfile[];
}

export type TableName =
  | 'accounts'
  | 'transactions'
  | 'recurring'
  | 'exceptions'
  | 'categories'
  | 'settings'
  | 'importBatches'
  | 'mappingProfiles';

export const TABLES: readonly TableName[] = [
  'accounts',
  'transactions',
  'recurring',
  'exceptions',
  'categories',
  'settings',
  'importBatches',
  'mappingProfiles',
] as const;
