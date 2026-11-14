import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 4A.5.10 through the real UI: a statement row with the same amount as a pending transaction needs an explicit
 * decision; "Same transaction" posts the pending one once and adds nothing; "Different transaction" imports it as well.
 * Sample data: Safe to Spend $2,427.17, Everyday Checking posted $2,871.23. Today Fri, Nov 13, 2026.
 */
async function sample(page: Page) {
  await page.clock.setFixedTime(new Date('2026-11-13T10:00:00'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore sample data' }).click();
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,427.17');
}
const go = (page: Page, path: string) => page.evaluate((p) => { history.pushState({}, '', p); dispatchEvent(new PopStateEvent('popstate')); scrollTo(0, 0); }, path);
async function pendingRefund(page: Page) {
  await page.keyboard.press('n');
  const d = page.getByRole('dialog');
  await d.getByRole('button', { name: 'Refund', exact: true }).click();
  await d.getByTestId('amount').fill('300');
  await d.getByTestId('merchant').fill('Store return');
  await d.getByLabel('Account', { exact: true }).selectOption({ label: 'Everyday Checking' });
  await d.getByRole('button', { name: 'Notes, split or pending' }).click();
  await d.getByLabel(/Pending/).check();
  await d.getByTestId('save-tx').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
async function importRow(page: Page) {
  await page.getByRole('link', { name: 'Import Statement' }).click();
  await page.getByLabel('Import into account').selectOption({ label: 'Everyday Checking' });
  await page.getByTestId('import-file').setInputFiles({ name: 'nov.csv', mimeType: 'text/csv', buffer: Buffer.from('Date,Description,Amount,Balance\n2026-11-13,AMAZON REFUND 8812,300.00,3171.23\n') });
  await page.getByTestId('to-review').click();
}

test('"Same transaction": the pending refund is posted once, nothing is added, and it is labelled as matched', async ({ page }) => {
  await sample(page);
  await pendingRefund(page);
  await importRow(page);
  await expect(page.getByLabel('Import row 2')).toBeDisabled(); // no silent include: a decision is required
  const choice = page.getByTestId('pending-choice-2');
  await choice.getByLabel('Same transaction: mark “Store return” posted (nothing new is added)').check();
  await expect(page.getByTestId('reconciliation')).toContainText('Matches');
  await page.getByTestId('commit-import').click();
  await expect(page.getByTestId('import-done')).toBeVisible();
  await go(page, '/');
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,727.17'); // +300 once
  await expect(page.getByTestId('available-cash')).toHaveText('$3,171.23');
  await go(page, '/transactions');
  await page.getByLabel('Search transactions').fill('Store return');
  await expect(page.getByTestId('statement-match')).toHaveText('Matched to statement');
  await expect(page.locator('table.data tbody tr:not(.group)')).toHaveCount(1);
});

test('"Different transaction": both are kept; the pending one stays pending (not spendable)', async ({ page }) => {
  await sample(page);
  await pendingRefund(page);
  await importRow(page);
  await page.getByTestId('pending-choice-2').getByLabel('Different transaction: import it as well').check();
  await expect(page.getByTestId('reconciliation')).toContainText('Matches');
  await page.getByTestId('commit-import').click();
  await expect(page.getByTestId('import-done')).toBeVisible();
  await go(page, '/');
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,727.17'); // the imported +300; the pending +300 not yet
  await expect(page.getByTestId('available-cash')).toHaveText('$3,471.23'); // recorded includes both
});
