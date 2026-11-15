import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 4A.9 through the real UI in Chromium (production build, sample data; today Fri, Nov 13, 2026; Safe to Spend
 * $2,427.17). The sample schedules Electricity, a variable bill estimated at $91.40 due Nov 18, from Everyday Checking.
 * - "ONLINE PMT 7781 −$100" (Nov 12): within 25% and 7 days of it, but nothing names it → suggested, NOT ticked;
 *   imported as an expense: Checking −100, Electricity still due → $2,327.17.
 * - "CITY ELECTRICITY CO −$91.40" (Nov 12): the bill's name is in the description → ticked; imported and linked:
 *   Checking −91.40, Electricity paid (no longer forecast) → $2,427.17.
 */
const SHOTS = process.env.SHOTS_DIR;
const go = (page: Page, path: string) => page.evaluate((p) => { history.pushState({}, '', p); dispatchEvent(new PopStateEvent('popstate')); scrollTo(0, 0); }, path);
async function sample(page: Page) {
  await page.clock.setFixedTime(new Date('2026-11-13T10:00:00'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore sample data' }).click();
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,427.17');
}
async function review(page: Page, csv: string) {
  await page.getByRole('link', { name: 'Import Statement' }).click();
  await page.getByLabel('Import into account').selectOption({ label: 'Everyday Checking' });
  await page.getByTestId('import-file').setInputFiles({ name: 'nov.csv', mimeType: 'text/csv', buffer: Buffer.from('Date,Description,Amount,Balance\n' + csv) });
  await page.getByTestId('to-review').click();
  await expect(page.getByTestId('review-table')).toBeVisible();
}

test('amount and date only: the Electricity suggestion is shown but not ticked; the import leaves the bill due → $2,327.17', async ({ page }) => {
  await sample(page);
  await review(page, '2026-11-12,ONLINE PMT 7781,-100.00,2771.23\n');
  await expect(page.getByLabel('Row 2 pays Electricity')).not.toBeChecked();
  await expect(page.getByTestId('occurrence-2')).toContainText('Electricity?');
  await expect(page.getByTestId('occurrence-weak-2')).toHaveText('Could be Electricity (due Nov 18): only the amount and date are close. Not linked unless you tick it.');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/4a9-01-weak-suggestion.png`, fullPage: false });
  await page.getByTestId('commit-import').click();
  await expect(page.getByTestId('import-result')).toHaveText('1 new transaction imported');
  await go(page, '/');
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,327.17');
});

test('the bill\'s name in the description: ticked by default; imported and linked → $2,427.17', async ({ page }) => {
  await sample(page);
  await review(page, '2026-11-12,CITY ELECTRICITY CO,-91.40,2779.83\n');
  await expect(page.getByLabel('Row 2 pays Electricity')).toBeChecked();
  await expect(page.getByTestId('occurrence-weak-2')).toHaveCount(0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/4a9-02-strong-suggestion.png`, fullPage: false });
  await page.getByTestId('commit-import').click();
  await expect(page.getByTestId('import-result')).toHaveText('1 new transaction imported');
  await go(page, '/');
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,427.17');
});

test('Add form: a $100 expense near the Electricity due date is offered but not ticked, with the reason', async ({ page }) => {
  await sample(page);
  await page.keyboard.press('n');
  const d = page.getByRole('dialog');
  await d.getByTestId('amount').fill('100');
  await d.getByTestId('merchant').fill('Hardware store');
  await d.getByLabel('Account', { exact: true }).selectOption({ label: 'Everyday Checking' });
  await d.getByLabel('Date', { exact: true }).fill('2026-11-13');
  await expect(d.getByTestId('occurrence-link').getByRole('checkbox')).not.toBeChecked();
  await expect(d.getByTestId('occurrence-weak')).toContainText("Only the amount and date are close; the description doesn't mention it.");
  await d.getByTestId('merchant').fill('Electricity');
  await expect(d.getByTestId('occurrence-link').getByRole('checkbox')).toBeChecked();
});
