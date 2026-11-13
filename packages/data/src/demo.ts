import { addDays, addMonths, clampDay, diffDays, endOfMonth, makeIdFactory, parseISO, type ISODate, type WorkspaceData } from '@clarity/shared';
import { applyOps } from './ops';
import { addTransaction, createAccount, createRecurring, defaultSettings, seedCategories, updateSettings, type Ctx } from './commands';
import { emptyWorkspace } from './ops';

/**
 * Fictional sample data for Demo mode. Never mixed with real data: demo mode runs in memory
 * only and every screen shows a "Sample data" banner.
 */
export function buildDemoWorkspace(today: ISODate, now: number, seed = 1): WorkspaceData {
  let s = seed;
  const rand = (n: number) => {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      out[i] = s & 0xff;
    }
    return out;
  };
  const newId = makeIdFactory(rand);
  let data = emptyWorkspace(defaultSettings(now));
  const ctx = (): Ctx => ({ data, now, today, newId });
  const run = (ops: Parameters<typeof applyOps>[1]) => {
    data = applyOps(data, ops);
  };
  run(seedCategories(ctx()));
  const back = (d: number) => addDays(today, -d);
  const chk = createAccount({ ...ctx(), today: back(30) }, { name: 'Everyday Checking', type: 'checking', currentBalanceCents: 100000 });
  run(chk.ops);
  const sav = createAccount({ ...ctx(), today: back(30) }, { name: 'Savings', type: 'savings', currentBalanceCents: 520000 });
  run(sav.ops);
  const card = createAccount({ ...ctx(), today: back(30) }, { name: 'Visa Card', type: 'credit_card', currentBalanceCents: 0 });
  run(card.ops);
  run(updateSettings(ctx(), { minReserveCents: 20000, defaultAccountId: chk.account.id, onboardingComplete: true }));

  const rec = (r: Parameters<typeof createRecurring>[1]) => run(createRecurring(ctx(), r).ops);
  const payAnchor = addDays(today, 6);
  rec({ name: 'Paycheck', kind: 'income', accountId: chk.account.id, categoryId: 'cat_paycheck', schedule: { freq: 'weekly', interval: 2, anchor: payAnchor }, amount: { type: 'fixed', cents: 186000 } });
  rec({ name: 'Rent', kind: 'bill', accountId: chk.account.id, categoryId: 'cat_housing', schedule: { freq: 'monthly', interval: 1, day: 1, anchor: '2024-01-01' }, amount: { type: 'fixed', cents: 145000 } });
  rec({ name: 'Electricity', kind: 'bill', accountId: chk.account.id, categoryId: 'cat_utilities', schedule: { freq: 'monthly', interval: 1, day: 18, anchor: '2024-01-18' }, amount: { type: 'variable', cents: 8800 } });
  rec({ name: 'Phone', kind: 'bill', accountId: chk.account.id, categoryId: 'cat_internet', schedule: { freq: 'monthly', interval: 1, day: 22, anchor: '2024-01-22' }, amount: { type: 'fixed', cents: 6500 } });
  rec({ name: 'Streaming', kind: 'subscription', accountId: card.account.id, categoryId: 'cat_subscriptions', schedule: { freq: 'monthly', interval: 1, day: 9, anchor: '2024-01-09' }, amount: { type: 'fixed', cents: 1549 } });
  rec({ name: 'Card payment', kind: 'transfer', accountId: chk.account.id, toAccountId: card.account.id, categoryId: null, schedule: { freq: 'monthly', interval: 1, day: 25, anchor: '2024-01-25' }, amount: { type: 'card_full_balance' } });
  rec({ name: 'Savings', kind: 'savings', accountId: chk.account.id, toAccountId: sav.account.id, categoryId: null, schedule: { freq: 'monthly', interval: 1, day: 'last', anchor: endOfMonth('2024-01-01') }, amount: { type: 'fixed', cents: 25000 } });

  const add = (input: Parameters<typeof addTransaction>[1], at: ISODate) => run(addTransaction({ ...ctx(), now: now - diffDays(today, at) * 86_400_000 }, input).ops);
  const chkId = chk.account.id;
  const cardId = card.account.id;
  const recId = (name: string) => data.recurring.find((r) => r.name === name)!.id;
  const opened = back(30);

  // Last 30 days: recorded paychecks and bills, linked to their schedules so nothing is counted twice.
  for (const d of [addDays(payAnchor, -14), addDays(payAnchor, -28)]) {
    add({ kind: 'income', accountId: chkId, date: d, amountCents: 186000, merchant: 'Paycheck', categoryId: 'cat_paycheck', occurrenceRef: { recurringId: recId('Paycheck'), originalDate: d } }, d);
  }
  /** Most recent date with this day-of-month, if it falls after the accounts were opened. */
  const lastDom = (day: number): ISODate | null => {
    const { y, m } = parseISO(today);
    let d = clampDay(y, m, day);
    if (d > today) {
      const prev = addMonths(y, m, -1);
      d = clampDay(prev.y, prev.m, day);
    }
    return d > opened ? d : null;
  };
  const bills: [string, number, string, number, string][] = [['Rent', 1, 'cat_housing', 145000, chkId], ['Electricity', 18, 'cat_utilities', 9140, chkId], ['Phone', 22, 'cat_internet', 6500, chkId], ['Streaming', 9, 'cat_subscriptions', 1549, cardId]];
  for (const [name, day, categoryId, cents, accountId] of bills) {
    const d = lastDom(day);
    if (d) add({ kind: 'expense', accountId, date: d, amountCents: cents, merchant: name, categoryId, occurrenceRef: { recurringId: recId(name), originalDate: d } }, d);
  }

  const spend: [number, string, string, number, 'chk' | 'card'][] = [
    [1, 'Whole Foods', 'cat_groceries', 6412, 'card'],
    [2, 'Blue Bottle Coffee', 'cat_coffee', 575, 'card'],
    [3, 'Shell', 'cat_fuel', 4820, 'chk'],
    [5, 'Corner Bistro', 'cat_dining', 3860, 'card'],
    [6, 'Trader Joe’s', 'cat_groceries', 5233, 'chk'],
    [8, 'Pharmacy', 'cat_health', 1899, 'chk'],
    [9, 'Bookshop', 'cat_shopping', 2450, 'card'],
    [12, 'Blue Bottle Coffee', 'cat_coffee', 575, 'card'],
    [14, 'City Transit', 'cat_transport', 3000, 'chk'],
    [17, 'Whole Foods', 'cat_groceries', 7120, 'card'],
    [20, 'Cinema', 'cat_entertainment', 2800, 'card'],
    [24, 'Trader Joe’s', 'cat_groceries', 4875, 'chk'],
    [27, 'Shell', 'cat_fuel', 4410, 'chk'],
  ];
  for (const [d, merchant, categoryId, cents, acct] of spend) {
    add({ kind: 'expense', accountId: acct === 'chk' ? chkId : cardId, date: back(d), amountCents: cents, merchant, categoryId }, back(d));
  }

  // Earlier months, for Reports. Dated before the accounts were opened, so they are history only
  // and do not change any balance.
  const pattern: [number, string, string, number][] = [
    [1, 'Rent', 'cat_housing', 145000], [3, 'Whole Foods', 'cat_groceries', 6890], [4, 'Blue Bottle Coffee', 'cat_coffee', 575], [6, 'Shell', 'cat_fuel', 4630],
    [8, 'Corner Bistro', 'cat_dining', 4210], [9, 'Streaming', 'cat_subscriptions', 1549], [11, 'Trader Joe’s', 'cat_groceries', 5540], [13, 'Bookshop', 'cat_shopping', 3120],
    [15, 'Blue Bottle Coffee', 'cat_coffee', 575], [17, 'Whole Foods', 'cat_groceries', 7350], [18, 'Electricity', 'cat_utilities', 8600], [20, 'Cinema', 'cat_entertainment', 2800],
    [22, 'Phone', 'cat_internet', 6500], [24, 'Trader Joe’s', 'cat_groceries', 4980], [26, 'Shell', 'cat_fuel', 4390], [27, 'Corner Bistro', 'cat_dining', 3650],
  ];
  const { y: ty, m: tm } = parseISO(today);
  for (let k = 1; k <= 5; k++) {
    const { y, m } = addMonths(ty, tm, -k);
    for (const day of [5, 19]) {
      const d = clampDay(y, m, day);
      if (d < opened) add({ kind: 'income', accountId: chkId, date: d, amountCents: 186000, merchant: 'Paycheck', categoryId: 'cat_paycheck' }, d);
    }
    for (const [day, merchant, categoryId, cents] of pattern) {
      const d = clampDay(y, m, day);
      // small, fixed month-to-month variation so the charts are not perfectly flat
      const varied = categoryId === 'cat_housing' || categoryId === 'cat_subscriptions' || categoryId === 'cat_internet' ? cents : cents + ((k * 37 + day * 11) % 9) * 115 - 400;
      if (d < opened) add({ kind: 'expense', accountId: chkId, date: d, amountCents: varied, merchant, categoryId }, d);
    }
  }
  return { ...data, settings: { ...data.settings, txSinceBackup: 0 } };
}
