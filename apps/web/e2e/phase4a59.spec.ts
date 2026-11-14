import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 4A.5.9 through the real UI: a negative savings balance reduces Safe to Spend; a partial pending match in
 * Update balance; a statement row that is a pending deposit clearing. Sample data: Safe to Spend $2,427.17,
 * Everyday Checking posted $2,871.23. Today Fri, Nov 13, 2026.
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
async function pendingRefund(page: Page, amount: string, merchant: string) {
  await page.keyboard.press('n');
  const d = page.getByRole('dialog');
  await d.getByRole('button', { name: 'Refund', exact: true }).click();
  await d.getByTestId('amount').fill(amount);
  await d.getByTestId('merchant').fill(merchant);
  await d.getByLabel('Account', { exact: true }).selectOption({ label: 'Everyday Checking' });
  await d.getByRole('button', { name: 'Notes, split or pending' }).click();
  await d.getByLabel(/Pending/).check();
  await d.getByTestId('save-tx').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test('a savings account at −$50 reduces Safe to Spend by $50 and is named; a positive one adds nothing', async ({ page }) => {
  await sample(page);
  await go(page, '/settings');
  await page.getByRole('button', { name: 'Add account' }).click();
  const a = page.getByRole('dialog');
  await a.getByLabel('Name').fill('Holiday fund');
  await a.getByRole('group', { name: 'Account type' }).getByRole('button', { name: 'Savings' }).click();
  await a.getByLabel('Balance today').fill('-50');
  await a.getByRole('button', { name: 'Save' }).click();
  await go(page, '/');
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,377.17');
  await expect(page.getByTestId('warnings')).toContainText('Holiday fund is overdrawn by $50.00');
  await page.getByTestId('why-sts').click();
  await expect(page.getByRole('dialog')).toContainText('Holiday fund overdrawn balance');
  await expect(page.getByRole('dialog')).toContainText('a negative balance on an account not counted as spendable; still owed');
});

test('Update balance: a +$200 difference with a $300 pending deposit is flagged as possibly part of it', async ({ page }) => {
  await sample(page);
  await pendingRefund(page, '300', 'Store return');
  await go(page, '/settings');
  await page.getByRole('button', { name: 'Update balance of Everyday Checking' }).click();
  const u = page.getByRole('dialog');
  await u.getByLabel('Posted balance per bank').fill('3071.23');
  const m = u.getByTestId('pending-match');
  await expect(m).toContainText('Pending items could explain part of this difference');
  await expect(m).toContainText('If you record +$200.00 now instead and that item clears later, the part of it already in this adjustment is counted twice.');
  await expect(m).toContainText('Store return · Refund · pending');
  await expect(u.getByRole('button', { name: 'Record adjustment' })).toBeDisabled();
  await u.getByTestId('pending-unrelated').check();
  await u.getByRole('button', { name: 'Record adjustment' }).click();
  await go(page, '/');
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,627.17'); // +200; the pending $300 still not spendable
});

test('import: a statement row that is a pending deposit clearing is left out and named; Mark posted reconciles without an adjustment', async ({ page }) => {
  await sample(page);
  await pendingRefund(page, '300', 'Store return');
  await page.getByRole('link', { name: 'Import Statement' }).click();
  await page.getByLabel('Import into account').selectOption({ label: 'Everyday Checking' });
  await page.getByTestId('import-file').setInputFiles({ name: 'nov.csv', mimeType: 'text/csv', buffer: Buffer.from('Date,Description,Amount,Balance\n2026-11-13,AMAZON REFUND 8812,300.00,3171.23\n') });
  await page.getByTestId('to-review').click();
  await expect(page.getByTestId('import-count')).toHaveText('0 selected');
  await expect(page.getByTestId('review-table')).toContainText('Same amount as “Store return”, still pending in Clarity (Nov 13). If this row is that transaction clearing, leave it out and mark “Store return” posted instead');
  const rc = page.getByTestId('reconciliation');
  await expect(rc).toContainText("Clarity's posted balance after this import");
  await expect(rc.getByTestId('import-pending-match')).toContainText('Store return');
  await rc.getByRole('button', { name: 'Mark Store return posted' }).click();
  await expect(rc).toContainText('Matches');
  await go(page, '/');
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,727.17'); // +300 once
});
