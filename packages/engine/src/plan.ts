import {
  addDays,
  diffDays,
  endOfMonth,
  formatShortDate,
  formatCents,
  TERMS,
  type Account,
  type Cents,
  type CurrencyCode,
  type ID,
  type ISODate,
  type OccurrenceException,
  type RecurringItem,
  type Transaction,
} from '@clarity/shared';
import { balanceSummary, type BalanceSummary } from './balances';
import { buildForecast, dayOf, lowestBetween, type AccountShortfall, type CashAdvance, type CoveredPayment, type Forecast, type ForecastEvent, type Hypothetical, type LowPoint } from './forecast';
import { similarity } from './text';
import { expandOccurrences, type Occurrence } from './occurrences';

/** Everything the engine needs. Apps build this from WorkspaceData + "today". */
export interface EngineInput {
  today: ISODate;
  accounts: readonly Account[];
  transactions: readonly Transaction[];
  recurring: readonly RecurringItem[];
  exceptions: readonly OccurrenceException[];
  baseCurrency: CurrencyCode;
  minReserveCents: Cents;
}

export interface ExplainLine {
  kind: 'start' | 'in' | 'out' | 'excluded' | 'reserve' | 'result' | 'info';
  label: string;
  cents?: Cents;
  date?: ISODate;
  note?: string;
  /** Phase 5A (daily ledger): the running balance after this line, in the order the forecast applies it. */
  balanceAfterCents?: Cents;
}

export interface Explanation {
  title: string;
  resultCents: Cents | null;
  summary: string;
  lines: ExplainLine[];
  assumptions: string[];
  /** Phase 5A: set when the amounts are in another currency than the base currency (a ledger for that account). */
  currency?: CurrencyCode;
}

export interface Warning {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  detail: string;
  /** The account the warning is about, when there is one (for grouping). */
  accountId?: ID;
  /**
   * Every dated amount behind the warning (Phase 4A.4.2). The full warning list shows all of them; the short
   * `detail` may summarise ("4 more"), but nothing is dropped here. `currency` is the account's own currency, set only when it differs from the base currency (4A.4.4).
   */
  items?: { date: ISODate; label: string; cents: Cents; currency?: CurrencyCode }[];
}

const SEVERITY_ORDER: Record<Warning['severity'], number> = { critical: 0, warning: 1, info: 2 };

export interface IncomeRef {
  date: ISODate;
  name: string;
  amountCents: Cents;
  status: Occurrence['status'];
}

export interface SafeToSpend {
  cents: Cents;
  /** > 0 when Safe to Spend is negative (shown as "Short by"). */
  shortfallCents: Cents;
  horizonEnd: ISODate;
  /**
   * Why the horizon ends where it does: 'next_month_end' = the end of next month;
   * 'next_income' = the first dependable paycheck after this month, when that is later.
   */
  horizonReason: 'next_month_end' | 'next_income';
  availableCashCents: Cents;
  reserveCents: Cents;
  lowPoint: LowPoint;
  /**
   * Everything counted after the low point through the horizon. By definition of the low point, these
   * never take the balance below it, so they don't lower Safe to Spend. Listed so the explanation is complete.
   */
  afterLow: { events: ForecastEvent[]; inCents: Cents; outCents: Cents; note: string | null };
  excludedIncome: ForecastEvent[];
  explanation: Explanation;
  /** At least one fixed-amount paycheck is counted before the horizon (Phase 4A.2 disclosure). */
  dependableIncome: boolean;
  /** First scheduled payment after the horizon (looked up to 62 days ahead): not counted, shown so it isn't a surprise. */
  nextAfterHorizon: { label: string; date: ISODate; cents: Cents; estimated: boolean } | null;
  /** One line for the Safe to Spend card: the end date and the paycheck assumption (both apps show it verbatim). */
  caption: string;
  /** "Next after Dec 31: Rent $1,400.00 on Jan 1 — not included." or null. */
  nextAfterNote: string | null;
  /** Through the horizon (Phase 4A.4): spendable accounts below zero, payments savings can't cover, cash advances. */
  accountShortfalls: AccountShortfall[];
  coveredPayments: CoveredPayment[];
  cashAdvances: CashAdvance[];
  /** Scheduled items with no amount through the horizon: not counted (the forecast can't know them). */
  unknownAmounts: ForecastEvent[];
  /** Phase 4A.5: what each base-currency card is projected to still owe at the horizon (set aside). */
  cardsOwedAtHorizon: { accountId: ID; cents: Cents }[];
  /** Phase 4A.5: cards whose balance can't be included reliably (named in warnings and affordability answers). */
  unreliableCards: { accountId: ID; name: string; reason: string }[];
  /** Phase 4A.5.2: each card's debt today, split into covered by a scheduled payment and owed now. */
  cardDebtToday: CardReserve[];
}

export const ASSUMPTIONS_BASE = [
  'Uses only balances and transactions you recorded or imported. Nothing is pulled from a bank.',
  'On any day, money going out is applied before money coming in (so a bill due on payday is covered by the balance you already have).',
  'Unpaid bills that are past due are treated as still owed today.',
];

/** Look this far past month-end for the next paycheck when choosing the Safe to Spend horizon. */
export const INCOME_LOOKAHEAD_DAYS = 62;

/**
 * Safe to Spend horizon (docs/calculation-rules.md): the LATER of
 *  - the end of next month (so every bill next month counts, including one on the 1st), and
 *  - the first dependable (fixed-amount) paycheck after this month ends (so a long gap before the
 *    next paycheck is covered in full).
 * Before Phase 4A the horizon was the later of this month-end and the first paycheck on/after today,
 * which dropped a bill due just after month-end whenever a paycheck fell earlier in the month.
 */
function horizonFor(input: EngineInput): { end: ISODate; reason: 'next_month_end' | 'next_income'; next: IncomeRef | null } {
  const eom = endOfMonth(input.today);
  const nextMonthEnd = endOfMonth(addDays(eom, 1));
  const occ = expandOccurrences(input.recurring, input.exceptions, input.transactions, {
    from: input.today,
    to: addDays(eom, INCOME_LOOKAHEAD_DAYS),
    today: input.today,
  });
  const next = nextIncome(occ, input.today, false);
  const firstAfterMonth = nextIncome(occ, addDays(eom, 1), false);
  if (firstAfterMonth && firstAfterMonth.date > nextMonthEnd) return { end: firstAfterMonth.date, reason: 'next_income', next };
  return { end: nextMonthEnd, reason: 'next_month_end', next };
}

/**
 * Last day of the Planning timeline: at least 45 days, and never shorter than the Safe to Spend horizon,
 * so every item Safe to Spend counts can be found in Planning (Phase 4A).
 */
export function planningWindowEnd(input: EngineInput): ISODate {
  const h = horizonFor(input).end;
  const d45 = addDays(input.today, 45);
  return h > d45 ? h : d45;
}

/** Next income occurrence on/after today. countEstimated=false → only fixed (known) amounts. */
export function nextIncome(occurrences: readonly Occurrence[], today: ISODate, countEstimated: boolean): IncomeRef | null {
  for (const o of occurrences) {
    if (o.kind !== 'income' || o.date < today) continue;
    if (o.status === 'expected' || (countEstimated && o.status === 'estimated')) {
      return { date: o.date, name: o.name, amountCents: o.amountCents, status: o.status };
    }
  }
  return null;
}

function forecastTo(input: EngineInput, horizonEnd: ISODate, includeEstimatedIncome: boolean, hypotheticals?: readonly Hypothetical[]): Forecast {
  return buildForecast({
    today: input.today,
    horizonEnd,
    accounts: input.accounts,
    transactions: input.transactions,
    recurring: input.recurring,
    exceptions: input.exceptions,
    baseCurrency: input.baseCurrency,
    includeEstimatedIncome,
    ...(hypotheticals ? { hypotheticals } : {}),
  });
}

/** Phase 5A: the notes on an event that explain an amount different from the scheduled one (shared with the daily ledger). */
export function eventDetailNotes(e: ForecastEvent, cur: CurrencyCode): string[] {
  const short = e.unfundedCents ? `only ${formatCents(e.cashDeltaCents, cur)} is available to move; ${formatCents(e.unfundedCents, cur)} not counted` : undefined;
  const cover = e.source === 'archived_balance' ? (e.label.includes('(archived)') ? 'an archived account\'s negative balance; still owed' : 'a negative balance on an account not counted as spendable; still owed') : e.coverCents ? `the account it's paid from is short; ${formatCents(e.coverCents, cur)} has to come from your spendable accounts` : undefined;
  const repaid = e.repaidCents ? `${formatCents(e.repaidCents, cur)} of it repays an overdrawn balance already counted, so it isn't counted again` : undefined;
  return [short, cover, repaid].filter((x): x is string => !!x);
}

