import { fireEvent, render, within } from '@testing-library/react-native';
import { buildDemoWorkspace, buildHomeView } from '@clarity/data';
import { STATUS_HELP, UPCOMING_NOTE, type WorkspaceData } from '@clarity/shared';

jest.mock('expo-crypto', () => ({ getRandomBytes: (n: number) => new Uint8Array(require('node:crypto').randomBytes(n)) }));
jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('@react-native-community/datetimepicker', () => () => null);

import { HomeView, type HomeActions } from '../src/features/Home';
// The same fixture the web e2e test and the engine test use (packages/data/test/fixtures).
import { HOME_SAMPLE as X, SAMPLE_NOW, SAMPLE_TODAY } from '../../../packages/data/test/fixtures/home-sample-nov13';

const noBackup = { due: false, reason: null };
const actions = (): HomeActions => ({ explain: jest.fn(), open: jest.fn(), add: jest.fn() });
const show = (data: WorkspaceData, today = SAMPLE_TODAY, a = actions()) => render(<HomeView data={data} today={today} backup={noBackup} actions={a} />);

describe('mobile Home shows the same figures as web (sample data, Nov 13, 2026)', () => {
  const data = buildDemoWorkspace(SAMPLE_TODAY, SAMPLE_NOW);

  it('headline figures and their explanations', async () => {
    const a = actions();
    const ui = await show(data, SAMPLE_TODAY, a);
    expect(ui.getByTestId('month-end')).toHaveTextContent(X.monthEnd);
    expect(ui.getByTestId('month-end-delta')).toHaveTextContent(X.monthEndDelta);
    expect(ui.getByTestId('safe-to-spend')).toHaveTextContent(X.safeToSpend);
    expect(ui.getByText(X.safeToSpendLine)).toBeTruthy();
    expect(ui.getByTestId('sts-after')).toHaveTextContent(X.safeToSpendAfterLow);
    const stat = (id: string) => ui.getByTestId(id);
    expect(stat('recorded-balance')).toHaveTextContent(`Current recorded balance${X.recordedBalance}`, { exact: false });
    expect(stat('lowest')).toHaveTextContent(`${X.lowest}${X.lowestSub}`, { exact: false });
    expect(stat('lowest-before-income')).toHaveTextContent(`${X.lowestBeforeIncome}${X.lowestBeforeIncomeSub}`, { exact: false });
    expect(stat('end-of-day')).toHaveTextContent(`${X.endOfDay}${X.endOfDaySub}`, { exact: false });
    // every figure opens its own explanation from the engine
    const v = buildHomeView(data, SAMPLE_TODAY).dashboard;
    await fireEvent.press(ui.getByLabelText('Why this number? Lowest projected balance'));
    await fireEvent.press(ui.getByLabelText('Why this number? Projected end of today'));
    expect(a.explain).toHaveBeenNthCalledWith(1, v.lowestThroughMonthEnd.explanation);
    expect(a.explain).toHaveBeenNthCalledWith(2, v.endOfDay.explanation);
  });

  it('Upcoming: dates, statuses, ≈ for estimates, full names, and status help on request', async () => {
    const ui = await show(data);
    expect(ui.getByText(`Upcoming · through ${X.upcomingUntil}`)).toBeTruthy();
    expect(ui.getByText(UPCOMING_NOTE)).toBeTruthy();
    const rows = ui.getAllByTestId('upcoming-row');
    expect(rows).toHaveLength(X.upcoming.length);
    X.upcoming.forEach(([date, name, status, amount], i) => {
      expect(rows[i]).toHaveTextContent(`${name}${date}${status}${amount}`);
    });
    expect(ui.queryByTestId('status-help')).toBeNull();
    await fireEvent.press(ui.getByText('What do these labels mean?'));
    const help = ui.getByTestId('status-help');
    expect(help).toHaveTextContent(STATUS_HELP.estimated(false), { exact: false });
    expect(help).toHaveTextContent(STATUS_HELP.expected(true), { exact: false });
    expect(help).toHaveTextContent(STATUS_HELP.expected(false), { exact: false });
  });

  it('Recent transactions, newest first', async () => {
    const ui = await show(data);
    const rows = ui.getAllByTestId('recent-row');
    expect(rows).toHaveLength(X.recent.length);
    X.recent.forEach(([date, title, cat, amount], i) => expect(rows[i]).toHaveTextContent(`${title}${date} · ${cat}${amount}`));
  });

  it('tapping an upcoming bill opens Add to mark it paid; tapping a recent row edits it', async () => {
    const a = actions();
    const ui = await show(data, SAMPLE_TODAY, a);
    await fireEvent.press(ui.getAllByTestId('upcoming-row')[2]!);
    expect(a.add).toHaveBeenCalledWith(expect.objectContaining({ occurrenceName: 'Phone', amountCents: 6500 }));
    await fireEvent.press(ui.getAllByTestId('recent-row')[0]!);
    expect(a.add).toHaveBeenLastCalledWith({ editId: buildHomeView(data, SAMPLE_TODAY).recent[0]!.id });
  });
});

describe('mobile Home edge cases', () => {
  it('long names are never truncated; empty Upcoming and Recent say so', async () => {
    const base = buildDemoWorkspace(SAMPLE_TODAY, SAMPLE_NOW);
    const long = 'Comcast Xfinity Internet, TV and Home Phone Bundle Monthly Payment';
    const data: WorkspaceData = { ...base, recurring: base.recurring.map((r) => (r.name === 'Phone' ? { ...r, name: long } : r)) };
    const ui = await show(data);
    const row = ui.getAllByTestId('upcoming-row').find((r) => within(r).queryByText(long))!;
    expect(within(row).getByText(long).props.numberOfLines).toBeUndefined();

    const empty: WorkspaceData = { ...base, recurring: [], transactions: [] };
    const ui2 = await show(empty);
    expect(ui2.getByTestId('upcoming-empty')).toHaveTextContent('No bills, paychecks or planned expenses through Nov 30.');
    expect(ui2.getByTestId('recent-empty')).toBeTruthy();
    expect(ui2.getByTestId('lowest-before-income')).toHaveTextContent('No income with a known amount is scheduled', { exact: false });
  });

  it('a seven-figure shortfall is shown in full (auto-fit, not cut)', async () => {
    const base = buildDemoWorkspace(SAMPLE_TODAY, SAMPLE_NOW);
    const big = { ...base.recurring.find((r) => r.name === 'Phone')!, id: 'big', name: 'Mortgage', amount: { type: 'fixed' as const, cents: 123456789 } };
    const ui = await show({ ...base, recurring: [...base.recurring, big] });
    const sts = ui.getByTestId('safe-to-spend');
    expect(sts).toHaveTextContent(/Short by\$1,2\d\d,\d{3}\.\d\d/);
    expect(ui.getByTestId('month-end').props.adjustsFontSizeToFit).toBe(true);
  });
});
