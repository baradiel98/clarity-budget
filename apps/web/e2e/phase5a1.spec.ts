import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 5A.1 through the real UI in Chromium (production build, sample data; today Fri, Nov 13, 2026).
 * A $6,000 roof repair is planned from Savings (it holds $5,200) on Nov 20. Hand-worked:
 *   Savings' own view: $5,200.00 − $6,000.00 = −$800.00 on Nov 20 (before 5A.1 it showed $0.00); Nov 30 + $250.00 = −$550.00.
 *   All spendable cash: the $800.00 Savings can't cover is counted against it: $4,639.83 − $800.00 = $3,839.83 on Nov 20.
 *   Everyday Checking: not reduced by it (Clarity doesn't choose which spendable account covers it).
 */
const go = (page: Page, path: string) => page.evaluate((p) => { history.pushState({}, '', p); dispatchEvent(new PopStateEvent('popstate')); scrollTo(0, 0); }, path);
const SHOTS = process.env.SHOTS_DIR;

test('a payment Savings can only partly cover: its own balance, the part counted against spendable accounts, explained', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-13T10:00:00'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore sample data' }).click();
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,427.17');
  await page.keyboard.press('n');
  const d = page.getByRole('dialog');
  await d.getByTestId('amount').fill('6000');
  await d.getByTestId('merchant').fill('Roof repair');
  await d.getByLabel('Account', { exact: true }).selectOption({ label: 'Savings' });
  await d.getByLabel('Date').fill('2026-11-20');
  await d.getByTestId('save-tx').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await go(page, '/planning');
  await page.getByTestId('ledger-scope').selectOption({ label: 'Savings' });
  const nov20 = page.locator('.tl-day').filter({ hasText: 'Fri, Nov 20' });
  await expect(nov20.getByTestId('tl-day-end')).toContainText('−$800.00');
  await expect(nov20.locator('.tl-item').filter({ hasText: 'Roof repair' })).toContainText('−$6,000.00');
  await expect(nov20.getByTestId('covered-badge')).toHaveText('$800.00 counted against spendable accounts');
  await expect(page.locator('.tl-day').filter({ hasText: 'Mon, Nov 30' }).getByTestId('tl-day-end')).toContainText('−$550.00');
  await nov20.getByTestId('day-details').click();
  const line = page.getByRole('dialog').locator('.explain-line').filter({ hasText: 'Roof repair' });
  await expect(line).toContainText('−$6,000.00');
  await expect(line.getByTestId('balance-after')).toContainText('−$800.00');
  await expect(line).toContainText("Savings can cover $5,200.00 of it; the other $800.00 has to come from your spendable accounts (Clarity hasn't chosen which).");
  await expect(page.getByRole('dialog')).toContainText('in the order the forecast applies it to this account');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/5a1-01-savings-details.png`, fullPage: false });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // all spendable cash: −$800.00, explained; the summary says money out is listed largest first
  await page.getByTestId('ledger-scope').selectOption({ label: 'All spendable cash' });
  const cash20 = page.locator('.tl-day').filter({ hasText: 'Fri, Nov 20' });
  await expect(cash20.getByTestId('tl-day-end')).toContainText('$3,839.83');
  await cash20.getByTestId('day-details').click();
  await expect(page.getByRole('dialog').locator('.explain-line').filter({ hasText: 'Roof repair' })).toContainText('−$800.00');
  await expect(page.getByRole('dialog')).toContainText('listed largest first');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // Everyday Checking isn't reduced by it
  await page.getByTestId('ledger-scope').selectOption({ label: 'Everyday Checking' });
  await expect(page.getByTestId('timeline')).not.toContainText('Roof repair');
});