function eventLine(e: ForecastEvent, cur: CurrencyCode): ExplainLine {
  const base = e.source === 'overdue' ? 'overdue, counted today' : e.estimated ? 'estimated' : e.source === 'hypothetical' ? 'hypothetical' : e.source === 'scheduled_tx' ? 'planned' : undefined;
  const status = [base, ...eventDetailNotes(e, cur)].filter(Boolean).join('; ') || undefined;
  return {
    kind: e.cashDeltaCents < 0 ? 'out' : 'in',
    label: e.label,
    cents: e.cashDeltaCents,
    date: e.date,
    ...(status ? { note: status } : {}),
  };
}

export function excludedLine(e: ForecastEvent): ExplainLine {
  const note =
    e.excluded === 'unknown_amount'
      ? 'amount unknown, not counted'
      : e.excluded === 'estimated_income'
        ? 'estimated income, not counted in Safe to Spend'
        : e.excluded === 'pending_credit'
          ? 'pending, not counted until it clears'
          : 'past payday not recorded, not counted';
  return { kind: 'excluded', label: e.label, date: e.date, note, ...(e.occurrence?.amountCents ? { cents: e.occurrence.amountCents } : {}) };
}

/**
 * Phase 4A.5.6: the first lines of every explanation. The recorded balance, then each pending credit held back
 * (it stays in the recorded balance but isn't available to spend until it clears), so the lines still add up.
 * Pending credits on non-spendable accounts are listed for information (they can't fund transfers or bills).
 */
export function startLines(f: Forecast, accounts: readonly Account[], cur: CurrencyCode): ExplainLine[] {
  const name = (id: ID) => accounts.find((a) => a.id === id)?.name ?? 'Account';
  return [
    { kind: 'start', label: TERMS.recordedBalance, cents: f.recordedStartCashCents },
    ...f.pendingCredits.map((p): ExplainLine => p.spendable
      ? { kind: 'out', label: `${name(p.accountId)}: pending credit not yet available`, cents: -p.cents, note: "pending; it's in your recorded balance but not counted until it clears" }
      : { kind: 'info', label: `${name(p.accountId)}: ${formatCents(p.cents, cur)} pending credit`, note: "pending; not counted (it can't fund transfers or bills) until it clears" }),
    // Phase 4A.5.15: a card payment on its way is counted once: from the account it comes from, not again as card debt
    ...f.cardPaymentsInTransit.map((p): ExplainLine => ({
      kind: 'info', label: `${name(p.cardId)}: ${formatCents(p.cents, cur)} payment${p.fromAccountId ? ` from ${name(p.fromAccountId)}` : ''} not yet posted by the card issuer`,
      // Phase 4A.5.17: what to do if it fails (the workflow the import review offers)
      note: `already counted from ${p.fromAccountId ? name(p.fromAccountId) : 'the paying account'}, so the ${formatCents(p.cents, cur)} of card debt it pays isn't counted again. If it's returned or rejected: when the returned money shows on a statement, choose "It's the return of this card payment" in the import review (not a separate deposit), and the card debt is counted in full again; if the money never left ${p.fromAccountId ? name(p.fromAccountId) : 'the paying account'}, delete the payment`,
    })),
  ];
}

/** One card's debt at a low point (Phase 4A.5.2, Policy B). */
export interface CardReserve {
  accountId: ID;
  owedCents: Cents;
  /** Not covered by any later scheduled payment or refund: counted as owed now. */
  uncoveredCents: Cents;
  /** Planned cash-advance money beyond the uncovered part, still borrowed until repaid. */
  advanceCents: Cents;
  /** All planned cash-advance money still owed on this card at the low point. */
  advanceTotalCents: Cents;
  /** Covered by a later scheduled payment (or refund); counted on that payment's date. */
  coveredCents: Cents;
  /** Date of the next payment the user scheduled for this card, if any (planned, not a statement due date). */
  paymentDate: ISODate | null;
  /** Pending refunds/credits not counted until they post (Phase 4A.5.4). */
  pendingCreditCents: Cents;
  /** The next refund/cashback/credit expected after the low point within the forecast: not counted until it arrives. */
  nextCredit: { date: ISODate; cents: Cents } | null;
}

/** "Why this number?" lines for card debt at the low point (Phase 4A.5.2): card, amount, owed now or covered, date. */
function cardLines(low: LowPoint, input: EngineInput, horizonEnd: ISODate, nextAfterEnd: (id: ID) => ISODate | null): ExplainLine[] {
  const cur = input.baseCurrency;
  const name = (id: ID) => input.accounts.find((a) => a.id === id)?.name ?? 'Card';
  const lines: ExplainLine[] = [];
  for (const r of low.cardReserves ?? []) {
    // Payments go to purchases first, so an uncovered amount is the planned cash advance first (Phase 4A.4 rule).
    const advance = Math.min(r.advanceTotalCents, r.uncoveredCents) + r.advanceCents;
    const ownDebt = r.uncoveredCents - Math.min(r.advanceTotalCents, r.uncoveredCents);
    if (advance > 0) lines.push({ kind: 'out', label: 'Cash advance still owed', cents: -advance, note: `borrowed from ${name(r.accountId)}; not counted as your money until it's paid back` });
    const plannedPayment = (date: ISODate | null) =>
      !date ? 'a payment you planned'
        : date > horizonEnd ? `your planned payment on ${formatShortDate(date)}, which is after the forecast ends, so that part is set aside on ${formatShortDate(horizonEnd)}`
          : `your planned payment on ${formatShortDate(date)}`;
    if (ownDebt > 0) {
      lines.push({ kind: 'out', label: `${name(r.accountId)}: owed now`, cents: -ownDebt, note: r.coveredCents > 0 ? `not covered by a payment you've scheduled; the other ${formatCents(r.coveredCents, cur)} is covered by ${plannedPayment(r.paymentDate)}` : 'no payment is scheduled for it, so it is counted as owed now' });
    }
    if (r.coveredCents > 0 && r.uncoveredCents === 0) {
      lines.push({ kind: 'info', label: `${name(r.accountId)}: ${formatCents(r.coveredCents, cur)} owed`, note: r.paymentDate && r.paymentDate > horizonEnd
        ? `covered by the payment you planned for ${formatShortDate(r.paymentDate)} (a date you entered, not a statement due date); that is after the forecast ends, so it is set aside on ${formatShortDate(horizonEnd)}`
        : `covered by the payment you planned for ${r.paymentDate ? formatShortDate(r.paymentDate) : '—'} (a date you entered, not a statement due date); counted on that day` });
    }
    if (r.pendingCreditCents > 0) {
      lines.push({ kind: 'info', label: `${name(r.accountId)}: ${formatCents(r.pendingCreditCents, cur)} pending refund, deposit or incoming transfer`, note: "not counted until it posts; it is included in what's owed above" });
    }
    if (r.nextCredit) {
      lines.push({ kind: 'info', label: `${name(r.accountId)}: ${formatCents(r.nextCredit.cents, cur)} refund or credit expected ${formatShortDate(r.nextCredit.date)}`, note: "not a payment; it lowers what's owed only from the day it arrives" });
    }
  }
  for (const x of low.cardsOwed ?? []) {
    const later = nextAfterEnd(x.accountId);
    lines.push({ kind: 'out', label: `${name(x.accountId)} still owed on ${formatShortDate(horizonEnd)}`, cents: -x.cents, note: later ? `your planned payment on ${formatShortDate(later)} is after the forecast ends, so it is set aside here` : 'no payment is scheduled for it; set aside' });
  }
  return lines;
}

/** Base-currency cards projected to owe money at the end of forecast `f` (Phase 4A.5). */
function projectedCardDebt(input: EngineInput, f: Forecast): { accountId: ID; cents: Cents }[] {
  return input.accounts
    .filter((a) => a.type === 'credit_card' && a.currency === input.baseCurrency)
    .map((a) => ({ accountId: a.id, cents: Math.max(0, -((f.endBalances[a.id] ?? 0) - (f.pendingCardCredits[a.id] ?? 0))) }))
    .filter((x) => x.cents > 0);
}

/**
 * Cards whose balance can't be included reliably (Phase 4A.5): a card in another currency that owes money or has
 * scheduled activity, or a base-currency card with scheduled activity of unknown amount.
 */
function unreliableCards(input: EngineInput, f: Forecast, horizonEnd: ISODate): { accountId: ID; name: string; reason: string }[] {
  const out: { accountId: ID; name: string; reason: string }[] = [];
  for (const a of input.accounts) {
    if (a.type !== 'credit_card') continue;
    const touches = (id?: ID) => id === a.id;
    if (a.currency !== input.baseCurrency) {
      const owes = (f.endBalances[a.id] ?? 0) < 0;
      const active = f.occurrences.some((o) => o.date <= horizonEnd && (touches(o.accountId) || touches(o.toAccountId)));
      if (owes || active) out.push({ accountId: a.id, name: a.name, reason: `it's in ${a.currency}, and Clarity doesn't convert currencies` });
      continue;
    }
    if (f.excludedEvents.some((e) => e.excluded === 'unknown_amount' && e.date <= horizonEnd && (touches(e.occurrence?.accountId) || touches(e.occurrence?.toAccountId)))) {
      out.push({ accountId: a.id, name: a.name, reason: 'something scheduled on it has no amount' });
    }
  }
  return out;
}

