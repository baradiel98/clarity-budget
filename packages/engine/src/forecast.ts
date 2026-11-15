import {
  addDays,
  diffDays,
  type Account,
  type Cents,
  type CurrencyCode,
  type ID,
  type ISODate,
  type OccurrenceException,
  type RecurringItem,
  type Transaction,
} from '@clarity/shared';
import { accountBalance, cardPaymentsInTransit, isCardPaymentInTransit, isCashAccount, isPendingCredit, pendingCreditTotal } from './balances';
import { expandOccurrences, OVERDUE_LOOKBACK_DAYS, type Occurrence } from './occurrences';

export interface Hypothetical {
  id: string;
  accountId: ID;
  date: ISODate;
  /** Signed effect on that account (a purchase is negative). */
  amountCents: Cents;
  label: string;
}

export interface ForecastInput {
  today: ISODate;
  horizonEnd: ISODate;
  accounts: readonly Account[];
  transactions: readonly Transaction[];
  recurring: readonly RecurringItem[];
  exceptions: readonly OccurrenceException[];
  baseCurrency: CurrencyCode;
  /** false = conservative mode: income with an estimated (not fixed) amount is left out. */
  includeEstimatedIncome: boolean;
  hypotheticals?: readonly Hypothetical[];
}

/** archived_balance: an archived spendable account that is overdrawn today (Phase 4A.4.4). */
export type EventSource = 'occurrence' | 'overdue' | 'scheduled_tx' | 'hypothetical' | 'archived_balance';
export type ExclusionReason = 'unknown_amount' | 'estimated_income' | 'overdue_income' | 'pending_credit';

export interface Leg {
  accountId: ID;
  deltaCents: Cents;
}

export interface ForecastEvent {
  id: string;
  date: ISODate;
  label: string;
  source: EventSource;
  legs: Leg[];
  /** Net effect on available cash (spendable accounts). */
  cashDeltaCents: Cents;
  occurrence?: Occurrence;
  txId?: ID;
  /** Present only on events listed for transparency but not counted. */
  excluded?: ExclusionReason;
  /** Amount was estimated (variable bill, card balance, history average). */
  estimated: boolean;
  /** Transfer only: part of the requested amount the sending account could not cover (never moved). */
  unfundedCents?: Cents;
  /**
   * Payment from a non-spendable account (savings), or a card payment from one, that the account can't fully
   * cover: this part has to be moved in from the spendable accounts, so it is counted against them (Phase 4A.4).
   */
  coverCents?: Cents;
  /**
   * Phase 4A.5.9: part of the money arriving in an overdrawn non-spendable account that repays its negative balance,
   * which was already counted against the spendable accounts (so it is given back, never counted twice).
   */
  repaidCents?: Cents;
}

/** A transfer out of a non-spendable asset account (e.g. savings) that asks for more than the account holds. */
export interface UnfundedTransfer {
  eventId: string;
  label: string;
  date: ISODate;
  fromAccountId: ID;
  toAccountId: ID;
  requestedCents: Cents;
  fundedCents: Cents;
  /** The sending account's projected balance when the transfer was due (may be negative). */
  sourceBalanceCents: Cents;
  /**
   * Other transfers from the same account that day that received money (Phase 4A.4.2). sameGroup = shared in
   * proportion with this one; otherwise it was funded first under the same-day priority (a forecast assumption).
   */
  competing: { label: string; requestedCents: Cents; fundedCents: Cents; sameGroup: boolean }[];
}

/** A transfer between accounts in different currencies (Phase 4A.4.2). Never converted. */
export interface CurrencyConflict {
  eventId: string;
  label: string;
  date: ISODate;
  fromAccountId: ID;
  toAccountId: ID;
  fromCurrency: CurrencyCode;
  toCurrency: CurrencyCode;
  /** Signed amount leaving the sending account, in its own currency. */
  cents: Cents;
  /** false = not counted at all (a full-balance card payment has no amount in the sender's currency). */
  counted: boolean;
}

/** A payment due from a non-spendable account (savings) that holds less than the payment (Phase 4A.4). */
export interface CoveredPayment {
  eventId: string;
  label: string;
  date: ISODate;
  accountId: ID;
  requestedCents: Cents;
  /** Paid from the account's own money. */
  fundedCents: Cents;
  /** Has to come from the spendable accounts; counted in Safe to Spend. */
  coveredCents: Cents;
  /** The account's projected balance before the payment (may be negative). */
  accountBalanceCents: Cents;
  /** 'overdrawn': an archived spendable account's negative balance today, still owed (Phase 4A.4.4). */
  kind?: 'payment' | 'overdrawn';
}

