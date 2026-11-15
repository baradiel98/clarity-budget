import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 4A.10 through the real UI in Chromium (production build, sample data; today Fri, Nov 13, 2026; Safe to Spend
 * $2,427.17). The sample schedules Phone, a fixed $65.00 bill due Nov 22, from Everyday Checking.
 * - A $65 "Verizon Wireless" expense recorded today (not linked: nothing names the Phone bill) → $2,362.17: the bill is
 *   still counted as due as well.
 * - Mark paid on Phone offers that transaction; linking it adds nothing: Checking unchanged, the Phone bill leaves
 *   the forecast → $2,427.17. (Before 4A.10, Mark paid always added a second $65: $2,362.17 and $130 spent.)
 * - Unlink in the Edit form: the bill is due again → $2,362.17.
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
async function verizon(page: Page) {
  await page.keyboard.press('n');
  const d = page.getByRole('dialog');
  await d.getByTestId('amount').fill('65');
  await d.getByTestId('merchant').fill('Verizon Wireless');
  await d.getByLabel('Account', { exact: true }).selectOption({ label: 'Everyday Checking' });
  await d.getByTestId('save-tx').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,362.17');
}
const OPTION = /^Nov 13 · Verizon Wireless · −\$65\.00 · Everyday Checking · posted$/;

test('Mark paid offers the existing $65 payment; linking it adds nothing and removes the bill from the forecast → $2,427.17; Unlink restores it', async ({ page }) => {
  await sample(page);
  await verizon(page);
  await page.getByRole('button', { name: 'Mark paid: Phone' }).click();
  const d = page.getByRole('dialog');
  await expect(d.getByTestId('mark-paid-scheduled')).toHaveText('Phone · due Nov 22 · $65.00 · Everyday Checking');
  await expect(d.getByRole('radiogroup')).toContainText('Already recorded? If one of these transactions paid it, link it instead of adding a new one.');
  // nothing is chosen for the user: saving asks first
  await d.getByTestId('save-tx').click();
  await expect(d.getByTestId('mark-paid-error')).toHaveText('Choose the transaction that paid it, or “No, record a new payment”.');
  await d.getByLabel(OPTION).check();
  await expect(d.getByTestId('mark-paid-note')).toContainText('Nothing new is added');
  await expect(d.getByTestId('amount')).toHaveCount(0);
  await expect(d.getByTestId('save-tx')).toContainText('Link transaction');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/4a10-01-mark-paid-link.png`, fullPage: false });
  await d.getByTestId('save-tx').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,427.17');
  // still one Verizon transaction
  await go(page, '/transactions');
  await expect(page.locator('table.data tbody tr').filter({ hasText: 'Verizon Wireless' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Verizon Wireless' }).click();
  const e = page.getByRole('dialog');
  await expect(e.getByTestId('linked-occurrence')).toContainText('Records the scheduled payment Phone due Nov 22.');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/4a10-02-edit-linked.png`, fullPage: false });
  await e.getByRole('button', { name: 'Unlink' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await go(page, '/');
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,362.17');
});

test('Mark paid → "No, record a new payment" still records a new one, on purpose', async ({ page }) => {
  await sample(page);
  await verizon(page);
  await page.getByRole('button', { name: 'Mark paid: Phone' }).click();
  const d = page.getByRole('dialog');
  await d.getByLabel('No, record a new payment').check();
  await expect(d.getByTestId('amount')).toBeVisible();
  await d.getByTestId('save-tx').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // the user said it is a second payment: Checking −65 again; the bill is recorded → 2,362.17 − 65 + 65 = 2,362.17
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,362.17');
});

test('Mark paid with no existing transaction to offer: the usual form, no question', async ({ page }) => {
  await sample(page);
  await page.getByRole('button', { name: 'Mark paid: Phone' }).click();
  const d = page.getByRole('dialog');
  await expect(d.getByTestId('mark-paid-scheduled')).toHaveText('Phone · due Nov 22 · $65.00 · Everyday Checking');
  await expect(d.getByRole('radiogroup')).toHaveCount(0);
  await expect(d.getByTestId('amount')).toBeVisible();
});