/** Safe to Spend = lowest projected available cash between today and the horizon − minimum reserve. */
export function computeSafeToSpend(input: EngineInput, hypotheticals?: readonly Hypothetical[]): SafeToSpend {
  const h = horizonFor(input);
  const f = forecastTo(input, h.end, false, hypotheticals);
  if (!f.days.length) throw new Error('Forecast produced no days');
  // Phase 4A.5.2 (Policy B): card debt that no later payment or refund covers is owed now. Payments pay the oldest
  // debt first, so on each day the debt a card already owes is covered by the PAYMENTS still to come (later that day
  // after the low point, later in the forecast, or within the lookahead after it); the rest is reserved that day.
  // Phase 4A.5.4: refunds, cashback and other credits are not payments: they lower the debt only on the day they
  // arrive (already in the day's balance), and pending ones are added back until they post.
  // A planned cash advance stays borrowed until repaid (Phase 4A.4): reserve max(uncovered, advance) per card.
  const ext = forecastTo(input, addDays(h.end, INCOME_LOOKAHEAD_DAYS), false, hypotheticals);
  const cardIds = input.accounts.filter((a) => a.type === 'credit_card' && a.currency === input.baseCurrency).map((a) => a.id);
  const creditsFrom = new Map<ID, Cents[]>(); // credits on ext days index > i
  for (const id of cardIds) {
    const after: Cents[] = new Array(ext.days.length).fill(0);
    let acc = 0;
    for (let i = ext.days.length - 1; i >= 0; i--) {
      after[i] = acc;
      acc += ext.days[i]!.cards[id]?.paymentsCents ?? 0;
    }
    creditsFrom.set(id, after);
  }
  const nextCreditDate = (id: ID, i: number): ISODate | null => {
    if ((ext.days[i]?.cards[id]?.paymentsAfterLowCents ?? 0) > 0) return ext.days[i]!.date;
    for (let j = i + 1; j < ext.days.length; j++) if ((ext.days[j]!.cards[id]?.paymentsCents ?? 0) > 0) return ext.days[j]!.date;
    return null;
  };
  const reserveOn = (i: number): CardReserve[] =>
    cardIds.flatMap((id) => {
      const c = f.days[i]!.cards[id];
      if (!c || (c.owedAtLowCents === 0 && c.advanceAtLowCents === 0)) return [];
      const covering = c.paymentsAfterLowCents + (creditsFrom.get(id)![i] ?? 0);
      const uncovered = Math.max(0, c.owedAtLowCents - covering);
      const advanceOnly = Math.max(0, c.advanceAtLowCents - uncovered);
      const nextCredit = (() => {
        for (let j = i; j < f.days.length; j++) {
          const cr = f.days[j]!.cards[id]?.otherCreditsCents ?? 0;
          if (cr > 0) return { date: f.days[j]!.date, cents: cr };
        }
        return null;
      })();
      return [{ accountId: id, owedCents: c.owedAtLowCents, uncoveredCents: uncovered, advanceCents: advanceOnly, advanceTotalCents: c.advanceAtLowCents, coveredCents: c.owedAtLowCents - uncovered, paymentDate: nextCreditDate(id, i), pendingCreditCents: f.pendingCardCredits[id] ?? 0, nextCredit }];
    });
  let best = 0;
  const own = (i: number) => f.days[i]!.lowCashCents - reserveOn(i).reduce((s, r) => s + r.uncoveredCents + r.advanceCents, 0);
  for (let i = 1; i < f.days.length; i++) if (own(i) < own(best)) best = i;
  const bestDate = f.days[best]!.date;
  const before = f.days.filter((d) => d.date <= bestDate);
  const reserves = reserveOn(best);
  const dayLow: LowPoint = {
    cents: own(best),
    date: bestDate,
    obligations: before.flatMap((d) => d.events.filter((e) => e.cashDeltaCents < 0)),
    incomeBefore: before.filter((d) => d.date < bestDate).flatMap((d) => d.events.filter((e) => e.cashDeltaCents > 0)),
    advanceOwedCents: reserves.reduce((s, r) => s + r.advanceCents, 0),
    cardReserves: reserves,
  };
  // Phase 4A.5 (owner decision): card debt is counted even without a scheduled payment. At the end of the forecast,
  // what every base-currency card is projected to still owe (purchases, cash advances, refunds and payments all on
  // their dates; archived cards included) is set aside from the spendable cash. Scheduled payments already reduced
  // both the cash and the card balance, so nothing is counted twice; a card in credit counts as owing nothing.
  const cardsOwed = projectedCardDebt(input, f);
  const endIdx = f.days.length - 1;
  const nextAfterEnd = (id: ID): ISODate | null => {
    for (let j = endIdx + 1; j < ext.days.length; j++) if ((ext.days[j]!.cards[id]?.paymentsCents ?? 0) > 0) return ext.days[j]!.date;
    return null;
  };
  const lastDay = f.days[f.days.length - 1]!;
  const endOwn = lastDay.endCashCents - cardsOwed.reduce((s, x) => s + x.cents, 0);
  const allEvents = f.days.flatMap((d) => d.events);
  const low: LowPoint = cardsOwed.length && endOwn < dayLow.cents
    ? { cents: endOwn, date: h.end, obligations: allEvents.filter((e) => e.cashDeltaCents < 0), incomeBefore: allEvents.filter((e) => e.cashDeltaCents > 0), advanceOwedCents: 0, cardsOwed }
    : dayLow;
  const reserve = input.minReserveCents;
  const cents = low.cents - reserve;
  const excludedIncome = f.excludedEvents.filter((e) => e.date <= low.date || e.excluded === 'overdue_income');
  const cur = input.baseCurrency;
  const afterEvents = f.days.filter((d) => d.date > low.date && d.date <= h.end).flatMap((d) => d.events.filter((e) => e.cashDeltaCents !== 0));
  const afterIn = afterEvents.reduce((a, e) => a + Math.max(0, e.cashDeltaCents), 0);
  const afterOut = afterEvents.reduce((a, e) => a + Math.max(0, -e.cashDeltaCents), 0);
  const outs = afterEvents.filter((e) => e.cashDeltaCents < 0).map((e) => e.label);
  const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
  const afterNote =
    afterOut > 0
      ? `${list(outs)} (${formatCents(afterOut, cur)}) ${outs.length === 1 ? 'comes' : 'come'} after ${formatShortDate(low.date)}${afterIn > 0 ? `, once ${formatCents(afterIn, cur)} has come in` : ''}. Your balance stays at or above the ${formatShortDate(low.date)} low through ${formatShortDate(h.end)}, so ${outs.length === 1 ? "it doesn't" : "they don't"} lower Safe to Spend.`
      : null;

  const lines: ExplainLine[] = [
    ...startLines(f, input.accounts, cur),
    ...low.incomeBefore.map((e) => eventLine(e, cur)),
    ...low.obligations.map((e) => eventLine(e, cur)),
    ...cardLines(low, input, h.end, nextAfterEnd),
    { kind: 'info', label: `Lowest point: ${formatShortDate(low.date)}`, cents: low.cents },
    ...afterEvents.map((e): ExplainLine => ({ ...eventLine(e, cur), note: [eventLine(e, cur).note, `after the lowest point, doesn't lower it`].filter(Boolean).join('; ') })),
    { kind: 'reserve', label: 'Minimum cash reserve', cents: -reserve },
    { kind: 'result', label: cents >= 0 ? 'Safe to Spend' : 'Short by', cents },
    ...excludedIncome.map(excludedLine),
  ];
  const dependableIncome = f.days.some((d) => d.events.some((e) => e.occurrence?.kind === 'income' && e.cashDeltaCents > 0 && !e.estimated));
  const nextAfter = (() => {
    const later = forecastTo(input, addDays(h.end, INCOME_LOOKAHEAD_DAYS), false);
    for (const d of later.days) {
      if (d.date <= h.end) continue;
      const e = d.events.find((x) => x.cashDeltaCents < 0);
      if (e) return { label: e.label, date: e.date, cents: e.cashDeltaCents, estimated: e.estimated };
    }
    return null;
  })();
  const H = formatShortDate(h.end);
  const caption = dependableIncome
    ? `Covers what's scheduled through ${H}, if your paychecks arrive as scheduled.`
    : `No regular income is scheduled, so this only covers bills through ${H}.`;
  const nextAfterNote = nextAfter ? `Next after ${H}: ${nextAfter.label} ${nextAfter.estimated ? '≈' : ''}${formatCents(-nextAfter.cents, cur)} on ${formatShortDate(nextAfter.date)} — not included.` : null;
  const horizonText = h.reason === 'next_income' ? `your first known paycheck after this month (${formatShortDate(h.end)})` : `the end of next month (${formatShortDate(h.end)})`;
  const summary =
    cents >= 0
      ? `You can spend up to ${formatCents(cents, cur)} today and still cover everything scheduled through ${horizonText}, keeping your ${formatCents(reserve, cur)} reserve. Your balance is lowest on ${formatShortDate(low.date)}${afterOut > 0 ? '; everything after that is covered' : ''}.`
      : `Your scheduled obligations through ${horizonText} are ${formatCents(-cents, cur)} more than your cash and reserve allow. Your balance is lowest on ${formatShortDate(low.date)}.`;

  return {
    cents,
    shortfallCents: cents < 0 ? -cents : 0,
    horizonEnd: h.end,
    horizonReason: h.reason,
    availableCashCents: f.startCashCents,
    reserveCents: reserve,
    lowPoint: low,
    afterLow: { events: afterEvents, inCents: afterIn, outCents: afterOut, note: afterNote },
    excludedIncome,
    explanation: {
      title: 'Safe to Spend',
      resultCents: cents,
      summary,
      lines,
      assumptions: [
        ...ASSUMPTIONS_BASE,
        'Only income with a fixed amount is counted. Estimated or unknown income is listed but not counted.',
        "Credit card debt that no payment you've scheduled covers is counted as owed now. Debt a scheduled payment covers is counted on that payment's date (a date you entered, not a statement due date); a payment more than 62 days after the forecast ends doesn't count. Refunds and other card credits are not payments: they lower what's owed only from the day they arrive, and pending ones only once they post.",
        'Combines your spendable accounts. It assumes you can move money between them; a bill paid from an account that would run short is flagged.',
        'A transfer from savings counts only up to what that account is projected to hold. A bill paid from savings that savings can\'t cover is counted against your spendable accounts.',
        ...(f.cashAdvances.some((a) => a.date <= h.end)
          ? ["Money borrowed from a credit card (a cash advance) isn't counted as yours until a scheduled card payment pays it back. Interest, fees and your card limit are not known, so the advance may cost more or may not be available."]
          : []),
        `Covers everything scheduled from today through ${H}. Anything scheduled after ${H} is not included.${nextAfterNote ? ` ${nextAfterNote}` : ''}`,
      ],
    },
    dependableIncome,
    nextAfterHorizon: nextAfter,
    caption,
    nextAfterNote,
    accountShortfalls: f.accountShortfalls.filter((x) => x.date <= h.end),
    coveredPayments: f.coveredPayments.filter((x) => x.date <= h.end),
    cashAdvances: f.cashAdvances.filter((x) => x.date <= h.end),
    unknownAmounts: f.excludedEvents.filter((e) => e.excluded === 'unknown_amount' && e.date <= h.end),
    cardsOwedAtHorizon: cardsOwed,
    cardDebtToday: reserveOn(0),
    unreliableCards: unreliableCards(input, f, h.end),
  };
}

