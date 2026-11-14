import { render } from '@testing-library/react-native';
import { buildDemoWorkspace, engineInput } from '@clarity/data';
import { buildDashboard } from '@clarity/engine';
import type { Account, RecurringItem, WorkspaceData } from '@clarity/shared';

jest.mock('expo-crypto', () => ({ getRandomBytes: (n: number) => new Uint8Array(require('node:crypto').randomBytes(n)) }));
jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('@react-native-community/datetimepicker', () => () => null);

import { HomeView, type HomeActions } from '../src/features/Home';
import { WarningList } from '../src/ui/WarningList';
import { SAMPLE_NOW, SAMPLE_TODAY } from '../../../packages/data/test/fixtures/home-sample-nov13';

/**
 * Phase 4A.4.2 on mobile: the same scenario as apps/web/e2e/phase4a42.spec.ts (sample data + an empty savings
 * account with six $100 transfers to checking) plus a Cash account paying twelve $100 bills.
 * Home shows five warnings and "N more in Planning"; Planning's list shows every one, with every date.
 */
const t = SAMPLE_NOW;
const acct = (id: string, name: string, type: Account['type']): Account => ({ id, name, type, currency: 'USD', openingBalanceCents: 0, openingDate: SAMPLE_TODAY, spendable: type !== 'savings', archived: false, createdAt: t, updatedAt: t });
const once = (id: string, name: string, kind: RecurringItem['kind'], accountId: string, date: string, cents: number, toAccountId?: string): RecurringItem =>
  ({ id, name, kind, accountId, ...(toAccountId ? { toAccountId } : {}), categoryId: null, schedule: { freq: 'once', date }, amount: { type: 'fixed', cents }, weekendRule: 'none', startDate: SAMPLE_TODAY, trackFrom: SAMPLE_TODAY, paused: false, createdAt: t, updatedAt: t });

function scenario(): WorkspaceData {
  const d = buildDemoWorkspace(SAMPLE_TODAY, SAMPLE_NOW);
  const chk = d.accounts.find((a) => a.name === 'Everyday Checking')!.id;
  const tops = Array.from({ length: 6 }, (_, k) => once(`top${k}`, `Top up ${k + 1}`, 'transfer', 'empty', `2026-11-${String(16 + k).padStart(2, '0')}`, 10000, chk));
  const bills = Array.from({ length: 12 }, (_, k) => {
    const day = 14 + k * 3;
    return once(`cb${k}`, `Cash bill ${k + 1}`, 'bill', 'cash', day <= 30 ? `2026-11-${String(day).padStart(2, '0')}` : `2026-12-${String(day - 30).padStart(2, '0')}`, 10000);
  });
  return { ...d, accounts: [...d.accounts, acct('empty', 'Empty savings', 'savings'), acct('cash', 'Cash', 'cash')], recurring: [...d.recurring, ...tops, ...bills] };
}

describe('complete warning visibility on mobile', () => {
  const data = scenario();
  const warnings = buildDashboard(engineInput(data, SAMPLE_TODAY)).warnings;

  it('Home shows five warnings and says how many more are in Planning', async () => {
    expect(warnings.length).toBe(7); // 6 unfunded transfers + 1 Cash shortfall warning (sample data has none of its own)
    const actions: HomeActions = { explain: jest.fn(), open: jest.fn(), add: jest.fn() };
    const ui = await render(<HomeView data={data} today={SAMPLE_TODAY} backup={{ due: false, reason: null }} actions={actions} />);
    expect(ui.getByText('2 more in Planning')).toBeTruthy();
  });

  it('the Planning list shows every warning and every date (the same list the web shows)', async () => {
    const ui = await render(<WarningList warnings={warnings} currency="USD" />);
    expect(ui.getAllByTestId('warning-item')).toHaveLength(warnings.length);
    for (const w of warnings) expect(ui.getByText(w.title)).toBeTruthy();
    // Cash: 12 dates, −$100 … −$1,200; the short text says "7 more" but the list shows all twelve
    expect(ui.getAllByTestId('warning-date')).toHaveLength(12);
    expect(ui.getByText(/Lowest: −\$1,200\.00 on Dec 17/)).toBeTruthy();
  });
});
