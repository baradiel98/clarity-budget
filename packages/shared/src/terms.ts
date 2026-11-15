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
/**
 * Phase 4B.2: the two low points Home can show, named by their time span so they never look like two versions of one
 * figure: Safe to Spend's ("Lowest through Dec 31") and this month's (TERMS.lowestBalance, "through Nov 30").
 */
export const LOWEST_THROUGH = (date: string) => `Lowest through ${date}`;
export const LOWEST_MONTH_SUB = (date: string, monthEnd: string) => `${date} · through ${monthEnd}`;
/** Phase 4B.1: the onboarding balance question keeps only this line visible; the full BALANCE_ENTRY_HINT is one tap away. */
export const BALANCE_ENTRY_SHORT = 'The posted balance your bank shows right now.';
export const BALANCE_ENTRY_MORE = 'More about this balance';
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
export const BEFORE_OPENING_REASON = (date: string) => `Dated before this account was added on ${date} and posted by then, so it's already in the opening (posted) balance. Kept in history, not added again. (A transaction that was still pending then isn't in it, and counts.)`;
/** Phase 4A.5.8: Update balance safeguards. */
export const PENDING_MATCH_TITLE = 'This difference matches pending items';
export const PENDING_MATCH_NOTE =
  "If one of them has cleared at your bank, mark it posted and Clarity will recalculate. Recording the difference as an adjustment instead would count it twice once the item posts.";
/** Phase 4A.5.9: a pending item in the same direction could explain part of the difference. */
export const PENDING_PARTIAL_TITLE = 'Pending items could explain some or all of this difference';
export const PENDING_PARTIAL_NOTE = (difference: string) =>
  `If one or more of them has cleared at your bank (perhaps for a different amount), mark it posted and Clarity will recalculate. Clarity checks exact combinations of up to 3 items only, so several of these together could also make up the whole difference. If you record ${difference} now instead and they clear later, the overlapping part is counted twice.`;
/** Phase 4A.5.12: a statement row that could be an existing transaction needs an explicit choice. */
export const MATCH_CHOICE_TITLE = 'Is this row one of these transactions already in Clarity?';
export const MATCH_NONE_LABEL = (n: number) => (n === 1 ? 'Different transaction: not this one. Import it as new' : `Different transaction: none of these ${n}. Import it as new`);
export const MATCH_SKIP_LABEL = 'Leave it out';
export const MATCH_PENDING_NOTE = 'It will be marked posted and linked to this row. Nothing new is added.';
export const MATCH_POSTED_NOTE = 'Already posted in Clarity: this row will be linked to it. Nothing new is added.';
export const MATCH_AMOUNT_NOTE = (clarity: string, statement: string, difference: string) =>
  `Clarity has ${clarity}; the statement shows ${statement} (difference ${difference}). If they're the same event (a tip, a fee, a partial deposit), Clarity keeps the original amount; the balance check below shows the ${difference} so you can record it or edit the transaction.`;
export const MATCH_TAKEN = (row: number) => `already chosen for row ${row}`;
/** Phase 4A.5.14: pending items older than the normal window, listed separately (never chosen automatically). */
export const MATCH_STALE_TITLE = (days: number) => `Older pending transactions (outside the normal ${days}-day matching window)`;
/** Phase 4A.5.14: linking one transfer leg never posts the other account's side. */
export const MATCH_TRANSFER_NOTE = (other: string) => `Only this account's side of the transfer is linked. The ${other} side stays as it is until its own statement shows it (or you mark it posted).`;
/** Phase 4A.5.14: a transfer leg whose amount differs can be linked only with the difference explained as a fee. */
export const MATCH_FEE_LABEL = (fee: string, account: string) => `It's this one, and the bank charged a ${fee} transfer fee (recorded as spending in ${account})`;
export const MATCH_FEE_NOTE = (fee: string, principal: string, account: string) =>
  `Clarity records the transfer as ${principal} and the ${fee} fee as a separate expense in ${account}. Nothing else is changed. If you aren't sure the difference is a fee, leave the row out and check with your bank.`;
/** Phase 4A.5.17: a statement row that may be the return of a card payment recorded in Clarity. */
export const MATCH_RETURN_LABEL = "It's the return of this card payment";
export const MATCH_RETURN_NOTE = (paying: string, card: string) =>
  `Clarity records the money coming back to ${paying} and the payment as returned: it no longer counts as paying ${card}, so ${card}'s debt is counted in full again. It isn't counted as income. The payment itself is kept (with its history); undo removes the return.`;
