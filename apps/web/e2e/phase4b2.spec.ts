import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 4B.2 through the real UI in Chromium (production build). Home hierarchy and repeated figures only: every amount
 * below is the engine's and the same as before this phase.
 */
const SHOTS = process.env.SHOTS_DIR;
async function sample(page: Page, width: number, at?: string) {
  await page.clock.setFixedTime(new Date('2026-11-13T10:00:00'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width, height: 1000 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore sample data' }).click();
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,427.17');
  if (at) {
    await page.clock.setFixedTime(new Date(at));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  }
}
const y = async (page: Page, id: string) => (await page.getByTestId(id).boundingBox())!.y;

for (const w of [1440, 390]) {
  test(`${w}px: recorded balance is the headline, Safe to Spend next, month-end supporting; each figure once`, async ({ page }) => {
    await sample(page, w);
    const balance = page.getByTestId('available-cash');
    await expect(balance).toHaveText('$2,871.23');
    await expect(page.getByRole('region', { name: 'Current recorded balance' })).toContainText('Across spendable accounts · $247.66 owed on cards');
    // sizes: headline > Safe to Spend > month-end
    const size = (id: string) => page.getByTestId(id).evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
    const [b, s, m] = [await size('available-cash'), await size('safe-to-spend'), await size('month-end')];
    expect(b).toBeGreaterThan(s);
    expect(s).toBeGreaterThan(m);
    // order: on one column Safe to Spend comes right after the balance, before the forecast
    if (w < 1080) expect((await y(page, 'available-cash')) < (await y(page, 'safe-to-spend')) && (await y(page, 'safe-to-spend')) < (await y(page, 'month-end'))).toBe(true);
    else expect(Math.abs((await y(page, 'available-cash')) - (await y(page, 'safe-to-spend')))).toBeLessThan(60); // side by side
    // the two lows, named by their spans; repeats hidden
    await expect(page.getByTestId('lowest-month')).toContainText('Lowest balance this month');
    await expect(page.getByTestId('lowest-month')).toContainText('$2,779.83Nov 18 · through Nov 30');
    await expect(page.getByTestId('sts-low')).toHaveText('Lowest through Dec 31 · Dec 1$2,627.17');
    await expect(page.getByTestId('lowest-before-income')).toHaveCount(0);
    await expect(page.getByTestId('end-of-day')).toHaveCount(0);
    await expect(page.locator('main')).not.toContainText('Same low point');
    await expect(page.locator('main')).not.toContainText('Nothing else is scheduled today');
    // the long breakdown left the card
    await expect(page.getByTestId('sts-breakdown')).toHaveCount(0);
    await expect(page.getByTestId('sts-after')).toHaveCount(0);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/4b2-${w}-sample.png`, fullPage: w < 1080 });
    // every figure still has its explanation
    for (const label of ['Current recorded balance', 'Projected month-end balance', 'Lowest balance this month']) {
      await page.getByRole('button', { name: `Why this number? ${label}` }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
    }
  });
}

test('Safe to Spend\'s "Why this number?" holds the full calculation, every item with its date and reason, and the later-items sentence', async ({ page }) => {
  await sample(page, 1440);
  await page.getByTestId('why-sts').click();
  const dlg = page.getByRole('dialog');
  await expect(dlg).toContainText('Current recorded balance$2,871.23');
  for (const t of ['Paycheck', 'Nov 19', '+$1,860.00', 'Rent', 'Dec 1', '−$1,450.00', 'Lowest point: Dec 1$2,627.17', 'Minimum cash reserve−$200.00', 'Safe to Spend$2,427.17', "after the lowest point, doesn't lower it"]) await expect(dlg).toContainText(t);
  await expect(dlg).toContainText("Electricity, Phone, Card payment and Savings ($421.89) come after Dec 1, once $5,580.00 has come in. Your balance stays at or above the Dec 1 low through Dec 31, so they don't lower Safe to Spend.");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/4b2-1440-why-sts.png` });
});

test('a shortfall (overdue bills, Jan 10, 2027): Short by, its status, its low and the not-counted income stay visible', async ({ page }) => {
  await sample(page, 1440, '2027-01-10T10:00:00');
  await expect(page.getByTestId('safe-to-spend')).toHaveText('Short by $1,536.89');
  await expect(page.locator('.card.sts')).toContainText('What is scheduled is more than your cash and reserve cover through Feb 28. Your balance is lowest on Jan 10.');
  await expect(page.getByTestId('sts-low')).toHaveText('Lowest through Feb 28 · Jan 10−$1,336.89');
  await expect(page.getByTestId('sts-excluded')).toHaveText('4 income items are not counted because the amount is estimated, unknown or not yet recorded.');
  await expect(page.getByTestId('sts-next')).toBeVisible();
  // this month's low, the low before income and end of today are all that same −$1,336.89 today: shown once
  for (const id of ['lowest-month', 'lowest-before-income', 'end-of-day']) await expect(page.getByTestId(id)).toHaveCount(0);
  await expect(page.getByTestId('available-cash')).toHaveText('$2,871.23');
  await expect(page.getByRole('heading', { name: 'Needs attention' })).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/4b2-1440-shortfall.png` });
});

test('first run: no figure repeats the balance (it was shown 7 times before)', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-15T10:00:00'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByLabel('Passphrase', { exact: true }).fill('correct horse battery staple');
  await page.getByLabel('Confirm passphrase').fill('correct horse battery staple');
  await page.getByRole('checkbox', { name: /Create a recovery key/ }).uncheck();
  await page.getByRole('checkbox', { name: /cannot be recovered/ }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Current checking balance').fill('2400');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Next payday').fill('2026-11-22');
  await page.getByLabel('Usual paycheck amount (optional)').fill('1800');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Name').fill('Rent');
  await page.getByLabel('Amount').fill('1200');
  await page.getByLabel('Due date').fill('2026-12-01');
  await page.getByRole('button', { name: 'See my overview' }).click();
  await page.getByTestId('go-dashboard').click();
  await expect(page.getByTestId('available-cash')).toHaveText('$2,400.00');
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,400.00');
  await expect(page.getByTestId('month-end')).toHaveText('$4,200.00');
  for (const id of ['sts-low', 'lowest-month', 'lowest-before-income', 'end-of-day']) await expect(page.getByTestId(id)).toHaveCount(0);
  // $2,400.00 appears as the balance and as Safe to Spend (two different answers), plus the chart's own low label
  const overview = await page.locator('.overview').innerText();
  expect(overview.split('$2,400.00').length - 1).toBe(3);
  await expect(page.getByTestId('forecast-chart')).toContainText('Lowest $2,400.00');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/4b2-1280-first-run.png`, fullPage: true });
});