export interface AffordQuery {
  amountCents: Cents; // positive purchase amount
  accountId: ID;
  date: ISODate;
  label?: string;
}

export interface AffordResult {
  /**
   * yes / tight / no: the combined forecast with this purchase.
   * move_first: the total covers it, but the account it's paid from doesn't; money has to be moved in first.
   * unverified: the purchase date is after the forecast ends, so it was not checked at all.
   */
  verdict: 'yes' | 'tight' | 'no' | 'move_first' | 'unverified';
  /** Answer shown to the user; "Yes" is always qualified with the forecast end date. Never "Yes" for move_first/unverified. */
  headline: string;
  /** What the answer covers: end date, paycheck assumption, next payment after it. */
  scope: string;
  before: SafeToSpend;
  after: SafeToSpend;
  /** Positive when the purchase would leave you short. */
  shortfallCents: Cents;
  /** move_first: how much to move into which account, by when (covers every day it would be below zero). */
  requiredMove: { accountId: ID; cents: Cents; by: ISODate } | null;
  notes: string[];
}

/** "Can I afford this?" — runs the same Safe to Spend calculation with one hypothetical purchase. Never saves anything. */
export function canIAfford(input: EngineInput, q: AffordQuery): AffordResult {
  if (!Number.isSafeInteger(q.amountCents) || q.amountCents <= 0) throw new Error('Amount must be a positive number of cents');
  const cur = input.baseCurrency;
  const before = computeSafeToSpend(input);
  const H = formatShortDate(before.horizonEnd);
  const date = q.date < input.today ? input.today : q.date;
  const hyp: Hypothetical = { id: 'afford', accountId: q.accountId, date, amountCents: -q.amountCents, label: q.label?.trim() || 'This purchase' };
  const acct = input.accounts.find((a) => a.id === q.accountId);
  const name = acct?.name ?? 'that account';
  const scope = [
    before.dependableIncome
      ? `Checked against everything scheduled through ${H}, assuming your paychecks arrive as scheduled.`
      : `Checked against everything scheduled through ${H}. No regular income is scheduled, so nothing after that is covered.`,
    before.nextAfterNote,
  ].filter(Boolean).join(' ');
  const notes: string[] = [];
  const notCounted = before.unknownAmounts.map((e) => e.label);
  if (notCounted.length) notes.push(`Not counted because no amount is entered: ${[...new Set(notCounted)].join(', ')}. Add the amount for a complete answer.`);

  // Clarity never converts currencies (Phase 4A.4.2): a purchase from an account in another currency can't be checked.
  if (acct && acct.currency !== cur) {
    return {
      verdict: 'unverified',
      headline: `Can't check this: ${name} is in ${acct.currency}`,
      scope: `Safe to Spend is in ${cur}, and Clarity doesn't convert currencies, so a purchase from ${name} can't be checked against it.`,
      before,
      after: before,
      shortfallCents: 0,
      requiredMove: null,
      notes,
    };
  }
  // The forecast ends at the horizon: a later purchase can't be checked, so never answer "Yes".
  if (date > before.horizonEnd) {
    return {
      verdict: 'unverified',
      headline: `Can't check ${formatShortDate(date)} yet: the forecast ends ${H}`,
      scope: `Your forecast only covers what's scheduled through ${H}, so a purchase on ${formatShortDate(date)} can't be checked yet. Bills and income after ${H} aren't counted.${before.nextAfterNote ? ` ${before.nextAfterNote}` : ''}`,
      before,
      after: before,
      shortfallCents: 0,
      requiredMove: null,
      notes,
    };
  }

  const after = computeSafeToSpend(input, [hyp]);
  if (acct?.type === 'credit_card') {
    const paysCard = input.recurring.some(
      (r) => !r.paused && (r.kind === 'transfer' || r.kind === 'bill') && r.toAccountId === acct.id && r.amount.type === 'card_full_balance',
    );
    notes.push(
      paysCard
        ? 'Charged to your card. It reduces cash when your scheduled full-balance card payment happens.'
        : "Charged to your card. Unless a payment you've scheduled covers it, it's counted as owed from the day of the purchase.",
    );
  }

  // The account it's paid from, not just the combined total (Phase 4A.4).
  let requiredMove: AffordResult['requiredMove'] = null;
  const cover = after.coveredPayments.find((c) => c.eventId === 'hyp:afford');
  if (cover) {
    notes.push(`${name} is projected to have ${formatCents(cover.accountBalanceCents, cur)} on ${formatShortDate(date)}, so ${formatCents(cover.coveredCents, cur)} of this would have to come from your spendable accounts. That is counted above.`);
    requiredMove = { accountId: q.accountId, cents: cover.coveredCents, by: date };
  } else if (acct && acct.type !== 'credit_card') {
    const beforeLow = new Map(before.accountShortfalls.filter((x) => x.accountId === acct.id).map((x) => [x.date, x.lowCents]));
    const mine = after.accountShortfalls.filter((x) => x.accountId === acct.id && x.date >= date);
    const caused = mine.filter((x) => x.lowCents < (beforeLow.get(x.date) ?? 0));
    if (caused.length) {
      const deepest = Math.min(...mine.map((x) => x.lowCents));
      requiredMove = { accountId: acct.id, cents: -deepest, by: caused[0]!.date };
      notes.push(`${name} would go to ${formatCents(caused[0]!.lowCents, cur)} on ${formatShortDate(caused[0]!.date)}. You'd need to move ${formatCents(-deepest, cur)} into ${name} by ${formatShortDate(caused[0]!.date)} from your other spendable accounts.`);
    } else if (mine.length) {
      notes.push(`${name} is already projected to go to ${formatCents(mine[0]!.lowCents, cur)} on ${formatShortDate(mine[0]!.date)} without this purchase; see the warning on your dashboard.`);
    }
  }

  const newLow = after.lowPoint.cents;
  const combined: 'yes' | 'tight' | 'no' = newLow >= input.minReserveCents ? 'yes' : newLow >= 0 ? 'tight' : 'no';
  if (combined === 'tight') notes.push('You would dip into your minimum cash reserve.');
  const verdict: AffordResult['verdict'] = combined === 'no' ? 'no' : requiredMove ? 'move_first' : combined;
  const headline =
    verdict === 'yes' ? `Yes, through ${H}`
      : verdict === 'tight' ? `Tight — it dips into your reserve before ${H}`
        : verdict === 'move_first' ? `Only if you move ${formatCents(requiredMove!.cents, cur)} into ${name} by ${formatShortDate(requiredMove!.by)}`
          : 'Not without coming up short';
  // Phase 4A.5: never an unqualified answer when a card's balance couldn't be included.
  const unreliable = before.unreliableCards;
  if (unreliable.length) notes.push(`Not included because the balance can't be calculated: ${unreliable.map((u) => `${u.name} (${u.reason})`).join('; ')}.`);
  const qualified = unreliable.length && verdict !== 'no' ? `${headline} — not counting ${unreliable.map((u) => u.name).join(', ')}` : headline;
  return { verdict, headline: qualified, scope, before, after, shortfallCents: after.cents < 0 ? -after.cents : 0, requiredMove, notes };
}