/** Phase 4A.5.18: a partial return. */
export const MATCH_PARTIAL_RETURN_LABEL = "It's a partial return of this card payment";
export const MATCH_PARTIAL_RETURN_NOTE = (returned: string, payment: string, left: string, card: string) =>
  `Only ${returned} of the ${payment} payment came back; the other ${left} still counts as paying ${card}.`;
/** Phase 4A.5.18: a review row confirmed as a return (in place of its type and category). */
export const RETURN_ROW_BADGE = 'Returned card payment';
export const RETURN_ROW_TEXT = (amount: string, payment: string, date: string, card: string) =>
  `Linked as the return of ${amount} of the ${payment} payment to ${card} on ${date}, not imported as income.`;
/** Phase 4A.8: a row that may be the return of a card payment row in the same statement (neither in Clarity yet). */
export const STATEMENT_RETURN_LABEL = (row: number, date: string, description: string, amount: string) => `It's the return of the card payment in row ${row}: ${date} · ${description} · ${amount}`;
export const STATEMENT_RETURN_NOTE = (row: number) =>
  `Clarity imports row ${row} as a payment to your credit card and records this row as its return: the money coming back isn't counted as income, and the payment no longer counts as paying the card. Row ${row} must be imported as a transfer to the credit card it paid.`;
export const STATEMENT_RETURN_TITLE = 'Is this the return of a card payment in this statement?';
export const STATEMENT_RETURN_NONE_LABEL = "No, it's a separate transaction. Import it as new";
export const STATEMENT_RETURN_NEEDS_PAYMENT = (row: number) => `To record this return, import row ${row} as a transfer to your credit card (Type: Transfer, then the card).`;
export const STATEMENT_RETURN_ROW_TEXT = (amount: string, payment: string, row: number, date: string) =>
  `Linked as the return of ${amount} of the ${payment} card payment in row ${row} (${date}) of this statement, not imported as income.`;
export const FEE_BLOCKED_BY_RETURNS = (returned: string, statement: string) =>
  `Can't be linked: ${returned} of this payment was already returned, so it can't become ${statement} with a transfer fee (returns can't exceed the payment). Remove the return first, or leave the row out.`;
/** Phase 4A.10: Mark paid when an existing transaction may already be that payment. */
export const MARK_PAID_EXISTING_TITLE = 'Already recorded? If one of these transactions paid it, link it instead of adding a new one.';
export const MARK_PAID_NEW = 'No, record a new payment';
export const MARK_PAID_CHOOSE = 'Choose the transaction that paid it, or “No, record a new payment”.';
export const MARK_PAID_LINK_NOTE = 'Nothing new is added: the transaction keeps its amount, date and status, and this scheduled payment stops counting in your forecast.';
export const MARK_PAID_SCHEDULED = (name: string, date: string, amount: string, account: string) => `${name} · due ${date} · ${amount} · ${account}`;
/** Phase 4A.11: late payments of an overdue occurrence, and links whose occurrence is gone. */
export const MARK_PAID_SHOW_OLDER = 'Show older transactions';
export const MARK_PAID_OLDER_HINT = (days: number) => `This payment is overdue: transactions up to ${days} days after the due date are listed too. Nothing is selected for you.`;
export const MARK_PAID_NO_OLDER = (days: number) => `No older transaction fits (same account and type, up to ${days} days after the due date, an amount that fits or the item's name).`;
export const MARK_PAID_NOT_LISTED = (name: string) => `Not listed? If ${name} was already paid some other way, Skip this occurrence in Planning instead of recording it again. Record a new payment only if you are paying it now.`;
export const LINK_ITEM_MISSING = "Linked to a scheduled payment whose scheduled item was deleted. Unlink it to clear the link (it isn't moved to any other item).";
export const LINK_OCCURRENCE_MISSING = (name: string, date: string) => `Linked to ${name} due ${date}, which is no longer on the schedule (it was changed, paused or ended). Unlink it, then use Mark paid on the current date if this is that payment.`;
export const LINK_INVALID = (name: string, date: string) => `Linked to ${name} due ${date}, but it no longer fits it (its account or type changed). Unlink it.`;
export const LINKED_TO_OCCURRENCE = (name: string, date: string) => `Records the scheduled payment ${name} due ${date}.`;
/** Phase 4A.9: a scheduled-item suggestion based only on the amount and date (not selected; the user decides). */
export const OCCURRENCE_WEAK_HINT = "Only the amount and date are close; the description doesn't mention it. Tick only if this is that payment.";
export const OCCURRENCE_WEAK_ROW = (name: string, date: string) => `Could be ${name} (due ${date}): only the amount and date are close. Not linked unless you tick it.`;
export const OCCURRENCE_WEAK_BADGE = (name: string) => `${name}?`;
/** Phase 4A.5.18: the manual-entry decision (Add/Edit form). */
export const RETURN_CHECK_TITLE = 'Is this money a returned card payment?';
export const RETURN_SEPARATE_LABEL = "No, it's separate income";
export const RETURN_DECIDE_HINT = 'Not sure yet? Close without saving and decide later; nothing is recorded until you choose.';
export const RETURN_ASK_LINK = 'This is a returned card payment…';
export const RETURN_NEEDS_DECISION = 'Choose whether this is a returned card payment, or close to decide later.';
export const OPENING_POSTED_LABEL = (account: string) => `It had already posted when I added ${account}`;
export const OPENING_POSTED_HINT = (account: string, date: string) => `Pending items dated before ${account} was added (${date}) count, because the balance you entered was the posted balance. If this one had already posted by then, it's already in that balance: mark it so and it stops counting.`;
export const MATCH_NOT_FEE = (difference: string) =>
  `Can't be linked: the statement differs from this transfer by ${difference}, which can't be a transfer fee (more arrived, or less left, than was transferred). Leave the row out and check the transfer.`;
