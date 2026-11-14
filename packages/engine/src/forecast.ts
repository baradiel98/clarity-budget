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
import { accountBalance, isCashAccount } from './balances';
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

export type EventSource = 'occurrence' | 'overdue' | 'scheduled_tx' | 'hypothetical';
export type ExclusionReason = 'unknown_amount' | 'estimated_income' | 'overdue_income';

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
}

/** First day an account (not a credit card) is projected below zero after that day's money going out. */
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
  /** Accounts projected below zero (first day each), even when the combined spendable total is fine. */
  accountShortfalls: AccountShortfall[];
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

export function buildForecast(input: ForecastInput): Forecast {
  const { today, horizonEnd, accounts, transactions, baseCurrency } = input;
  if (horizonEnd < today) throw new Error('horizonEnd must be on or after today');
  if (diffDays(horizonEnd, today) > 800) throw new Error('Forecast horizon is limited to about two years');

  const cashIds = new Set(accounts.filter((a) => isCashAccount(a, baseCurrency)).map((a) => a.id));
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  // Running balances for every account, starting with today's recorded balance.
  const balances = new Map<ID, Cents>();
  for (const a of accounts) balances.set(a.id, accountBalance(a, transactions, today));
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
    if (!acct || t.date < acct.openingDate) continue;
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
    // Money going out first (bills and other outflows, then transfers out), then money coming in.
    // A transfer out of a non-spendable asset account (savings) can move at most what that account
    // holds at that moment, after its own outflows that day; the rest is unfunded and never arrives.
    const isTransfer = (e: ForecastEvent) => e.legs.length === 2 && e.legs.some((l) => l.deltaCents < 0) && e.legs.some((l) => l.deltaCents > 0);
    const apply = (l: Leg) => balances.set(l.accountId, (balances.get(l.accountId) ?? 0) + l.deltaCents);
    const paidOut = new Map<ID, string[]>();
    const noteOut = (l: Leg, e: ForecastEvent) => { if (l.deltaCents < 0) paidOut.set(l.accountId, [...(paidOut.get(l.accountId) ?? []), e.label]); };
    for (const e of events) if (!isTransfer(e)) for (const l of e.legs) if (l.deltaCents < 0) { apply(l); noteOut(l, e); }
    for (const e of events) {
      if (!isTransfer(e)) continue;
      const src = e.legs.find((l) => l.deltaCents < 0)!;
      const dst = e.legs.find((l) => l.deltaCents > 0)!;
      const from = accountById.get(src.accountId);
      const capped = !!from && !cashIds.has(from.id) && from.type !== 'credit_card';
      const requested = -src.deltaCents;
      if (capped) {
        const funded = Math.min(requested, Math.max(0, balances.get(src.accountId) ?? 0));
        if (funded < requested) {
          e.legs = [{ accountId: src.accountId, deltaCents: -funded }, { accountId: dst.accountId, deltaCents: funded }];
          e.unfundedCents = requested - funded;
          unfunded.push({ eventId: e.id, label: e.label, date, fromAccountId: src.accountId, toAccountId: dst.accountId, requestedCents: requested, fundedCents: funded });
        }
      }
      for (const l of e.legs) if (l.deltaCents < 0) { apply(l); noteOut(l, e); }
    }
    for (const [id, labels] of paidOut) {
      const a = accountById.get(id);
      const bal = balances.get(id) ?? 0;
      if (a && a.type !== 'credit_card' && bal < 0 && !shortfalls.some((x) => x.accountId === id)) shortfalls.push({ accountId: id, date, lowCents: bal, labels });
    }
    for (const e of events) for (const l of e.legs) if (l.deltaCents > 0) apply(l);

    const start = cash;
    let outflow = 0;
    let inflow = 0;
    for (const e of events) {
      e.cashDeltaCents = e.legs.reduce((s, l) => s + (cashIds.has(l.accountId) ? l.deltaCents : 0), 0);
      if (e.cashDeltaCents < 0) outflow += e.cashDeltaCents;
      else inflow += e.cashDeltaCents;
    }
    const low = start + outflow;
    cash = low + inflow;
    // Order inside a day: outflows first, then inflows (what the low point assumes).
    events.sort((a, b) => a.cashDeltaCents - b.cashDeltaCents);
    days.push({ date, startCashCents: start, lowCashCents: low, endCashCents: cash, events });
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
  };
}

export interface LowPoint {
  cents: Cents;
  date: ISODate;
  /** Outflows that happen on or before the low point (what pulls the balance down). */
  obligations: ForecastEvent[];
  /** Inflows counted before the low point. */
  incomeBefore: ForecastEvent[];
}

/** Lowest intraday cash level in [from, to] (inclusive). Ties → earliest date. */
export function lowestBetween(f: Forecast, from: ISODate, to: ISODate): LowPoint | null {
  let best: ForecastDay | null = null;
  for (const d of f.days) {
    if (d.date < from || d.date > to) continue;
    if (!best || d.lowCashCents < best.lowCashCents) best = d;
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
  return { cents: best.lowCashCents, date: lowDate, obligations, incomeBefore };
}

export function dayOf(f: Forecast, date: ISODate): ForecastDay | undefined {
  return f.days.find((d) => d.date === date);
}
