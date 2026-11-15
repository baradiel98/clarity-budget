import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 4A.11 through the real UI in Chromium (production build, sample data; demo mode, so no idle lock).
 * D1: the clock moves to Sun Jan 10, 2027, so the sample's $1,450 Rent due Dec 1 is overdue (40 days). A $1,450
 *     "OAKWOOD RENT" payment on Jan 8 paid it (38 days late: outside the default 31-day list). Linking it adds nothing:
 *     the recorded balance is unchanged and Safe to Spend rises by exactly the $1,450 overdue rent it no longer counts.
 * D2: a $65 Verizon payment linked to Phone, then the Phone bill deleted: the Edit form says so and Unlink still works.
 */
const SHOTS = process.env.SHOTS_DIR;
const go = (page: Page, path: string) => page.evaluate((p) => { history.pushState({}, '', p); dispatchEvent(new PopStateEvent('popstate')); scrollTo(0, 0); }, path);
// Safe to Spend reads "$422.17", or "Short by $1,536.89" when it is negative
const money = (t: string) => Math.round(Number(t.replace(/[^0-9.]/g, '')) * 100) * (/Short by|−|-/.test(t) ? -1 : 1);
async function sample(page: Page, iso = '2026-11-13T10:00:00') {
  await page.clock.setFixedTime(new Date(iso));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore sample data' }).click();
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,427.17');
}
async function expense(page: Page, amount: string, merchant: string, date: string) {
  await page.keyboard.press('n');
  const d = page.getByRole('dialog');
  await d.getByTestId('amount').fill(amount);
  await d.getByTestId('merchant').fill(merchant);
  await d.getByLabel('Account', { exact: true }).selectOption({ label: 'Everyday Checking' });
  await d.getByLabel('Date', { exact: true }).fill(date);
  // the form may suggest a link to a nearer occurrence (e.g. "OAKWOOD RENT" → the Jan 1 rent, a strong suggestion);
  // here the payment is for another one, so it is left unlinked
  const occ = d.getByTestId('occurrence-link').getByRole('checkbox');
  if (await occ.count()) await occ.uncheck();
  await d.getByTestId('save-tx').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test('D1: an overdue rent paid 38 days late: Show older transactions lists it (unselected, with the days); linking it adds nothing and stops counting the $1,450', async ({ page }) => {
  await sample(page);
  // move to Jan 10, 2027 (the app re-reads the date on focus)
  await page.clock.setFixedTime(new Date('2027-01-10T10:00:00'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expense(page, '1450', 'OAKWOOD RENT', '2027-01-08');
  await go(page, '/');
  const beforeText = await page.getByTestId('safe-to-spend').innerText();
  const before = money(beforeText);
  const recorded = await page.getByTestId('available-cash').innerText();
  const markRent = page.getByRole('button', { name: 'Mark paid: Rent' });
  await markRent.first().click();
  const d = page.getByRole('dialog');
  await expect(d.getByTestId('mark-paid-scheduled')).toHaveText('Rent · due Dec 1 · $1,450.00 · Everyday Checking');
  await expect(d.getByRole('radiogroup')).toHaveCount(0);
  await expect(d.getByTestId('mark-paid-not-listed')).toContainText('Not listed? If Rent was already paid some other way, Skip this occurrence in Planning instead of recording it again.');
  await d.getByTestId('mark-paid-show-older').click();
  await expect(d.getByTestId('mark-paid-older-hint')).toContainText('transactions up to 62 days after the due date are listed too. Nothing is selected for you.');
  const option = d.getByLabel(/^Jan 8 · OAKWOOD RENT · −\$1,450\.00 · Everyday Checking · posted · .*38 days after the due date$/);
  await expect(option).not.toBeChecked();
  await option.check();
  await expect(d.getByTestId('mark-paid-not-listed')).toHaveCount(0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/4a11-01-show-older.png`, fullPage: false });
  await d.getByTestId('save-tx').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const afterText = await page.getByTestId('safe-to-spend').innerText();
  const after = money(afterText);
  // e.g. "Short by $2,986.89" → "Short by $1,536.89": the overdue $1,450 Dec 1 rent is no longer counted
  expect(after - before).toBe(145000);
  expect(await page.getByTestId('available-cash').innerText()).toBe(recorded); // $1,421.23 before and after
  await go(page, '/transactions');
  await expect(page.locator('table.data tbody tr').filter({ hasText: 'OAKWOOD RENT' })).toHaveCount(1);
});

test('D2: the Phone bill deleted after its payment was linked: the Edit form explains and Unlink still works; the transaction is unchanged', async ({ page }) => {
  await sample(page);
  await expense(page, '65', 'Verizon Wireless', '2026-11-13');
  await page.getByRole('button', { name: 'Mark paid: Phone' }).click();
  const d = page.getByRole('dialog');
  await d.getByLabel(/^Nov 13 · Verizon Wireless · −\$65\.00/).check();
  await d.getByTestId('save-tx').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await go(page, '/planning');
  await page.getByRole('button', { name: 'Delete Phone' }).click();
  await go(page, '/transactions');
  await page.getByRole('button', { name: 'Verizon Wireless' }).click();
  const e = page.getByRole('dialog');
  await expect(e.getByTestId('linked-occurrence')).toHaveAttribute('data-state', 'item_missing');
  await expect(e.getByTestId('linked-occurrence')).toContainText("Linked to a scheduled payment whose scheduled item was deleted. Unlink it to clear the link (it isn't moved to any other item).");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/4a11-02-missing-item.png`, fullPage: false });
  await e.getByRole('button', { name: 'Unlink' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Verizon Wireless' }).click();
  await expect(page.getByRole('dialog').getByTestId('linked-occurrence')).toHaveCount(0);
  await expect(page.getByRole('dialog').getByTestId('amount')).toHaveValue('65.00');
  await expect(page.locator('table.data tbody tr').filter({ hasText: 'Verizon Wireless' })).toHaveCount(1);
});
