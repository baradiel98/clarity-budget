import type { Account, Category, Cents, ID, ISODate, Transaction } from '@clarity/shared';

/**
 * Clarity Capture: turn "Yesterday I spent $45 at Walmart on groceries…" into DRAFT transactions.
 * Drafts never touch the user's data. Only approved drafts become transactions, through the same
 * validated commands as manual entry. All money is integer cents; all dates are ISO strings.
 */

export type DraftKind = 'expense' | 'income' | 'refund' | 'transfer';
/** What kind of transfer, for wording only (all are transfers: never income or spending). */
export type TransferRole = 'transfer' | 'card_payment' | 'savings';

export type Source = 'words' | 'memory' | 'rule' | 'default' | null;

export interface DraftSplit {
  label: string; // the user's words for this part, e.g. "household supplies"
  amountCents: Cents;
  categoryId: ID | null;
}

export interface CaptureDraft {
  id: string;
  kind: DraftKind;
  role: TransferRole | null;
  amountCents: Cents | null;
  /** The user said "around/about…". Must be confirmed before saving. */
  approximate: boolean;
  /** Currency the user wrote (base currency when none was written). */
  currency: string;
  currencyWritten: boolean;
  merchant: string;
  merchantSource: 'words' | 'description' | null;
  date: ISODate | null;
  /** How the date was found: the user's words, carried from earlier in the message, or not mentioned. */
  dateSource: 'words' | 'carried' | 'later' | 'none' | null;
  dateText: string | null;
  /** A numeric date such as 10/11 that could be read two ways. */
  dateAmbiguous: boolean;
  categoryId: ID | null;
  categorySource: Source;
  /** Words that looked like a category but matched none of the user's categories. */
  categoryWords: string | null;
  accountId: ID | null;
  accountSource: Source;
  /** An account the user named that does not exist. */
  accountWords: string | null;
  toAccountId: ID | null;
  toAccountWords: string | null;
  splits: DraftSplit[];
  /** "I paid 200." — not clear whether this was a purchase, a bill or a payment. */
  kindUnclear: boolean;
  /** Exactly the part of the message this draft came from. */
  sourceText: string;
  /** Issue codes the user has confirmed (approximate amount, assumed date, possible duplicate…). */
  acknowledged: IssueCode[];
}

export type IssueCode =
  | 'amount_missing' | 'amount_approx' | 'currency_other'
  | 'date_missing' | 'date_assumed' | 'date_ambiguous' | 'date_future'
  | 'merchant_missing' | 'merchant_description'
  | 'category_missing' | 'category_unknown_words'
  | 'account_missing' | 'account_unknown' | 'account_default' | 'before_tracking'
  | 'to_account_missing' | 'same_account'
  | 'kind_unclear'
  | 'splits_mismatch' | 'split_category_missing'
  | 'duplicate';

export interface Issue {
  code: IssueCode;
  field: 'amount' | 'date' | 'merchant' | 'category' | 'account' | 'toAccount' | 'kind' | 'splits' | 'currency';
  message: string;
  /** Blocks approval until fixed (or confirmed, when `confirmable`). */
  blocking: boolean;
  /** The user can confirm instead of changing anything (e.g. "the date is right"). */
  confirmable: boolean;
}

export interface CaptureContext {
  today: ISODate;
  currency: string;
  categories: readonly Category[];
  accounts: readonly Account[];
  defaultAccountId: ID | null;
  transactions: readonly Transaction[];
}

/** A pluggable interpreter. The local one runs on the device; a cloud one could be added later. */
export interface Interpreter {
  readonly id: string;
  /** Where the text is processed, shown to the user. */
  readonly runsOn: 'device' | 'cloud';
  interpret(text: string, ctx: CaptureContext): Promise<unknown>;
}