/** A planned transfer out of a credit card into another account: borrowed money (Phase 4A.4). */
export interface CashAdvance {
  eventId: string;
  label: string;
  date: ISODate;
  cardId: ID;
  toAccountId: ID;
  cents: Cents;
}

/** A day on which a spendable account is projected below zero after that day's money going out (every such day). */
export interface AccountShortfall {
  accountId: ID;
  date: ISODate;
  lowCents: Cents;
  /** What was paid out of the account that day. */
  labels: string[];
}

export interface ForecastDay {
  date: ISODate;
  startCashCents: Cents;
  /** After that day's outflows, before its inflows (conservative intraday low). */
  lowCashCents: Cents;
  endCashCents: Cents;
  /** Planned cash-advance money still owed at the day's low point / at the end of the day (Phase 4A.4). */
  advanceOwedAtLowCents: Cents;
  advanceOwedEndCents: Cents;
  /**
   * Phase 4A.5.2: each base-currency card at the day's low point (after the day's money going out): what it owes,
   * the planned cash-advance part of that, and payments/refunds credited to it after the low point that day and
   * over the whole day. Used to decide which card debt a later payment covers (Policy B).
   */
  cards: Record<ID, {
    /** Owed at the low point, plus pending card credits (a pending refund is not counted until it posts; Phase 4A.5.4). */
    owedAtLowCents: Cents;
    advanceAtLowCents: Cents;
    /** Payments (money moved into the card from another account) after the low point that day / over the whole day. */
    paymentsAfterLowCents: Cents;
    paymentsCents: Cents;
    /** Refunds, cashback and other credits that arrive that day: they lower the debt from that day, never earlier. */
    otherCreditsCents: Cents;
  }>;
  events: ForecastEvent[];
}

export interface Forecast {
  today: ISODate;
  horizonEnd: ISODate;
  startCashCents: Cents;
  cashAccountIds: ID[];
  days: ForecastDay[];
  /** Listed for the user but not counted (unknown income, overdue income, ...). */
  excludedEvents: ForecastEvent[];
  /** All occurrences in the window incl. confirmed / skipped / overdue (for Upcoming views). */
  occurrences: Occurrence[];
  /** End-of-horizon balance for every account (including cards). */
  endBalances: Record<ID, Cents>;
  /** Transfers capped at what the sending account held (Phase 4A.2). */
  unfundedTransfers: UnfundedTransfer[];
  /** Spendable accounts projected below zero, every day it happens, even when the combined total is fine. */
  accountShortfalls: AccountShortfall[];
  /** Payments from non-spendable accounts that need money from the spendable accounts (Phase 4A.4). */
  coveredPayments: CoveredPayment[];
  /** Planned cash advances (borrowed money; not counted in Safe to Spend until repaid). */
  cashAdvances: CashAdvance[];
  /** Transfers between accounts in different currencies: only the money leaving is counted (Phase 4A.4.2). */
  currencyConflicts: CurrencyConflict[];
  /** Pending refunds/credits on base-currency cards, not counted against card debt until they post (Phase 4A.5.4). */
  pendingCardCredits: Record<ID, Cents>;
  /** Phase 4A.5.6: recorded spendable cash today (startCashCents is what is available: without pending credits). */
  recordedStartCashCents: Cents;
  /** Phase 4A.5.6: pending credits held back on non-card accounts (spendable = counted in the combined cash). */
  pendingCredits: { accountId: ID; cents: Cents; spendable: boolean }[];
  /** Phase 4A.5.15: card payments in transit today (counted from the paying account; not reserved again as card debt). */
  cardPaymentsInTransit: { cardId: ID; fromAccountId: ID | null; cents: Cents; txId: ID }[];
}

function legsForOccurrence(o: Occurrence, amount: Cents): Leg[] {
  switch (o.kind) {
    case 'income':
      return [{ accountId: o.accountId, deltaCents: amount }];
    case 'bill':
    case 'subscription':
      return [{ accountId: o.accountId, deltaCents: -amount }];
    case 'transfer':
    case 'savings':
      return o.toAccountId
        ? [
            { accountId: o.accountId, deltaCents: -amount },
            { accountId: o.toAccountId, deltaCents: amount },
          ]
        : [{ accountId: o.accountId, deltaCents: -amount }];
  }
}

