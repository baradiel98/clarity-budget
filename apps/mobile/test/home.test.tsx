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
    expect(ui.getByTestId('sts-next')).toHaveTextContent(X.safeToSpendNext);
    // Phase 4B.2: the recorded balance is the headline; Safe to Spend's own low is on its card, named by its span
    expect(ui.getByTestId('recorded-balance')).toHaveTextContent(X.recordedBalance);
    expect(ui.getByTestId('sts-low')).toHaveTextContent(`${X.stsLow}${X.stsLowAmount}`, { exact: false });
    expect(ui.getByTestId('lowest')).toHaveTextContent(`${X.lowest}${X.lowestSub}`, { exact: false });
    // repeats are hidden: the lowest before next income is this month's low; end of today is the recorded balance
    expect(ui.queryByTestId('lowest-before-income')).toBeNull();
    expect(ui.queryByTestId('end-of-day')).toBeNull();
    // the long "after the low point" sentence moved into Safe to Spend's "Why this number?"
    expect(ui.queryByTestId('sts-after')).toBeNull();
    expect(ui.queryByText(X.safeToSpendAfterLow)).toBeNull();
    const view = buildHomeView(data, SAMPLE_TODAY);
    const v = view.dashboard;
    await fireEvent.press(ui.getByLabelText('Why this number? Lowest balance this month'));
    expect(a.explain).toHaveBeenNthCalledWith(1, v.lowestThroughMonthEnd.explanation);
    const whys = ui.getAllByText('Why this number?');
    await fireEvent.press(whys[0]!); // recorded balance
    await fireEvent.press(whys[1]!); // Safe to Spend
    await fireEvent.press(whys[2]!); // projected month-end
    expect(a.explain).toHaveBeenNthCalledWith(2, v.recordedBalanceExplanation);
    expect(a.explain).toHaveBeenNthCalledWith(3, view.stsExplanation);
    expect(view.stsExplanation.summary).toContain(X.safeToSpendAfterLow);
    expect(a.explain).toHaveBeenNthCalledWith(4, v.monthEnd.explanation);
  });

  it('the hierarchy: recorded balance, then Safe to Spend, then month-end (screen order)', async () => {
    const ui = await show(data);
    const ids = ['recorded-balance', 'safe-to-spend', 'month-end'];
    const order = JSON.stringify(ui.toJSON());
    const at = ids.map((id) => order.indexOf(`"testID":"${id}"`));
    expect(at.every((x) => x >= 0)).toBe(true);
    expect([...at].sort((p, q) => p - q)).toEqual(at);
  });

  it('a shortfall (overdue bills, Jan 10, 2027): Short by, its low and the not-counted income stay on the card; repeats hidden', async () => {
    const ui = await show(data, '2027-01-10');
    expect(ui.getByTestId('safe-to-spend')).toHaveTextContent('Short by$1,536.89');
    expect(ui.getByTestId('sts-caption')).toHaveTextContent('What is scheduled is more than your cash and reserve cover through Feb 28. Your balance is lowest on Jan 10.');
    expect(ui.getByTestId('sts-low')).toHaveTextContent('Lowest through Feb 28 · Jan 10−$1,336.89', { exact: false });
    expect(ui.getByTestId('sts-excluded')).toHaveTextContent('4 income items are not counted because the amount is estimated, unknown or not yet recorded.');
    for (const id of ['lowest', 'lowest-before-income', 'end-of-day']) expect(ui.queryByTestId(id)).toBeNull(); // all −$1,336.89 on Jan 10
    expect(ui.getByTestId('recorded-balance')).toHaveTextContent('$2,871.23');
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

  it('Later · also counted in Safe to Spend: the Dec 1 rent is listed (Phase 4A)', async () => {
    const ui = await show(data);
    const later = ui.getByTestId('upcoming-later');
    expect(later).toHaveTextContent('Later · also counted in Safe to Spend', { exact: false });
    const rows = ui.getAllByTestId('upcoming-later-row');
    expect(rows).toHaveLength(X.upcomingLater.length);
    X.upcomingLater.forEach(([date, name, amount], i) => expect(rows[i]).toHaveTextContent(`${date}${name}${amount}`));
    expect(later).toHaveTextContent(X.upcomingLaterMore, { exact: false });
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
    expect(ui2.getByTestId('upcoming-empty')).toHaveTextContent('No bills, paychecks or planned expenses through Dec 31.'); // the Safe to Spend horizon (Phase 4A)
    expect(ui2.getByTestId('recent-empty')).toBeTruthy();
    expect(ui2.getByTestId('lowest-before-income')).toHaveTextContent('No income with a known amount is scheduled', { exact: false });
  });

  it('a seven-figure shortfall is shown in full (auto-fit, not cut)', async () => {
    const base = buildDemoWorkspace(SAMPLE_TODAY, SAMPLE_NOW);
    const big = { ...base.recurring.find((r) => r.name === 'Phone')!, id: 'big', name: 'Mortgage', amount: { type: 'fixed' as const, cents: 123456789 } };
    const ui = await show({ ...base, recurring: [...base.recurring, big] });
    const sts = ui.getByTestId('safe-to-spend');
    expect(sts).toHaveTextContent(/Short by\$\d,\d{3},\d{3}\.\d\d/); // seven figures, in full (the bill now counts in Nov and Dec)
    expect(ui.getByTestId('month-end').props.adjustsFontSizeToFit).toBe(true);
  });
});