export interface Projection {
  cents: Cents;
  date: ISODate;
  explanation: Explanation;
}

export interface Dashboard {
  today: ISODate;
  balances: BalanceSummary;
  monthEnd: Projection;
  endOfDay: Projection;
  safeToSpend: SafeToSpend;
  lowestThroughMonthEnd: LowPoint & { explanation: Explanation };
  lowestBeforeNextIncome: (LowPoint & { explanation: Explanation; nextIncome: IncomeRef }) | null;
  nextIncome: IncomeRef | null;
  /** Occurrences + planned transactions from today through +14 days, plus anything overdue. */
  upcoming: UpcomingItem[];
  /** Last date covered by `upcoming` (never before month-end). */
  upcomingUntil: ISODate;
  /**
   * Items after `upcomingUntil` through the Safe to Spend horizon (`upcomingLaterUntil`): they are counted in
   * Safe to Spend, so the dashboard must let the user find them (Phase 4A). Sorted by date.
   */
  upcomingLater: UpcomingItem[];
  upcomingLaterUntil: ISODate;
  warnings: Warning[];
  recordedBalanceExplanation: Explanation;
  /** Inclusive forecast (estimated income counted) through `upcomingUntil`, for the month chart: the same days as Upcoming. */
  forecast: Forecast;
}

export interface UpcomingItem {
  id: string;
  date: ISODate;
  label: string;
  /** Signed amount. Normally the effect on cash; for items paid from a card it is the charge to the card. */
  cents: Cents;
  /** False when the item does not move cash (for example a subscription charged to a credit card). */
  affectsCash: boolean;
  /** Set when the amount is in another currency than the base currency (an account in another currency; Phase 4A.4.4). */
  currency?: CurrencyCode;
  status: Occurrence['status'] | 'scheduled_tx';
  occurrence?: Occurrence;
  txId?: ID;
  isIncome: boolean;
}

function projectionExplanation(f: Forecast, upTo: ISODate, title: string, cur: CurrencyCode, accounts: readonly Account[]): Explanation {
  const lines: ExplainLine[] = [...startLines(f, accounts, cur)];
  let estimatedIncome = 0;
  for (const d of f.days) {
    if (d.date > upTo) break;
    for (const e of d.events) {
      if (e.cashDeltaCents === 0) continue;
      lines.push(eventLine(e, cur));
      if (e.estimated && e.cashDeltaCents > 0) estimatedIncome += e.cashDeltaCents;
    }
  }
  const day = dayOf(f, upTo);
  const result = day ? day.endCashCents : f.startCashCents;
  lines.push({ kind: 'result', label: title, cents: result });
  for (const e of f.excludedEvents) if (e.date <= upTo) lines.push(excludedLine(e));
  const assumptions = [...ASSUMPTIONS_BASE];
  if (estimatedIncome > 0) assumptions.push(`Includes ${formatCents(estimatedIncome, cur)} of estimated income, which may differ.`);
  return {
    title,
    resultCents: result,
    summary: `Based on your recorded balance, expected income, upcoming bills, and planned expenses through ${formatShortDate(upTo)}.`,
    lines,
    assumptions,
  };
}

function lowExplanation(low: LowPoint, f: Forecast, title: string, cur: CurrencyCode, next: IncomeRef | null, accounts: readonly Account[]): Explanation {
  const lines: ExplainLine[] = [
    ...startLines(f, accounts, cur),
    ...low.incomeBefore.map((e) => eventLine(e, cur)),
    ...low.obligations.map((e) => eventLine(e, cur)),
    { kind: 'result', label: `Lowest on ${formatShortDate(low.date)}`, cents: low.cents },
  ];
  let summary = `Your cash is lowest on ${formatShortDate(low.date)}`;
  if (low.obligations.length) summary += `, after ${low.obligations.map((o) => o.label).slice(0, 3).join(', ')}${low.obligations.length > 3 ? ' and others' : ''}`;
  if (next) summary += next.date > low.date ? `, before your next paycheck on ${formatShortDate(next.date)}.` : `. Your paycheck on ${formatShortDate(next.date)} arrives before then.`;
  else summary += '. No upcoming income with a known amount is scheduled.';
  return { title, resultCents: low.cents, summary, lines, assumptions: [...ASSUMPTIONS_BASE, 'Only income with a fixed amount is counted.'] };
}