/** The two legs of a transfer (one out, one in), or null for anything else. */
function transferLegs(e: ForecastEvent): { src: Leg; dst: Leg } | null {
  if (e.legs.length !== 2) return null;
  const src = e.legs.find((l) => l.deltaCents < 0);
  const dst = e.legs.find((l) => l.deltaCents > 0);
  return src && dst ? { src, dst } : null;
}

export function buildForecast(input: ForecastInput): Forecast {
  const { today, horizonEnd, accounts, transactions, baseCurrency } = input;
  if (horizonEnd < today) throw new Error('horizonEnd must be on or after today');
  if (diffDays(horizonEnd, today) > 800) throw new Error('Forecast horizon is limited to about two years');

  const cashIds = new Set(accounts.filter((a) => isCashAccount(a, baseCurrency)).map((a) => a.id));
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  // Running balances for every account. Phase 4A.5.6: the forecast works with money that is available: the recorded
  // balance minus pending credits (pending refunds/income are visible in the recorded balance but not spendable until
  // they clear, so they can't fund bills or transfers or hide a debt). Cards keep their recorded balance; their
  // pending credits are added back to the debt instead (Phase 4A.5.4), so a full-balance payment isn't inflated.
  const pendingCredits = new Map<ID, Cents>();
  for (const a of accounts) {
    const p = pendingCreditTotal(a, transactions, today);
    if (p > 0) pendingCredits.set(a.id, p);
  }
  const balances = new Map<ID, Cents>();
  let recordedCash = 0;
  for (const a of accounts) {
    const recorded = accountBalance(a, transactions, today);
    if (cashIds.has(a.id)) recordedCash += recorded;
    balances.set(a.id, a.type === 'credit_card' ? recorded : recorded - (pendingCredits.get(a.id) ?? 0));
  }
  let cash = 0;
  for (const id of cashIds) cash += balances.get(id) ?? 0;
  const startCash = cash;

  const occurrences = expandOccurrences(input.recurring, input.exceptions, transactions, {
    from: addDays(today, -OVERDUE_LOOKBACK_DAYS),
    to: horizonEnd,
    today,
  });

  const byDate = new Map<ISODate, ForecastEvent[]>();
  const push = (e: ForecastEvent) => {
    const list = byDate.get(e.date);
    if (list) list.push(e);
    else byDate.set(e.date, [e]);
  };
  const excluded: ForecastEvent[] = [];

  // 1) Future-dated (planned) transactions the user already recorded. Both legs of a planned transfer
  //    become ONE event, so the sending account's funds can be checked against the whole move.
  const plannedTransfer = new Map<string, ForecastEvent>();
  for (const t of transactions) {
    if (t.date <= today || t.date > horizonEnd) continue;
    const acct = accountById.get(t.accountId);
    // Phase 4A.5.8: an "already included" flag on a future-dated transaction is invalid (it can't be in a balance
    // confirmed today or earlier), so it is ignored and the transaction is counted, never silently dropped.
    if (!acct || t.date < acct.openingDate) continue;
    // Phase 4A.5.6: a future-dated credit still marked pending isn't counted until it is posted. Phase 4A.5.15: except
    // the card side of a card payment from another account: it moves with its sending leg, counted once.
    if (isPendingCredit(t) && !isCardPaymentInTransit(acct, t, transactions)) {
      excluded.push({ id: `tx:${t.id}`, date: t.date, label: t.merchant || 'Pending credit', source: 'scheduled_tx', legs: [], cashDeltaCents: 0, txId: t.id, estimated: false, excluded: 'pending_credit' });
      continue;
    }
    if (t.transferGroupId) {
      const k = `${t.date}|${t.transferGroupId}`;
      const pair = plannedTransfer.get(k);
      if (pair) {
        pair.legs.push({ accountId: t.accountId, deltaCents: t.amountCents });
        // keep the sending leg first and its transaction as the event's txId
        pair.legs.sort((a, b) => a.deltaCents - b.deltaCents);
        if (t.amountCents < 0) { pair.txId = t.id; pair.id = `tx:${t.id}`; }
        continue;
      }
    }
    const ev: ForecastEvent = {
      id: `tx:${t.id}`,
      date: t.date,
      label: t.merchant || 'Planned transaction',
      source: 'scheduled_tx',
      legs: [{ accountId: t.accountId, deltaCents: t.amountCents }],
      cashDeltaCents: 0,
      txId: t.id,
      estimated: false,
    };
    if (t.transferGroupId) plannedTransfer.set(`${t.date}|${t.transferGroupId}`, ev);
    push(ev);
  }

  // 2) Recurring occurrences.
  for (const o of occurrences) {
    if (o.status === 'confirmed' || o.status === 'skipped') continue;
    const base: Omit<ForecastEvent, 'legs' | 'cashDeltaCents' | 'source' | 'date'> = {
      id: `occ:${o.key}`,
      label: o.name,
      occurrence: o,
      estimated: o.status === 'estimated' || o.amountBasis === 'card_balance',
    };
    if (o.status === 'overdue') {
      if (o.kind === 'income') {
        excluded.push({ ...base, date: o.date, source: 'overdue', legs: [], cashDeltaCents: 0, excluded: 'overdue_income' });
        continue;
      }
      // Unpaid obligations are assumed still due: counted today.
      push({ ...base, date: today, source: 'overdue', legs: [], cashDeltaCents: 0 });
      continue;
    }
    if (o.status === 'unknown') {
      excluded.push({ ...base, date: o.date, source: 'occurrence', legs: [], cashDeltaCents: 0, excluded: 'unknown_amount' });
      continue;
    }
    if (o.kind === 'income' && o.status === 'estimated' && !input.includeEstimatedIncome) {
      excluded.push({ ...base, date: o.date, source: 'occurrence', legs: [], cashDeltaCents: 0, excluded: 'estimated_income' });
      continue;
    }
    push({ ...base, date: o.date, source: 'occurrence', legs: [], cashDeltaCents: 0 });
  }

  // 2b) Debt is never hidden. Archiving (Phase 4A.4.4): an archived account that was counted as spendable and is
  //     overdrawn today keeps counting against the spendable accounts. Phase 4A.5.9 (owner decision): the same for
  //     any account NOT counted as spendable (savings), active or archived: a negative balance is owed and reduces
  //     Safe to Spend; a positive or zero balance has no effect (it is still not spendable).
  for (const a of accounts) {
    if (a.type === 'credit_card' || a.currency !== baseCurrency) continue;
    if (a.spendable && !a.archived) continue; // counted directly as spendable money
    if ((balances.get(a.id) ?? 0) >= 0) continue;
    push({ id: `overdrawn:${a.id}`, date: today, label: `${a.name}${a.archived ? ' (archived)' : ''} overdrawn balance`, source: 'archived_balance', legs: [], cashDeltaCents: 0, estimated: false });
  }

  // 3) Hypothetical purchases ("Can I afford this?") — never stored.
  for (const h of input.hypotheticals ?? []) {
    if (h.date < today || h.date > horizonEnd) continue;
    push({
      id: `hyp:${h.id}`,
      date: h.date,
      label: h.label,
      source: 'hypothetical',
      legs: [{ accountId: h.accountId, deltaCents: h.amountCents }],
      cashDeltaCents: 0,
      estimated: false,
    });
  }

  const days: ForecastDay[] = [];
  const unfunded: UnfundedTransfer[] = [];
  const shortfalls: AccountShortfall[] = [];
  const covered: CoveredPayment[] = [];
  // Phase 4A.5.9: overdrawn non-spendable accounts whose negative balance is counted against the spendable accounts;
  // what is still unpaid. Money arriving in them later repays it first (see repay()).
  const debtCounted = new Map<ID, Cents>();
  const advanceList: CashAdvance[] = [];
  const conflicts: CurrencyConflict[] = [];
  /** Per card: planned cash-advance money still owed (never more than the card's projected balance owed). */
  const advanceOwed = new Map<ID, Cents>();
  const baseCards = new Set(accounts.filter((a) => a.type === 'credit_card' && a.currency === baseCurrency).map((a) => a.id));
  // Pending refunds and other pending credits already in a card's recorded balance (Phase 4A.5.4): for card debt they
  // are added back until they post (pendingCredits, computed above for every account).
  const total = diffDays(horizonEnd, today);
  for (let i = 0; i <= total; i++) {
    const date = addDays(today, i);
    const events = byDate.get(date) ?? [];

    // Resolve legs. Card full-balance payments use the card balance at the start of the day.
    for (const e of events) {
      if (e.legs.length > 0 || !e.occurrence) continue;
      const o = e.occurrence;
      let amount = o.amountCents;
      if (o.amountBasis === 'card_balance') {
        const cardId = o.toAccountId;
        const owed = cardId ? -(balances.get(cardId) ?? 0) : 0;
        amount = owed > 0 ? owed : 0;
        e.occurrence = { ...o, amountCents: amount };
      }
      e.legs = legsForOccurrence(o, amount);
    }
    // Same-day order (Phase 4A.4; docs/calculation-rules.md "Same-day order"):
    //  1. morning: moves out of spendable accounts (incl. card payments) settle, then bills and other payments.
    //     A payment from a non-spendable account (savings) uses what that account holds; the rest has to
    //     come from the spendable accounts and is counted against them ("covered").
    //  2. account check: every spendable account that paid something today and is below zero is recorded.
    //  3. afternoon: income and card cash advances arrive.
    //  4. evening: transfers out of non-spendable accounts, capped at what the account holds by then.
    // The combined low point is unchanged: the day's money going out, before any money coming in.
    // Money into base-currency cards (Phase 4A.5.2/4A.5.4). Only PAYMENTS (transfer legs from another account)
    // can cover existing card debt ahead of their date; refunds, cashback and other credits only lower the debt on
    // the day they arrive. Payments are split at the day's low point.
    let afterLow = false;
    const paymentsBefore = new Map<ID, Cents>();
    const paymentsAfter = new Map<ID, Cents>();
    const otherCredits = new Map<ID, Cents>();
    const apply = (id: ID, d: Cents, isPayment = false) => {
      balances.set(id, (balances.get(id) ?? 0) + d);
      if (d > 0 && baseCards.has(id)) {
        const m = !isPayment ? otherCredits : afterLow ? paymentsAfter : paymentsBefore;
        m.set(id, (m.get(id) ?? 0) + d);
      }
    };
    // Phase 4A.5.9: money arriving in an account whose negative balance was counted repays that first; the repaid part
    // is given back to the spendable accounts on the same event (the debt was already counted), so nothing is
    // counted twice. Returns what actually lands in the account.
    const repay = (id: ID, amount: Cents, e: ForecastEvent): Cents => {
      const owed = debtCounted.get(id) ?? 0;
      const r = Math.min(owed, Math.max(0, amount));
      if (r <= 0) return amount;
      debtCounted.set(id, owed - r);
      e.repaidCents = (e.repaidCents ?? 0) + r;
      return amount - r;
    };
    const typeOf = (id: ID) => accountById.get(id)?.type;
    const coverable = (id: ID) => {
      const a = accountById.get(id);
      // Archived accounts too (Phase 4A.4.2): archiving never removes what is scheduled from them.
      return !!a && !cashIds.has(id) && a.type !== 'credit_card' && a.currency === baseCurrency;
    };
    const paidOut = new Map<ID, string[]>();
    const noteOut = (id: ID, label: string) => paidOut.set(id, [...(paidOut.get(id) ?? []), label]);
    const syncAdvances = () => {
      for (const [card, owed] of advanceOwed) advanceOwed.set(card, Math.min(owed, Math.max(0, -(balances.get(card) ?? 0))));
    };
    const owedTotal = () => [...advanceOwed.values()].reduce((a, b) => a + b, 0);
    type Move = { e: ForecastEvent; src: ID; dst: ID; requested: Cents; funded: Cents; cls: 0 | 1 | 2 };
    const advances: { e: ForecastEvent; src: ID; dst: ID; cents: Cents }[] = [];
    const reserveMoves: Move[] = [];
    const payments: ForecastEvent[] = [];
    const incoming: ForecastEvent[] = [];
    // Overdrawn archived accounts: the debt is counted against the spendable accounts (and the account is brought
    // back to zero in the projection, so it isn't counted twice by later payments from it).
    for (const e of events) {
      if (e.source !== 'archived_balance') continue;
      const id = e.id.slice('overdrawn:'.length);
      const bal = balances.get(id) ?? 0;
      if (bal >= 0) continue;
      apply(id, -bal);
      e.coverCents = -bal;
      debtCounted.set(id, (debtCounted.get(id) ?? 0) - bal);
      covered.push({ eventId: e.id, label: e.label, date, accountId: id, requestedCents: -bal, fundedCents: 0, coveredCents: -bal, accountBalanceCents: bal, kind: 'overdrawn' });
    }
    // 0. Transfers between accounts in different currencies (Phase 4A.4.2): Clarity never converts. The money
    //    leaving the sending account is counted there; nothing is counted as arriving. A full-balance card payment
    //    across currencies has no amount in the sender's currency, so it is not counted at all (and warned about).
    for (const e of events) {
      const t = transferLegs(e);
      if (!t) continue;
      const fromCur = accountById.get(t.src.accountId)?.currency;
      const toCur = accountById.get(t.dst.accountId)?.currency;
      if (!fromCur || !toCur || fromCur === toCur) continue;
      const cardBalance = e.occurrence?.amountBasis === 'card_balance';
      conflicts.push({ eventId: e.id, label: e.label, date, fromAccountId: t.src.accountId, toAccountId: t.dst.accountId, fromCurrency: fromCur, toCurrency: toCur, cents: t.src.deltaCents, counted: !cardBalance });
      e.legs = cardBalance ? [] : [t.src];
    }
    // 1a. moves out of spendable accounts (and card-to-card), both legs
    for (const e of events) {
      const t = transferLegs(e);
      if (!t) { payments.push(e); continue; }
      const srcType = typeOf(t.src.accountId);
      if (cashIds.has(t.src.accountId) || (srcType === 'credit_card' && typeOf(t.dst.accountId) === 'credit_card')) {
        apply(t.src.accountId, t.src.deltaCents);
        apply(t.dst.accountId, repay(t.dst.accountId, t.dst.deltaCents, e), true);
        noteOut(t.src.accountId, e.label);
      } else if (srcType === 'credit_card') {
        advances.push({ e, src: t.src.accountId, dst: t.dst.accountId, cents: t.dst.deltaCents });
      } else {
        const dstType = typeOf(t.dst.accountId);
        reserveMoves.push({ e, src: t.src.accountId, dst: t.dst.accountId, requested: t.dst.deltaCents, funded: 0, cls: dstType === 'credit_card' ? 0 : cashIds.has(t.dst.accountId) ? 2 : 1 });
      }
    }
    // 1b. bills and other payments (non-transfer money going out)
    for (const e of payments) {
      for (const l of e.legs) {
        if (l.deltaCents >= 0) continue;
        if (coverable(l.accountId)) {
          const bal = balances.get(l.accountId) ?? 0;
          const requested = -l.deltaCents;
          const funded = Math.min(requested, Math.max(0, bal));
          apply(l.accountId, -funded); // the rest is paid with money moved in from the spendable accounts
          if (funded < requested) {
            e.coverCents = (e.coverCents ?? 0) + (requested - funded);
            // the account's real balance: an overdrawn balance counted separately is still part of it (Phase 4A.5.9)
            covered.push({ eventId: e.id, label: e.label, date, accountId: l.accountId, requestedCents: requested, fundedCents: funded, coveredCents: requested - funded, accountBalanceCents: bal - (debtCounted.get(l.accountId) ?? 0) });
          }
        } else {
          apply(l.accountId, l.deltaCents);
          noteOut(l.accountId, e.label);
        }
      }
      for (const l of e.legs) if (l.deltaCents > 0) incoming.push(e);
    }
    syncAdvances();
    const owedAtLow = owedTotal();
    const cardsAtLow: ForecastDay['cards'] = {};
    for (const id of baseCards) {
      cardsAtLow[id] = { owedAtLowCents: Math.max(0, -((balances.get(id) ?? 0) - (pendingCredits.get(id) ?? 0))), advanceAtLowCents: advanceOwed.get(id) ?? 0, paymentsAfterLowCents: 0, paymentsCents: 0, otherCreditsCents: 0 };
    }
    afterLow = true;
    // 2. account check (spendable accounts; non-spendable ones never go below zero here)
    for (const [id, labels] of paidOut) {
      const bal = balances.get(id) ?? 0;
      if (cashIds.has(id) && bal < 0) shortfalls.push({ accountId: id, date, lowCents: bal, labels });
    }
    // Phase 4A.5.8: a spendable account that is already overdrawn today (a signed balance, e.g. −$50) with nothing
    // paid out of it today is still a shortfall today (no labels: nothing was paid; it starts the day negative).
    if (date === today) {
      for (const id of cashIds) {
        const bal = balances.get(id) ?? 0;
        if (bal < 0 && !paidOut.has(id)) shortfalls.push({ accountId: id, date, lowCents: bal, labels: [] });
      }
    }
    // 3. income, refunds, cash advances
    for (const e of new Set(incoming)) for (const l of e.legs) if (l.deltaCents > 0) apply(l.accountId, repay(l.accountId, l.deltaCents, e));
    for (const a of advances) {
      apply(a.src, -a.cents);
      apply(a.dst, a.cents, true);
      // Borrowed against the spendable accounts only when the card is in the base currency (Phase 4A.4.4):
      // a card in another currency can't be subtracted from a base-currency total.
      if (typeOf(a.dst) !== 'credit_card' && accountById.get(a.src)?.currency === baseCurrency) {
        advanceOwed.set(a.src, (advanceOwed.get(a.src) ?? 0) + a.cents);
        advanceList.push({ eventId: a.e.id, label: a.e.label, date, cardId: a.src, toAccountId: a.dst, cents: a.cents });
      }
    }
    // 4. transfers out of non-spendable accounts: at most what the account holds now. When it can't cover all
    //    of them: card payments first, then moves that stay outside the spendable accounts, then moves INTO
    //    spendable accounts (so any shortage lands on the money Safe to Spend would count), shared in proportion.
    //    Repeated so a same-day chain (A -> B -> Checking) can pass money along; it can never create money.
    const sourceBalance = new Map<ID, Cents>();
    // reported balance = the real one (Phase 4A.5.9: an overdrawn balance counted separately is still part of it)
    for (const m of reserveMoves) if (!sourceBalance.has(m.src)) sourceBalance.set(m.src, (balances.get(m.src) ?? 0) - (debtCounted.get(m.src) ?? 0));
    for (let pass = 0, progress = true; progress && pass <= reserveMoves.length; pass++) {
      progress = false;
      const sources = [...new Set(reserveMoves.filter((m) => m.funded < m.requested).map((m) => m.src))].sort();
      for (const src of sources) {
        let avail = Math.max(0, balances.get(src) ?? 0);
        for (const cls of [0, 1, 2] as const) {
          const group = reserveMoves.filter((m) => m.src === src && m.cls === cls && m.funded < m.requested).sort((a, b) => (a.e.id < b.e.id ? -1 : a.e.id > b.e.id ? 1 : 0));
          if (!group.length || avail <= 0) continue;
          const need = group.reduce((s, m) => s + (m.requested - m.funded), 0);
          const give = Math.min(avail, need);
          const shares = group.map((m) => Number((BigInt(give) * BigInt(m.requested - m.funded)) / BigInt(need)));
          let left = give - shares.reduce((a, b) => a + b, 0);
          for (let k = 0; left > 0; k = (k + 1) % group.length) {
            if (shares[k]! < group[k]!.requested - group[k]!.funded) { shares[k]!++; left--; }
          }
          group.forEach((m, k) => {
            const sh = shares[k]!;
            if (sh <= 0) return;
            apply(m.src, -sh);
            apply(m.dst, repay(m.dst, sh, m.e), true);
            m.funded += sh;
            progress = true;
          });
          avail -= give;
        }
      }
    }
    for (const m of reserveMoves) {
      if (m.funded === m.requested) continue;
      const short = m.requested - m.funded;
      if (m.cls === 0) {
        // A card payment is an obligation: the part savings can't pay has to come from the spendable accounts.
        apply(m.dst, short, true);
        m.e.legs = [{ accountId: m.src, deltaCents: -m.funded }, { accountId: m.dst, deltaCents: m.requested }];
        m.e.coverCents = short;
        covered.push({ eventId: m.e.id, label: m.e.label, date, accountId: m.src, requestedCents: m.requested, fundedCents: m.funded, coveredCents: short, accountBalanceCents: sourceBalance.get(m.src) ?? 0 });
      } else {
        m.e.legs = [{ accountId: m.src, deltaCents: -m.funded }, { accountId: m.dst, deltaCents: m.funded }];
        m.e.unfundedCents = short;
        const competing = reserveMoves
          .filter((o) => o !== m && o.src === m.src && o.funded > 0)
          .map((o) => ({ label: o.e.label, requestedCents: o.requested, fundedCents: o.funded, sameGroup: o.cls === m.cls }));
        unfunded.push({ eventId: m.e.id, label: m.e.label, date, fromAccountId: m.src, toAccountId: m.dst, requestedCents: m.requested, fundedCents: m.funded, sourceBalanceCents: sourceBalance.get(m.src) ?? 0, competing });
      }
    }
    syncAdvances();

    const start = cash;
    let outflow = 0;
    let inflow = 0;
    for (const e of events) {
      e.cashDeltaCents = e.legs.reduce((s, l) => s + (cashIds.has(l.accountId) ? l.deltaCents : 0), 0) - (e.coverCents ?? 0) + (e.repaidCents ?? 0);
      if (e.cashDeltaCents < 0) outflow += e.cashDeltaCents;
      else inflow += e.cashDeltaCents;
    }
    const low = start + outflow;
    cash = low + inflow;
    // Order inside a day: outflows first, then inflows (what the low point assumes).
    events.sort((a, b) => a.cashDeltaCents - b.cashDeltaCents);
    for (const id of baseCards) {
      const c = cardsAtLow[id]!;
      c.paymentsAfterLowCents = paymentsAfter.get(id) ?? 0;
      c.paymentsCents = (paymentsBefore.get(id) ?? 0) + c.paymentsAfterLowCents;
      c.otherCreditsCents = otherCredits.get(id) ?? 0;
    }
    days.push({ date, startCashCents: start, lowCashCents: low, endCashCents: cash, advanceOwedAtLowCents: owedAtLow, advanceOwedEndCents: owedTotal(), cards: cardsAtLow, events });
  }

  return {
    today,
    horizonEnd,
    startCashCents: startCash,
    cashAccountIds: [...cashIds],
    days,
    excludedEvents: excluded,
    occurrences,
    endBalances: Object.fromEntries(balances),
    unfundedTransfers: unfunded,
    accountShortfalls: shortfalls,
    coveredPayments: covered,
    cashAdvances: advanceList,
    currencyConflicts: conflicts,
    pendingCardCredits: Object.fromEntries([...pendingCredits].filter(([id]) => baseCards.has(id))),
    recordedStartCashCents: recordedCash,
    pendingCredits: [...pendingCredits].filter(([id]) => accountById.get(id)?.type !== 'credit_card').map(([accountId, cents]) => ({ accountId, cents, spendable: cashIds.has(accountId) })),
    cardPaymentsInTransit: cardPaymentsInTransit(accounts.filter((a) => baseCards.has(a.id)), transactions, today),
  };
}

