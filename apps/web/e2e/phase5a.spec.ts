import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 5A through the real UI in Chromium (production build, sample data; today Fri, Nov 13, 2026). Planning's
 * schedule can be shown per account; every day opens "Day details": the start, each item with the balance after it,
 * and the end, from the same forecast. Expected values are worked out by hand from the sample:
 *   Everyday Checking: opened Oct 14 with $1,000.00; 11 transactions since → $2,871.23 recorded today (Home's figure);
 *   Nov 18 Electricity ≈ −$91.40 → $2,779.83; Nov 19 Paycheck +$1,860.00 → $4,639.83.
 */
const SHOTS = process.env.SHOTS_DIR;
const go = (page: Page, path: string) => page.evaluate((p) => { history.pushState({}, '', p); dispatchEvent(new PopStateEvent('popstate')); scrollTo(0, 0); }, path);
async function sample(page: Page, width = 1440) {
  await page.clock.setFixedTime(new Date('2026-11-13T10:00:00'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width, height: 1000 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore sample data' }).click();
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,427.17');
}
const details = (page: Page, date: string, scope: string) => page.getByRole('button', { name: `Day details: ${date}, ${scope}` });
const lines = (page: Page) => page.getByRole('dialog').locator('.explain-line');

test('all spendable cash and one account: each day adds up, today starts from the opening balance', async ({ page }) => {
  await sample(page);
  await go(page, '/planning');
  const scope = page.getByTestId('ledger-scope');
  await expect(scope).toHaveValue('cash');
  // today is listed even with nothing scheduled, so how it starts can be opened
  await details(page, 'Fri, Nov 13', 'All spendable cash').click();
  await expect(lines(page).filter({ hasText: 'Current recorded balance' })).toContainText('$2,871.23');
  await expect(lines(page).filter({ hasText: 'End of day' })).toContainText('$2,871.23');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await scope.selectOption({ label: 'Everyday Checking' });
  await expect(page.getByTestId('timeline')).toContainText('Electricity');
  // Nov 18 from the keyboard
  await details(page, 'Wed, Nov 18', 'Everyday Checking').focus();
  await page.keyboard.press('Enter');
  const d = page.getByRole('dialog');
  await expect(d).toContainText('Wed, Nov 18 · Everyday Checking');
  await expect(lines(page).filter({ hasText: 'Start of day' })).toContainText('$2,871.23');
  const elec = lines(page).filter({ hasText: 'Electricity' });
  await expect(elec).toContainText('−$91.40');
  await expect(elec.getByTestId('balance-after')).toContainText('$2,779.83');
  await expect(elec).toContainText('Estimated');
  await expect(lines(page).filter({ hasText: 'End of day' })).toContainText('$2,779.83');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/5a-01-day-details-1440.png`, fullPage: false });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // today, for the account: the trail from the opening balance to today's recorded balance
  await details(page, 'Fri, Nov 13', 'Everyday Checking').click();
  await expect(lines(page).first()).toContainText('Opening balance (Oct 14)');
  await expect(lines(page).first()).toContainText('$1,000.00');
  // the last of the 11 (Shell, Nov 10; the sample has two Shell purchases) ends at today's recorded balance
  await expect(lines(page).filter({ hasText: 'Shell' }).getByTestId('balance-after').last()).toContainText('$2,871.23');
  await expect(lines(page).filter({ hasText: 'Recorded balance today' })).toContainText('$2,871.23');
  await expect(d).toContainText("A confirmed balance is the bank's posted balance");
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // looking changed nothing
  await go(page, '/');
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,427.17');
  await expect(page.getByTestId('available-cash')).toHaveText('$2,871.23');
});

test('groceries recorded today: counted once, $2,871.23 → $2,786.23; every later day moves by exactly $85.00', async ({ page }) => {
  await sample(page);
  await page.keyboard.press('n');
  const d = page.getByRole('dialog');
  await d.getByTestId('amount').fill('85');
  await d.getByTestId('merchant').fill('Groceries');
  await d.getByLabel('Account', { exact: true }).selectOption({ label: 'Everyday Checking' });
  await d.getByTestId('save-tx').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await go(page, '/planning');
  await page.getByTestId('ledger-scope').selectOption({ label: 'Everyday Checking' });
  await details(page, 'Fri, Nov 13', 'Everyday Checking').click();
  const g = lines(page).filter({ hasText: 'Groceries' });
  await expect(g).toContainText('−$85.00');
  await expect(g.getByTestId('balance-after')).toContainText('$2,786.23');
  await expect(g).toContainText('Recorded');
  await expect(lines(page).filter({ hasText: 'End of day' })).toContainText('$2,786.23');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // $2,779.83 − $85.00 = $2,694.83 on Nov 18
  await details(page, 'Wed, Nov 18', 'Everyday Checking').click();
  await expect(lines(page).filter({ hasText: 'End of day' })).toContainText('$2,694.83');
});

test('a card is shown as the amount owed, before unrecorded interest; 390px fits without sideways scrolling', async ({ page }) => {
  await sample(page, 390);
  await go(page, '/planning');
  await page.getByTestId('ledger-scope').selectOption({ label: 'Visa Card' });
  await expect(page.getByTestId('ledger-card-note')).toContainText("Interest and fees you haven't recorded aren't included.");
  await expect(page.getByTestId('tl-day-end').first()).toContainText('Owed');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/5a-02-card-390.png`, fullPage: false });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByTestId('day-details').first().click();
  await expect(page.getByRole('dialog')).toContainText('owed');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/5a-03-card-details-390.png`, fullPage: false });
});
