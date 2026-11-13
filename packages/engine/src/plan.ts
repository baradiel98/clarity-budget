import {
  addDays,
  endOfMonth,
  formatShortDate,
  formatCents,
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
import { buildForecast, dayOf, lowestBetween, type Forecast, type ForecastEvent, type Hypothetical, type LowPoint } from './forecast';
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
}

export interface Explanation {
  title: string;
  resultCents: Cents | null;
  summary: string;
  lines: ExplainLine[];
  assumptions: string[];
}

export interface Warning {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  detail: string;
}

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
  horizonReason: 'month_end' | 'next_income';
  availableCashCents: Cents;
  reserveCents: Cents;
  lowPoint: LowPoint;
  excludedIncome: ForecastEvent[];
  explanation: Explanation;
}

const ASSUMPTIONS_BASE = [
  'Uses only balances and transactions you recorded or imported. Nothing is pulled from a bank.',
  'On any day, money going out is applied before money coming in (so a bill due on payday is covered by the balance you already have).',
  'Unpaid bills that are past due are treated as still owed today.',
];

/** Look this far past month-end for the next paycheck when choosing the Safe to Spend horizon. */
export const INCOME_LOOKAHEAD_DAYS = 62;

function horizonFor(input: EngineInput): { end: ISODate; reason: 'month_end' | 'next_income'; next: IncomeRef | null } {
  const eom = endOfMonth(input.today);
  const occ = expandOccurrences(input.recurring, input.exceptions, input.transactions, {
    from: input.today,
    to: addDays(eom, INCOME_LOOKAHEAD_DAYS),
    today: input.today,
  });
  const next = nextIncome(occ, input.today, false);
  if (next && next.date > eom) return { end: next.date, reason: 'next_income', next };
  return { end: eom, reason: 'month_end', next };
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

function eventLine(e: ForecastEvent, cur: CurrencyCode): ExplainLine {
  const status = e.source === 'overdue' ? 'overdue, counted today' : e.estimated ? 'estimated' : e.source === 'hypothetical' ? 'hypothetical' : e.source === 'scheduled_tx' ? 'planned' : undefined;
  void cur;
  return {
    kind: e.cashDeltaCents < 0 ? 'out' : 'in',
    label: e.label,
    cents: e.cashDeltaCents,
    date: e.date,
    ...(status ? { note: status } : {}),
  };
}

function excludedLine(e: ForecastEvent): ExplainLine {
  const note =
    e.excluded === 'unknown_amount'
      ? 'amount unknown, not counted'
      : e.excluded === 'estimated_income'
        ? 'estimated income, not counted in Safe to Spend'
        : 'past payday not recorded, not counted';
  return { kind: 'excluded', label: e.label, date: e.date, note, ...(e.occurrence?.amountCents ? { cents: e.occurrence.amountCents } : {}) };
}

/** Safe to Spend = lowest projected available cash between today and the horizon − minimum reserve. */
export function computeSafeToSpend(input: EngineInput, hypotheticals?: readonly Hypothetical[]): SafeToSpend {
  const h = horizonFor(input);
  const f = forecastTo(input, h.end, false, hypotheticals);
  const low = lowestBetween(f, input.today, h.end);
  if (!low) throw new Error('Forecast produced no days');
  const reserve = input.minReserveCents;
  const cents = low.cents - reserve;
  const excludedIncome = f.excludedEvents.filter((e) => e.date <= low.date || e.excluded === 'overdue_income');
  const cur = input.baseCurrency;

  const lines: ExplainLine[] = [
    { kind: 'start', label: 'Available cash now', cents: f.startCashCents },
    ...low.incomeBefore.map((e) => eventLine(e, cur)),
    ...low.obligations.map((e) => eventLine(e, cur)),
    { kind: 'info', label: `Lowest point: ${formatShortDate(low.date)}`, cents: low.cents },
    { kind: 'reserve', label: 'Minimum cash reserve', cents: -reserve },
    { kind: 'result', label: cents >= 0 ? 'Safe to Spend' : 'Short by', cents },
    ...excludedIncome.map(excludedLine),
  ];
  const horizonText = h.reason === 'next_income' ? `your next known paycheck on ${formatShortDate(h.end)}` : `the end of the month (${formatShortDate(h.end)})`;
  const summary =
    cents >= 0
      ? `You can spend up to ${formatCents(cents, cur)} today and still cover everything scheduled through ${horizonText}, keeping your ${formatCents(reserve, cur)} reserve.`
      : `Your scheduled obligations through ${horizonText} are ${formatCents(-cents, cur)} more than your cash and reserve allow. Your balance is lowest on ${formatShortDate(low.date)}.`;

  return {
    cents,
    shortfallCents: cents < 0 ? -cents : 0,
    horizonEnd: h.end,
    horizonReason: h.reason,
    availableCashCents: f.startCashCents,
    reserveCents: reserve,
    lowPoint: low,
    excludedIncome,
    explanation: {
      title: 'Safe to Spend',
      resultCents: cents,
      summary,
      lines,
      assumptions: [
        ...ASSUMPTIONS_BASE,
        'Only income with a fixed amount is counted. Estimated or unknown income is listed but not counted.',
        'Credit card purchases only reduce cash when a card payment is scheduled.',
      ],
    },
  };
}

export interface AffordQuery {
  amountCents: Cents; // positive purchase amount
  accountId: ID;
  date: ISODate;
  label?: string;
}

export interface AffordResult {
  verdict: 'yes' | 'tight' | 'no';
  before: SafeToSpend;
  after: SafeToSpend;
  /** Positive when the purchase would leave you short. */
  shortfallCents: Cents;
  notes: string[];
}

/** "Can I afford this?" — runs the same Safe to Spend calculation with one hypothetical purchase. Never saves anything. */
export function canIAfford(input: EngineInput, q: AffordQuery): AffordResult {
  if (!Number.isSafeInteger(q.amountCents) || q.amountCents <= 0) throw new Error('Amount must be a positive number of cents');
  const before = computeSafeToSpend(input);
  const hyp: Hypothetical = {
    id: 'afford',
    accountId: q.accountId,
    date: q.date < input.today ? input.today : q.date,
    amountCents: -q.amountCents,
    label: q.label?.trim() || 'This purchase',
  };
  const after = computeSafeToSpend(input, [hyp]);
  const notes: string[] = [];
  const acct = input.accounts.find((a) => a.id === q.accountId);
  if (acct?.type === 'credit_card') {
    const paysCard = input.recurring.some(
      (r) => !r.paused && (r.kind === 'transfer' || r.kind === 'bill') && r.toAccountId === acct.id && r.amount.type === 'card_full_balance',
    );
    notes.push(
      paysCard
        ? 'Charged to your card. It reduces cash when your scheduled full-balance card payment happens.'
        : 'Charged to your card. It will not reduce cash until you pay the card, and no full-balance payment is scheduled.',
    );
  }
  if (hyp.date > before.horizonEnd) notes.push('This date is after the forecast window, so it does not change today’s Safe to Spend.');
  const newLow = after.lowPoint.cents;
  const verdict: AffordResult['verdict'] = newLow >= input.minReserveCents ? 'yes' : newLow >= 0 ? 'tight' : 'no';
  if (verdict === 'tight') notes.push('You would dip into your minimum cash reserve.');
  return { verdict, before, after, shortfallCents: after.cents < 0 ? -after.cents : 0, notes };
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
  warnings: Warning[];
  recordedBalanceExplanation: Explanation;
  /** Inclusive forecast (estimated income counted) through month end / horizon, for charts. */
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
  status: Occurrence['status'] | 'scheduled_tx';
  occurrence?: Occurrence;
  txId?: ID;
  isIncome: boolean;
}

function projectionExplanation(f: Forecast, upTo: ISODate, title: string, cur: CurrencyCode): Explanation {
  const lines: ExplainLine[] = [{ kind: 'start', label: 'Available cash now', cents: f.startCashCents }];
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

function lowExplanation(low: LowPoint, f: Forecast, title: string, cur: CurrencyCode, next: IncomeRef | null): Explanation {
  const lines: ExplainLine[] = [
    { kind: 'start', label: 'Available cash now', cents: f.startCashCents },
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

  const monthEndExpl = projectionExplanation(inclusive, eom, 'Projected month-end balance', cur);
  const eodExpl = projectionExplanation(inclusive, input.today, 'Projected end of today', cur);

  const lowMonth = lowestBetween(conservative, input.today, eom)!;
  const lowBefore = next ? lowestBetween(conservative, input.today, next.date) : null;

  // Upcoming: overdue + next 14 days.
  const until = (() => {
    const d = inclusive.days[Math.min(14, inclusive.days.length - 1)];
    return d ? d.date : input.today;
  })();
  const upcoming: UpcomingItem[] = [];
  for (const o of inclusive.occurrences) {
    if (o.status === 'confirmed') continue;
    if (o.status !== 'overdue' && (o.date < input.today || o.date > until)) continue;
    const ev = inclusive.days.flatMap((d) => d.events).find((e) => e.occurrence?.key === o.key);
    const sign = o.kind === 'income' ? 1 : -1;
    upcoming.push({
      id: `occ:${o.key}`,
      date: o.date,
      label: o.name,
      cents: ev ? ev.cashDeltaCents || (ev.legs.find((l) => l.accountId === o.accountId)?.deltaCents ?? 0) : sign * o.amountCents,
      affectsCash: !ev || ev.cashDeltaCents !== 0 || ev.legs.length === 0,
      status: o.status,
      occurrence: ev?.occurrence ?? o,
      isIncome: o.kind === 'income',
    });
  }
  for (const d of inclusive.days) {
    if (d.date > until) break;
    for (const e of d.events) {
      if (e.source !== 'scheduled_tx' || !e.txId) continue;
      upcoming.push({ id: e.id, date: e.date, label: e.label, cents: e.cashDeltaCents || e.legs[0]!.deltaCents, affectsCash: e.cashDeltaCents !== 0, status: 'scheduled_tx', txId: e.txId, isIncome: e.legs[0]!.deltaCents > 0 });
    }
  }
  upcoming.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

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
  for (const line of balances.lines) {
    if (line.type !== 'credit_card' || line.balanceCents >= 0) continue;
    const scheduled = input.recurring.some((r) => !r.paused && r.toAccountId === line.accountId);
    if (!scheduled) {
      warnings.push({
        id: `card-unscheduled:${line.accountId}`,
        severity: 'warning',
        title: `${formatCents(-line.balanceCents, cur)} on ${line.name} with no payment scheduled`,
        detail: 'This balance is not deducted from Safe to Spend until you schedule a card payment.',
      });
    }
  }
  if (balances.excludedCurrencyAccountIds.length) {
    warnings.push({ id: 'currency', severity: 'info', title: 'Some accounts are not included', detail: `Accounts in a currency other than ${cur} are left out of totals.` });
  }

  const recordedLines: ExplainLine[] = balances.lines.map((l) => ({
    kind: l.countsAsCash ? 'in' : 'info',
    label: l.name,
    cents: l.balanceCents,
    note: l.countsAsCash ? (l.pendingCents ? `includes ${formatCents(l.pendingCents, cur)} pending` : 'counts as available cash') : l.type === 'credit_card' ? 'owed on card, not cash' : 'not marked as spendable',
  }));
  recordedLines.push({ kind: 'result', label: 'Available cash', cents: balances.availableCashCents });

  return {
    today: input.today,
    balances,
    monthEnd: { cents: monthEndExpl.resultCents ?? 0, date: eom, explanation: monthEndExpl },
    endOfDay: { cents: eodExpl.resultCents ?? 0, date: input.today, explanation: eodExpl },
    safeToSpend: sts,
    lowestThroughMonthEnd: { ...lowMonth, explanation: lowExplanation(lowMonth, conservative, 'Lowest projected balance', cur, next) },
    lowestBeforeNextIncome:
      lowBefore && next ? { ...lowBefore, nextIncome: next, explanation: lowExplanation(lowBefore, conservative, 'Lowest before next income', cur, next) } : null,
    nextIncome: next,
    upcoming,
    warnings,
    recordedBalanceExplanation: {
      title: 'Current recorded balance',
      resultCents: balances.availableCashCents,
      summary: 'Opening balances you entered plus every transaction recorded or imported since. Future-dated transactions are not included until their date.',
      lines: recordedLines,
      assumptions: ['Pending transactions are included.', 'Credit card balances are shown separately and never counted as cash.'],
    },
    forecast: inclusive,
  };
}

/** Projected available cash at the end of any date (inclusive forecast). */
export function balanceOnDate(input: EngineInput, date: ISODate): Projection {
  const target = date < input.today ? input.today : date;
  const f = forecastTo(input, target, true);
  const ex = projectionExplanation(f, target, `Projected balance on ${formatShortDate(target)}`, input.baseCurrency);
  return { cents: ex.resultCents ?? 0, date: target, explanation: ex };
}