export interface LowPoint {
  cents: Cents;
  date: ISODate;
  /** Outflows that happen on or before the low point (what pulls the balance down). */
  obligations: ForecastEvent[];
  /** Inflows counted before the low point. */
  incomeBefore: ForecastEvent[];
  /** Borrowed (cash-advance) money still owed at the low point, already subtracted from `cents` (own-money lows only). */
  advanceOwedCents: Cents;
  /**
   * Phase 4A.5: the low is the end of the forecast after setting aside what the cards are projected to still owe
   * then (already subtracted from `cents`). Per card, in the base currency.
   */
  cardsOwed?: { accountId: ID; cents: Cents }[];
  /** Phase 4A.5.2: card debt at a daily low point (owed now / covered by a scheduled payment). */
  cardReserves?: {
    accountId: ID; owedCents: Cents; uncoveredCents: Cents; advanceCents: Cents; advanceTotalCents: Cents; coveredCents: Cents; paymentDate: ISODate | null;
    pendingCreditCents: Cents; nextCredit: { date: ISODate; cents: Cents } | null;
  }[];
}

/**
 * Lowest intraday cash level in [from, to] (inclusive). Ties → earliest date.
 * ownMoney: subtract planned cash-advance money still owed (Safe to Spend never counts borrowed money).
 */
export function lowestBetween(f: Forecast, from: ISODate, to: ISODate, opts: { ownMoney?: boolean } = {}): LowPoint | null {
  const v = (d: ForecastDay) => d.lowCashCents - (opts.ownMoney ? d.advanceOwedAtLowCents : 0);
  let best: ForecastDay | null = null;
  for (const d of f.days) {
    if (d.date < from || d.date > to) continue;
    if (!best || v(d) < v(best)) best = d;
  }
  if (!best) return null;
  const lowDate = best.date;
  const obligations: ForecastEvent[] = [];
  const incomeBefore: ForecastEvent[] = [];
  for (const d of f.days) {
    if (d.date > lowDate) break;
    for (const e of d.events) {
      if (e.cashDeltaCents < 0) obligations.push(e);
      else if (e.cashDeltaCents > 0 && d.date < lowDate) incomeBefore.push(e);
    }
  }
  return { cents: v(best), date: lowDate, obligations, incomeBefore, advanceOwedCents: opts.ownMoney ? best.advanceOwedAtLowCents : 0 };
}

export function dayOf(f: Forecast, date: ISODate): ForecastDay | undefined {
  return f.days.find((d) => d.date === date);
}