export function buildDashboard(input: EngineInput): Dashboard {
  const cur = input.baseCurrency;
  const eom = endOfMonth(input.today);
  const sts = computeSafeToSpend(input);
  const horizon = sts.horizonEnd > eom ? sts.horizonEnd : eom;
  const conservative = forecastTo(input, horizon, false);
  const inclusive = forecastTo(input, horizon, true);
  const balances = balanceSummary(input.accounts, input.transactions, input.today, cur);
  const next = horizonFor(input).next;

  const monthEndExpl = projectionExplanation(inclusive, eom, 'Projected month-end balance', cur, input.accounts);
  const eodExpl = projectionExplanation(inclusive, input.today, 'Projected end of today', cur, input.accounts);

  const lowMonth = lowestBetween(conservative, input.today, eom)!;
  const lowBefore = next ? lowestBetween(conservative, input.today, next.date) : null;

  // Upcoming: overdue + at least the next 14 days, and always through month-end, so the items listed on
  // the dashboard add up to the projected month-end balance shown above them.
  const until = (() => {
    const d = inclusive.days[Math.min(14, inclusive.days.length - 1)];
    const twoWeeks = d ? d.date : input.today;
    return twoWeeks > eom ? twoWeeks : eom;
  })();
  const ccyOf = (id: ID): CurrencyCode => input.accounts.find((a) => a.id === id)?.currency ?? cur;
  /** Upcoming items between two dates (overdue ones only in the first list). */
  const itemsBetween = (from: ISODate, to: ISODate, withOverdue: boolean): UpcomingItem[] => {
    const out: UpcomingItem[] = [];
    for (const o of inclusive.occurrences) {
      if (o.status === 'confirmed') continue;
      if (o.status === 'overdue' ? !withOverdue : o.date < from || o.date > to) continue;
      const ev = inclusive.days.flatMap((d) => d.events).find((e) => e.occurrence?.key === o.key);
      const sign = o.kind === 'income' ? 1 : -1;
      out.push({
        id: `occ:${o.key}`,
        date: o.date,
        label: o.name,
        cents: ev ? ev.cashDeltaCents || (ev.legs.find((l) => l.accountId === o.accountId)?.deltaCents ?? 0) : sign * o.amountCents,
        affectsCash: !ev || ev.cashDeltaCents !== 0 || ev.legs.length === 0,
        status: o.status,
        occurrence: ev?.occurrence ?? o,
        isIncome: o.kind === 'income',
        ...(ccyOf(o.accountId) !== cur ? { currency: ccyOf(o.accountId) } : {}),
      });
    }
    for (const d of inclusive.days) {
      if (d.date < from) continue;
      if (d.date > to) break;
      for (const e of d.events) {
        if (e.source !== 'scheduled_tx' || !e.txId) continue;
        const c = e.cashDeltaCents ? cur : ccyOf(e.legs[0]!.accountId);
        out.push({ id: e.id, date: e.date, label: e.label, cents: e.cashDeltaCents || e.legs[0]!.deltaCents, affectsCash: e.cashDeltaCents !== 0, status: 'scheduled_tx', txId: e.txId, isIncome: e.legs[0]!.deltaCents > 0, ...(c !== cur ? { currency: c } : {}) });
      }
    }
    return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  };
  const upcoming = itemsBetween(input.today, until, true);
  const upcomingLater = sts.horizonEnd > until ? itemsBetween(addDays(until, 1), sts.horizonEnd, false) : [];

  // Warnings
  const warnings: Warning[] = [];
  if (sts.cents < 0) {
    warnings.push({
      id: 'shortfall',
      severity: 'critical',
      title: `Short by ${formatCents(sts.shortfallCents, cur)}`,
      detail: `Scheduled obligations before ${formatShortDate(sts.lowPoint.date)} exceed your cash and minimum reserve.`,
    });
  }
  if (lowMonth.cents < 0) {
    warnings.push({
      id: 'below-zero',
      severity: 'critical',
      title: `Cash projected below zero on ${formatShortDate(lowMonth.date)}`,
      detail: `Lowest projected balance is ${formatCents(lowMonth.cents, cur)}.`,
    });
  }
  for (const o of conservative.occurrences) {
    if (o.status !== 'overdue') continue;
    warnings.push(
      o.kind === 'income'
        ? { id: `overdue:${o.key}`, severity: 'info', title: `${o.name} not recorded`, detail: `Expected ${formatShortDate(o.date)}. It isn't counted until you record it.` }
        : { id: `overdue:${o.key}`, severity: 'warning', title: `${o.name} is overdue`, detail: `Due ${formatShortDate(o.date)} and not recorded as paid. It's counted as still owed today.` },
    );
  }
  for (const e of conservative.excludedEvents) {
    if (e.excluded === 'unknown_amount' && e.date <= horizon) {
      warnings.push({ id: `unknown:${e.id}`, severity: 'info', title: `${e.label} has no amount`, detail: `Expected ${formatShortDate(e.date)}. Add an amount to include it in your forecast.` });
    }
  }
  // Phase 4A.4.4: amounts are formatted in the currency of the account they belong to; repeated dates of one
  // scheduled item are one warning (every date is still in `items`).
  const acctOf = (id: ID) => input.accounts.find((a) => a.id === id);
  const nameOf = (id: ID) => acctOf(id)?.name ?? 'an account';
  const curOf = (id: ID): CurrencyCode => acctOf(id)?.currency ?? cur;
  const H = formatShortDate(sts.horizonEnd);
  const dateList = (ds: ISODate[]) => ds.map(formatShortDate).join(', ');
  /** Occurrences of one recurring item share a group; anything else (planned transactions) stands alone. */
  const groupKey = (eventId: string) => (eventId.startsWith('occ:') ? `occ:${eventId.slice(4).split('|')[0]}` : eventId);
  function groupBy<X>(xs: readonly X[], key: (x: X) => string): X[][] {
    const m = new Map<string, X[]>();
    for (const x of xs) m.set(key(x), [...(m.get(key(x)) ?? []), x]);
    return [...m.values()];
  }
  const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

  const cardWarned = new Set<ID>();
  const acctName = (id: ID) => input.accounts.find((a) => a.id === id)?.name ?? 'Card';
  for (const line of balances.lines) {
    if (line.type !== 'credit_card' || line.balanceCents >= 0) continue;
    const scheduled = input.recurring.some((r) => !r.paused && r.toAccountId === line.accountId);
    if (!scheduled) {
      cardWarned.add(line.accountId);
      warnings.push({
        id: `card-unscheduled:${line.accountId}`,
        severity: 'warning',
        title: `${formatCents(-line.balanceCents, cur)} on ${line.name} with no payment scheduled`,
        detail: (() => {
          const r = sts.cardDebtToday.find((x) => x.accountId === line.accountId);
          const reserved = r ? r.uncoveredCents + r.advanceCents : -line.balanceCents;
          const pending = r?.pendingCreditCents ?? 0;
          return `No payment is scheduled, so Safe to Spend counts the ${formatCents(reserved, cur)} as owed now.${pending > 0 ? ` That includes ${formatCents(pending, cur)} of pending refunds or payments, which aren't counted until they post.` : ''}${line.archived ? ` ${line.name} is archived; archiving doesn't clear what it owes.` : ''}`;
        })(),
        accountId: line.accountId,
      });
    }
  }
  // Part of today's card debt not covered by the payments scheduled for it (Phase 4A.5.2): counted as owed now.
  for (const r of sts.cardDebtToday) {
    if (cardWarned.has(r.accountId) || r.uncoveredCents === 0 || r.coveredCents === 0) continue;
    cardWarned.add(r.accountId);
    const n = acctName(r.accountId);
    warnings.push({
      id: `card-uncovered:${r.accountId}`,
      severity: 'warning',
      title: `${n}: ${formatCents(r.uncoveredCents, cur)} of ${formatCents(r.owedCents, cur)} isn't covered by a scheduled payment`,
      detail: `Safe to Spend counts the ${formatCents(r.uncoveredCents, cur)} as owed now. The payment you planned for ${r.paymentDate ? formatShortDate(r.paymentDate) : 'later'} covers the other ${formatCents(r.coveredCents, cur)} on that day.`,
      accountId: r.accountId,
    });
  }
  // A card projected to owe money at the end of the forecast that no later scheduled payment pays (Phase 4A.4.4).
  // Card purchases (and cash advances already repaid) are only counted when a payment is scheduled, so say so.
  const afterHorizon = expandOccurrences(input.recurring, input.exceptions, input.transactions, { from: addDays(sts.horizonEnd, 1), to: addDays(sts.horizonEnd, INCOME_LOOKAHEAD_DAYS), today: input.today });
  for (const a of input.accounts) {
    if (a.type !== 'credit_card' || a.currency !== cur || cardWarned.has(a.id)) continue;
    const owedEnd = -(conservative.endBalances[a.id] ?? 0);
    if (owedEnd <= 0) continue;
    const paidLater = afterHorizon.some((o) => o.toAccountId === a.id && o.status !== 'skipped' && o.status !== 'confirmed') ||
      input.transactions.some((t) => t.accountId === a.id && t.amountCents > 0 && t.date > sts.horizonEnd);
    if (paidLater) continue;
    warnings.push({
      id: `card-projected:${a.id}`,
      severity: 'warning',
      title: `${a.name} is projected to owe ${formatCents(owedEnd, cur)} on ${H}, and no payment is scheduled for it`,
      detail: `Your scheduled payments to ${a.name} don't cover all of it, and nothing after the forecast pays it. Safe to Spend counts each unpaid charge as owed from the day it's made (${formatCents(owedEnd, cur)} by ${H}). Schedule a card payment to change when it's counted.`,
      accountId: a.id,
      items: [{ date: sts.horizonEnd, label: `${a.name} owed`, cents: -owedEnd, currency: cur }],
    });
  }
  for (const u of sts.unreliableCards) {
    warnings.push({
      id: `card-unreliable:${u.accountId}`,
      severity: 'warning',
      title: `${u.name}'s balance isn't included in Safe to Spend`,
      detail: `It can't be calculated reliably: ${u.reason}. Safe to Spend and "Can I afford this?" don't include what ${u.name} owes.`,
      accountId: u.accountId,
    });
  }
  const competingText = (cs: { label: string; requestedCents: Cents; fundedCents: Cents; sameGroup: boolean }[], c: CurrencyCode) => {
    const first = cs.filter((x) => !x.sameGroup).map((x) => `${x.label} (${formatCents(x.fundedCents, c)} of ${formatCents(x.requestedCents, c)})`);
    const shared = cs.filter((x) => x.sameGroup).map((x) => `${x.label} (${formatCents(x.fundedCents, c)} of ${formatCents(x.requestedCents, c)})`);
    return [first.length ? `Counted first: ${first.join(', ')}.` : '', shared.length ? `Shared in proportion with: ${shared.join(', ')}.` : ''].filter(Boolean).join(' ');
  };
  const PRIORITY_NOTE = 'When one account can\'t cover every transfer on the same day, the forecast assumes card payments go first, then moves to other non-spendable accounts, then moves into your spendable accounts. That is a cautious assumption, not how your bank will necessarily process them.';
  for (const list of groupBy(conservative.unfundedTransfers.filter((u) => u.date <= sts.horizonEnd), (u) => groupKey(u.eventId))) {
    const u = list[0]!;
    const c = curOf(u.fromAccountId);
    const f = (x: Cents) => formatCents(x, c);
    const from = nameOf(u.fromAccountId);
    if (list.length === 1) {
      const short = u.requestedCents - u.fundedCents;
      warnings.push({
        id: `unfunded:${u.eventId}`,
        severity: 'warning',
        title: u.fundedCents === 0 ? `${u.label}: ${from} won't have the money` : `${u.label}: only ${f(u.fundedCents)} of ${f(u.requestedCents)} is available`,
        detail: u.competing.length === 0
          ? `Scheduled for ${formatShortDate(u.date)} from ${from}, which is projected to have ${f(u.sourceBalanceCents)} then. Only that amount is counted; ${f(short)} is not.`
          : `Scheduled for ${formatShortDate(u.date)} from ${from}, which is projected to have ${f(u.sourceBalanceCents)} then. Requested ${f(u.requestedCents)}; counted ${f(u.fundedCents)}; not counted ${f(short)}. ${competingText(u.competing, c)} ${PRIORITY_NOTE}`,
        accountId: u.fromAccountId,
        items: [{ date: u.date, label: u.label, cents: -short, currency: c }],
      });
      continue;
    }
    const req = sum(list.map((x) => x.requestedCents));
    const got = sum(list.map((x) => x.fundedCents));
    warnings.push({
      id: `unfunded:${groupKey(u.eventId)}`,
      severity: 'warning',
      title: `${u.label}: ${from} can't fully fund ${list.length} transfers`,
      detail: `Scheduled on ${dateList(list.map((x) => x.date))} from ${from}. Requested ${f(req)} in total; counted ${f(got)}; not counted ${f(req - got)}.${list.some((x) => x.competing.length) ? ` ${PRIORITY_NOTE}` : ''}`,
      accountId: u.fromAccountId,
      items: list.map((x) => ({ date: x.date, label: `${x.label}: ${f(x.fundedCents)} of ${f(x.requestedCents)} counted`, cents: -(x.requestedCents - x.fundedCents), currency: c })),
    });
  }
  for (const list of groupBy(conservative.coveredPayments.filter((x) => x.date <= sts.horizonEnd && x.kind !== 'overdrawn'), (x) => groupKey(x.eventId))) {
    const p = list[0]!;
    const name = nameOf(p.accountId);
    const c = curOf(p.accountId);
    const f = (x: Cents) => formatCents(x, c);
    if (list.length === 1) {
      warnings.push({
        id: `covered:${p.eventId}`,
        severity: 'warning',
        title: p.fundedCents === 0 ? `${p.label}: ${name} can't cover it` : `${p.label}: ${name} can cover only ${f(p.fundedCents)} of ${f(p.requestedCents)}`,
        detail: `Due ${formatShortDate(p.date)} from ${name}, which is projected to have ${f(p.accountBalanceCents)} then. Safe to Spend counts the other ${f(p.coveredCents)} against your spendable accounts. Move ${f(p.coveredCents)} into ${name} before ${formatShortDate(p.date)}, or change the account it's paid from.`,
        accountId: p.accountId,
        items: [{ date: p.date, label: p.label, cents: -p.coveredCents, currency: c }],
      });
      continue;
    }
    const total = sum(list.map((x) => x.coveredCents));
    warnings.push({
      id: `covered:${groupKey(p.eventId)}`,
      severity: 'warning',
      title: `${p.label}: ${name} can't fully cover ${list.length} payments`,
      detail: `Due ${dateList(list.map((x) => x.date))} from ${name}, which is projected to have ${f(p.accountBalanceCents)} on ${formatShortDate(p.date)}. Safe to Spend counts ${f(total)} in total against your spendable accounts. Move ${f(total)} into ${name} before ${formatShortDate(p.date)} to cover all of them, or change the account it's paid from.`,
      accountId: p.accountId,
      items: list.map((x) => ({ date: x.date, label: `${x.label}: ${f(x.coveredCents)} not covered by ${name}`, cents: -x.coveredCents, currency: c })),
    });
  }
  // Archived and overdrawn: the debt is still counted (Phase 4A.4.4).
  for (const p of conservative.coveredPayments.filter((x) => x.kind === 'overdrawn')) {
    const name = nameOf(p.accountId);
    const f = (x: Cents) => formatCents(x, curOf(p.accountId));
    // Phase 4A.5.9: an active account not counted as spendable (savings) can be overdrawn too
    if (!acctOf(p.accountId)?.archived) {
      warnings.push({
        id: `overdrawn:${p.accountId}`,
        severity: 'warning',
        title: `${name} is overdrawn by ${f(p.coveredCents)}`,
        detail: `${name} isn't counted as spendable, but its negative balance is owed, so Safe to Spend counts ${f(p.coveredCents)} against your spendable accounts. Bring ${name} back to ${f(0)} to clear this.`,
        accountId: p.accountId,
        items: [{ date: p.date, label: `${name} balance`, cents: p.accountBalanceCents, currency: curOf(p.accountId) }],
      });
      continue;
    }
    warnings.push({
      id: `archived-overdrawn:${p.accountId}`,
      severity: 'warning',
      title: `${name} is archived and overdrawn by ${f(p.coveredCents)}`,
      detail: `Archiving doesn't clear it: Safe to Spend still counts ${f(p.coveredCents)} against your spendable accounts, as it did before ${name} was archived. Bring ${name} back to ${f(0)} (or restore it) to clear this.`,
      accountId: p.accountId,
      items: [{ date: p.date, label: `${name} balance`, cents: p.accountBalanceCents, currency: curOf(p.accountId) }],
    });
  }
  const lastDay = conservative.days.filter((d) => d.date <= sts.horizonEnd).at(-1);
  for (const adv of conservative.cashAdvances) {
    if (adv.date > sts.horizonEnd) continue;
    const owedAtEnd = lastDay?.advanceOwedEndCents ?? 0;
    const c = curOf(adv.cardId);
    warnings.push({
      id: `advance:${adv.eventId}`,
      severity: 'warning',
      title: `${adv.label}: ${formatCents(adv.cents, c)} borrowed from ${nameOf(adv.cardId)}`,
      accountId: adv.cardId,
      items: [{ date: adv.date, label: adv.label, cents: adv.cents, currency: c }],
      detail: `A cash advance on ${formatShortDate(adv.date)} is borrowed money, so Safe to Spend doesn't count it as yours until a scheduled card payment pays it back.${owedAtEnd > 0 ? ` Through ${H}, ${formatCents(owedAtEnd, c)} of planned cash advances is not paid back.` : ''} Interest, fees and your card limit are not known, so it may cost more or may not be available.`,
    });
  }
  const shortByAccount = new Map<ID, AccountShortfall[]>();
  for (const a of conservative.accountShortfalls) {
    if (a.date > sts.horizonEnd) continue;
    shortByAccount.set(a.accountId, [...(shortByAccount.get(a.accountId) ?? []), a]);
  }
  const ownLow = (date: ISODate) => {
    const d = conservative.days.find((x) => x.date === date);
    return d ? d.lowCashCents - d.advanceOwedAtLowCents : 0;
  };
  for (const [id, list] of shortByAccount) {
    // Only when the money exists in another spendable account on at least one of these days;
    // a single account (or a combined shortfall every time) is already the overall shortfall warning.
    const coveredDays = list.filter((x) => ownLow(x.date) >= 0);
    if (!coveredDays.length) continue;
    const name = nameOf(id);
    const c = curOf(id);
    const first = list[0]!;
    const deepestDay = list.reduce((a, x) => (x.lowCents < a.lowCents ? x : a));
    const deepest = deepestDay.lowCents;
    const what = (x: AccountShortfall) => (x.labels.length ? x.labels.join(', ') : 'its balance today');
    const laterAll = list.slice(1).map((x) => `${formatCents(x.lowCents, c)} on ${formatShortDate(x.date)} (${what(x)})`);
    const later = laterAll.length > 4 ? [...laterAll.slice(0, 4), `${laterAll.length - 4} more`] : laterAll;
    if (list.length === 1 && first.labels.length === 0) {
      // Phase 4A.5.8: overdrawn today, nothing paid from it today
      warnings.push({
        id: `account-short:${id}`,
        severity: 'warning',
        title: `${name} is overdrawn: ${formatCents(first.lowCents, c)} today`,
        detail: `Your other spendable accounts have enough, and Safe to Spend already counts the ${formatCents(-first.lowCents, c)}. Move ${formatCents(-first.lowCents, c)} into ${name} to bring it back to ${formatCents(0, c)}.`,
        accountId: id,
        items: [{ date: first.date, label: `${name} balance`, cents: first.lowCents, currency: c }],
      });
      continue;
    }
    warnings.push({
      id: `account-short:${id}`,
      severity: 'warning',
      title: `${name} would go to ${formatCents(first.lowCents, c)} on ${formatShortDate(first.date)}`,
      detail: list.length === 1
        ? `${what(first)} is paid from ${name}. Your other spendable accounts have enough, and Safe to Spend assumes you move money between them. Move ${formatCents(-first.lowCents, c)} into ${name} before ${formatShortDate(first.date)}, or change the account it's paid from.`
        : `${first.labels.length ? `${what(first)} is paid from ${name}` : `${name} is overdrawn today`}. Later: ${later.join('; ')}. Lowest: ${formatCents(deepest, c)} on ${formatShortDate(deepestDay.date)}. Safe to Spend assumes you move money between your spendable accounts. Move ${formatCents(-deepest, c)} into ${name} before ${formatShortDate(first.date)} to cover all of these, or change the accounts they're paid from.`,
      accountId: id,
      items: list.map((x) => ({ date: x.date, label: x.labels.length ? `${name} after ${x.labels.join(', ')}` : `${name} balance`, cents: x.lowCents, currency: c })),
    });
  }
  // Possible duplicates: a planned transaction (not linked to a bill) on the same account, for the same amount,
  // within 3 days of a scheduled bill. Never merged: both stay counted until the user resolves it.
  // The bill is named only when it is the only candidate or clearly the best name match (Phase 4A.4).
  for (const t of input.transactions) {
    if (t.date <= input.today || t.date > sts.horizonEnd || t.occurrenceRef || t.transferGroupId || t.amountCents >= 0) continue;
    const candidates = conservative.occurrences.filter((o) =>
      (o.status === 'expected' || o.status === 'estimated') && o.kind !== 'income' && o.accountId === t.accountId &&
      o.amountCents === -t.amountCents && Math.abs(diffDays(o.date, t.date)) <= 3);
    if (!candidates.length) continue;
    const scored = candidates.map((o) => ({ o, sim: similarity(t.merchant, o.name) })).sort((x, y) => y.sim - x.sim);
    const best = scored.length === 1 || (scored[0]!.sim >= 0.3 && scored[0]!.sim > scored[1]!.sim) ? scored[0]!.o : null;
    const amount = formatCents(-t.amountCents, curOf(t.accountId));
    warnings.push(
      best
        ? {
            id: `duplicate:${t.id}`,
            severity: 'warning',
            title: `Possible duplicate: ${best.name} on ${formatShortDate(best.date)}`,
            detail: `A planned transaction for ${amount} on ${formatShortDate(t.date)} looks like the scheduled ${best.name}. Both are counted until you delete the planned one or mark the bill paid with it.`,
          }
        : {
            id: `duplicate:${t.id}`,
            severity: 'warning',
            title: `Possible duplicate: ${t.merchant || 'planned transaction'} on ${formatShortDate(t.date)}`,
            detail: `A planned transaction for ${amount} on ${formatShortDate(t.date)} matches more than one scheduled bill by amount and date (${candidates.map((o) => `${o.name} on ${formatShortDate(o.date)}`).join(', ')}), so it isn't clear which one it pays. Everything is counted until you delete it or mark the right bill paid with it.`,
          },
    );
  }
  // Transfers between currencies are never converted (Phase 4A.4.2); grouped per scheduled item (4A.4.4).
  for (const list of groupBy(conservative.currencyConflicts.filter((x) => x.date <= sts.horizonEnd), (x) => groupKey(x.eventId))) {
    const x = list[0]!;
    warnings.push({
      id: `currency-transfer:${list.length === 1 ? x.eventId : groupKey(x.eventId)}`,
      severity: 'warning',
      title: `${x.label}: ${nameOf(x.fromAccountId)} (${x.fromCurrency}) to ${nameOf(x.toAccountId)} (${x.toCurrency}) isn't converted`,
      detail: x.counted
        ? `Clarity doesn't convert currencies. On ${dateList(list.map((y) => y.date))} the money leaving ${nameOf(x.fromAccountId)} is counted there, but nothing is counted as arriving in ${nameOf(x.toAccountId)}.`
        : `Clarity doesn't convert currencies, so this full-balance card payment on ${dateList(list.map((y) => y.date))} has no amount in ${x.fromCurrency} and isn't counted. Enter it as a fixed amount, or pay the card from an account in ${x.toCurrency}.`,
      accountId: x.fromAccountId,
      items: list.map((y) => ({ date: y.date, label: y.label, cents: y.cents, currency: y.fromCurrency })),
    });
  }
  // Scheduled items on accounts left out of the totals: other currencies, and archived accounts (Phase 4A.4.2).
  type Item = NonNullable<Warning['items']>[number] & { key: string };
  const occItems = (pred: (id: ID) => boolean) => {
    const out = new Map<ID, Item[]>();
    const add = (id: ID, item: Item) => out.set(id, [...(out.get(id) ?? []), item]);
    for (const o of conservative.occurrences) {
      if (o.status === 'confirmed' || o.status === 'skipped' || o.date > sts.horizonEnd || (o.status !== 'overdue' && o.date < input.today)) continue;
      const signed = o.kind === 'income' ? o.amountCents : -o.amountCents;
      // the amount is in the currency of the account it is paid from
      if (pred(o.accountId)) add(o.accountId, { date: o.date, label: o.name, cents: signed, currency: curOf(o.accountId), key: o.recurringId });
      else if (o.toAccountId && pred(o.toAccountId)) add(o.toAccountId, { date: o.date, label: o.name, cents: o.amountCents, currency: curOf(o.accountId), key: o.recurringId });
    }
    for (const t of input.transactions) {
      if (t.date > input.today && t.date <= sts.horizonEnd && pred(t.accountId)) add(t.accountId, { date: t.date, label: t.merchant || 'Planned transaction', cents: t.amountCents, currency: curOf(t.accountId), key: t.id });
    }
    return out;
  };
  const strip = (xs: Item[]) => xs.map(({ key: _key, ...rest }) => rest);
  const byDate = (a: { date: ISODate }, b: { date: ISODate }) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  if (balances.excludedCurrencyAccountIds.length) {
    const foreign = new Set(balances.excludedCurrencyAccountIds);
    const items = [...occItems((id) => foreign.has(id)).values()].flat().sort(byDate);
    warnings.push({
      id: 'currency',
      severity: 'info',
      title: 'Some accounts are not included',
      detail: `Accounts in a currency other than ${cur} are left out of totals.${items.length ? ` Their scheduled items aren't counted in Safe to Spend either: ${items.map((x) => `${x.label} (${formatShortDate(x.date)})`).join(', ')}.` : ''}`,
      ...(items.length ? { items: strip(items) } : {}),
    });
  }
  const archived = new Set(input.accounts.filter((a) => a.archived).map((a) => a.id));
  for (const [id, raw] of occItems((id) => archived.has(id))) {
    const name = nameOf(id);
    const items = raw.sort(byDate);
    const distinct = new Set(items.map((x) => x.key)).size;
    const list = items.map((x) => `${x.label} (${formatShortDate(x.date)})`).join(', ');
    const acctCur = curOf(id);
    warnings.push({
      id: `archived:${id}`,
      severity: 'warning',
      title: `${distinct} scheduled ${distinct === 1 ? 'item still uses' : 'items still use'} ${name}, which is archived`,
      // Currency first (Phase 4A.4.4): an archived account in another currency is never counted, so never claim it is.
      detail: acctCur !== cur
        ? `${list}. ${name} is in ${acctCur}, and Clarity doesn't convert currencies, so none of these are counted in Safe to Spend (${cur}). Move them to an account in ${cur}, or restore ${name}.`
        : `${list}. Bills and transfers out of ${name} are still counted: they're paid from what ${name} holds, and anything it can't cover is counted against your spendable accounts. Money going into it isn't counted as spendable. Move them to an active account in Planning, or restore ${name}.`,
      accountId: id,
      items: strip(items),
    });
  }
  // An item's `currency` is set only when it differs from the base currency (absent = base currency).
  for (const w of warnings) for (const it of w.items ?? []) if (it.currency === cur) delete it.currency;
  // Most important first, so the dashboard's short list shows them; the full list (Planning) shows every one.
  warnings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  const recordedLines: ExplainLine[] = balances.lines.map((l) => ({
    kind: l.countsAsCash ? 'in' : 'info',
    label: l.name,
    cents: l.balanceCents,
    note: l.archived ? (l.type === 'credit_card' ? 'archived card, still owed' : 'archived and overdrawn, still owed') : l.countsAsCash ? (l.pendingCreditCents ? `includes ${formatCents(l.pendingCreditCents, cur)} of pending credits, which aren't available to spend until they clear (not counted in Safe to Spend)` : l.pendingCents ? `includes ${formatCents(l.pendingCents, cur)} pending` : 'counts as available cash') : l.type === 'credit_card' ? 'owed on card, not cash' : 'not marked as spendable',
  }));
  recordedLines.push({ kind: 'result', label: TERMS.recordedBalance, cents: balances.availableCashCents });

  return {
    today: input.today,
    balances,
    monthEnd: { cents: monthEndExpl.resultCents ?? 0, date: eom, explanation: monthEndExpl },
    endOfDay: { cents: eodExpl.resultCents ?? 0, date: input.today, explanation: eodExpl },
    safeToSpend: sts,
    lowestThroughMonthEnd: { ...lowMonth, explanation: lowExplanation(lowMonth, conservative, TERMS.lowestBalance, cur, next, input.accounts) },
    lowestBeforeNextIncome:
      lowBefore && next ? { ...lowBefore, nextIncome: next, explanation: lowExplanation(lowBefore, conservative, 'Lowest before next income', cur, next, input.accounts) } : null,
    nextIncome: next,
    upcoming,
    upcomingUntil: until,
    upcomingLater,
    upcomingLaterUntil: sts.horizonEnd > until ? sts.horizonEnd : until,
    warnings,
    recordedBalanceExplanation: {
      title: 'Current recorded balance',
      resultCents: balances.availableCashCents,
      summary: 'Opening balances you entered plus every transaction recorded or imported since. Future-dated transactions are not included until their date.',
      lines: recordedLines,
      assumptions: ['Pending transactions are included.', 'Credit card balances are shown separately and never counted as cash.'],
    },
    forecast: { ...inclusive, horizonEnd: until, days: inclusive.days.filter((d) => d.date <= until), excludedEvents: inclusive.excludedEvents.filter((e) => e.date <= until) },
  };
}

/** Projected available cash at the end of any date (inclusive forecast). */
export function balanceOnDate(input: EngineInput, date: ISODate): Projection {
  const target = date < input.today ? input.today : date;
  const f = forecastTo(input, target, true);
  const ex = projectionExplanation(f, target, `Projected balance on ${formatShortDate(target)}`, input.baseCurrency, input.accounts);
  return { cents: ex.resultCents ?? 0, date: target, explanation: ex };
}
