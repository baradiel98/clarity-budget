import { addDays, endOfMonth, makeIdFactory, type ISODate, type WorkspaceData } from '@clarity/shared';
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
  const chk = createAccount({ ...ctx(), today: back(30) }, { name: 'Everyday Checking', type: 'checking', currentBalanceCents: 284250 });
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
  ];
  for (const [d, merchant, categoryId, cents, acct] of spend) {
    const accountId = acct === 'chk' ? chk.account.id : card.account.id;
    run(addTransaction({ ...ctx(), now: now - d * 86_400_000 }, { kind: 'expense', accountId, date: back(d), amountCents: cents, merchant, categoryId }).ops);
  }
  return { ...data, settings: { ...data.settings, txSinceBackup: 0 } };
}