/** Phase 4A.5.12: the import button says what it will do (rows linked to existing transactions add nothing). */
export const IMPORT_BUTTON = (added: number, linked: number, returns = 0) =>
  [added || (!linked && !returns) ? `Import ${added} transaction${added === 1 ? '' : 's'}` : '', linked ? `${added ? 'link' : 'Link'} ${linked} to existing` : '', returns ? `${added || linked ? 'record' : 'Record'} ${returns} returned payment${returns === 1 ? '' : 's'}` : ''].filter(Boolean).join(', ').replace(/, ([^,]*)$/, ' and $1');
export const PENDING_MATCH_UNRELATED = "The difference isn't related to these pending items; record the adjustment and keep them pending";
export const RECONCILED_MESSAGE = (account: string, date: string) => `${account} matches your bank's posted balance as of ${date}. No adjustment needed.`;

/**
 * Phase 4A.5.14: a transfer's settlement, chosen per leg in the Add/Edit form (each leg posts on its own). The form
 * shows this control for every transfer, so no pending state is ever hidden.
 */
export type TransferSettlementChoice = 'both' | 'sent' | 'received' | 'none';
export const TRANSFER_STATUS_LABEL = 'Status';
export const TRANSFER_STATUS_OPTIONS: readonly { value: TransferSettlementChoice; label: string }[] = [
  { value: 'both', label: 'Posted by both banks' },
  { value: 'sent', label: 'Sent · awaiting deposit' },
  { value: 'received', label: 'Received · not yet posted by the sending bank' },
  { value: 'none', label: 'Not posted by either bank yet' },
];
/** Phase 4A.5.17: the same choices for a card payment (a card's issuer posts a payment; nothing is "deposited"). */
export const transferStatusOptions = (toCard: boolean): readonly { value: TransferSettlementChoice; label: string }[] =>
  toCard ? TRANSFER_STATUS_OPTIONS.map((o) => (o.value === 'sent' ? { ...o, label: 'Sent · awaiting posting by the card issuer' } : o.value === 'received' ? { ...o, label: 'Posted by the card issuer · not yet by the paying bank' } : o)) : TRANSFER_STATUS_OPTIONS;
export const TRANSFER_STATUS_HINT = "Each side of a transfer posts on its own. Money on its way in isn't counted as available until the receiving bank posts it; money going out counts at once.";
export const transferChoiceOf = (fromPending: boolean, toPending: boolean): TransferSettlementChoice =>
  fromPending ? (toPending ? 'none' : 'received') : toPending ? 'sent' : 'both';
export const legsPendingOf = (c: TransferSettlementChoice): { fromPending: boolean; toPending: boolean } =>
  ({ both: { fromPending: false, toPending: false }, sent: { fromPending: false, toPending: true }, received: { fromPending: true, toPending: false }, none: { fromPending: true, toPending: true } })[c];
