import { expect, test, type Page } from '@playwright/test';
import { fresh, onboard, toDashboard } from './helpers';

/**
 * Phase 4A.7 through the real UI in Chromium (production build). Capture saves nothing in sample-data (demo) mode, so
 * these use a fresh workspace (helpers: today Thu, Sep 3, 2026; Checking $1,200; payday Sep 12, no bills). A Store card
 * owing $250 with no payment scheduled is owed now: Safe to Spend 1,200 − 250 = $950. A $100 card payment from Checking
 * that neither side has posted is counted once: 1,100 − (250 − 100) = $950. Its return: Checking 1,200, Store card 250 →
 * $950. Saved as income instead it would show 1,200 − 150 = $1,050 (the audit 4A.6 H1 defect).
 */
const SHOTS = process.env.SHOTS_DIR;
const go = (page: Page, path: string) => page.evaluate((p) => { history.pushState({}, '', p); dispatchEvent(new PopStateEvent('popstate')); scrollTo(0, 0); }, path);
async function setUp(page: Page) {
  await fresh(page);
  await onboard(page);
  await toDashboard(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 1100 });
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$1,200.00');
  await go(page, '/settings');
  await page.getByRole('button', { name: 'Add account' }).click();
  const a = page.getByRole('dialog');
  await a.getByLabel('Name').fill('Store card');
  await a.getByRole('group', { name: 'Account type' }).getByRole('button', { name: 'Credit card' }).click();
  await a.getByLabel('Amount owed today').fill('250');
  await a.getByRole('button', { name: /^(Add account|Save)$/ }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await go(page, '/');
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$950.00');
  await page.keyboard.press('n');
  const d = page.getByRole('dialog');
  await d.getByRole('button', { name: 'Transfer', exact: true }).click();
  await d.getByTestId('amount').fill('100');
  await d.getByLabel('From account').selectOption({ label: 'Checking' });
  await d.getByLabel('To account').selectOption({ label: 'Store card (card payment)' });
  await d.getByLabel('Date').fill('2026-09-03');
  await d.getByTestId('transfer-status').selectOption({ label: 'Not posted by either bank yet' });
  await d.getByTestId('save-tx').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$950.00');
}
async function capture(page: Page, text: string) {
  await go(page, '/capture');
  await page.getByTestId('capture-text').fill(text);
  await page.getByTestId('capture-read').click();
}
const RETURN_LABEL = /^It's the return of this card payment: Sep 3 · .*−\$100\.00 · Checking/;

test('Capture: $100 received is offered as the return of the card payment; it can\'t be approved until decided; confirming keeps $950.00', async ({ page }) => {
  await setUp(page);
  await capture(page, 'Received $100 today');
  const d = page.getByTestId('draft');
  await expect(d).toHaveCount(1);
  const check = d.getByTestId('capture-return-check');
  await expect(check).toContainText('Is this money a returned card payment?');
  await expect(d).toContainText('This could be a card payment coming back to you');
  await expect(page.getByTestId('approve-all')).toBeDisabled();
  await check.getByLabel(RETURN_LABEL).check();
  await expect(d.getByTestId('capture-return-note')).toContainText("It isn't counted as income.");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/4a7-01-capture-return.png`, fullPage: false });
  await page.getByTestId('approve-all').click();
  await expect(page.getByText('Saved 1 transaction from Capture.')).toBeVisible();
  await go(page, '/');
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$950.00');
});

test('Capture: two items in one entry; the possible return waits while the other is approved; "separate income" then saves it as income', async ({ page }) => {
  await setUp(page);
  await capture(page, 'I spent $12 at Starbucks today and received $100 today');
  await expect(page.getByTestId('draft')).toHaveCount(2);
  await expect(page.getByTestId('approve-all')).toHaveText(/Approve 1 ready/);
  await page.getByTestId('approve-all').click();
  await expect(page.getByTestId('draft')).toHaveCount(1); // the undecided $100 is still a draft; nothing about it was saved
  await go(page, '/');
  // 950 − 12 = 938
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$938.00');
  await go(page, '/capture');
  const d = page.getByTestId('draft');
  await d.getByTestId('capture-return-check').getByLabel("No, it's separate income").check();
  await page.getByTestId('approve-all').click();
  await expect(page.getByTestId('draft')).toHaveCount(0);
  await go(page, '/');
  // a genuine $100 deposit and a payment still on its way: 938 + 100 = 1,038
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$1,038.00');
});

test('a card payment with a recorded return can\'t be deleted (Edit dialog and list); the reason names the return; deleting the return first works', async ({ page }) => {
  await setUp(page);
  await capture(page, 'Received $100 today');
  await page.getByTestId('draft').getByTestId('capture-return-check').getByLabel(RETURN_LABEL).check();
  await page.getByTestId('approve-all').click();
  await expect(page.getByText('Saved 1 transaction from Capture.')).toBeVisible();
  await go(page, '/transactions');
  // the list's bulk delete: the payment alone is refused, nothing is deleted
  await page.getByRole('checkbox', { name: 'Select To Store card' }).check();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText(/Nothing was deleted: This card payment can't be deleted while a return is recorded against it/)).toBeVisible();
  await expect(page.locator('table.data tbody tr').filter({ hasText: '$100.00' })).toHaveCount(4);
  await page.getByRole('checkbox', { name: 'Select To Store card' }).uncheck();
  // the Edit dialog: Delete shows why
  await page.getByRole('button', { name: 'To Store card' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByRole('button', { name: 'Delete' }).click();
  await expect(dlg.getByTestId('form-error')).toContainText("This card payment can't be deleted while a return is recorded against it: “Returned payment” (Sep 3, $100.00). Delete the return first");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/4a7-02-delete-refused.png`, fullPage: false });
  await dlg.getByRole('button', { name: 'Cancel' }).click();
  await go(page, '/');
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$950.00');
  // delete the return (the payment counts as on its way again: still $950), then the payment
  await go(page, '/transactions');
  await page.getByRole('button', { name: 'From Store card' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('table.data tbody tr').filter({ hasText: '$100.00' })).toHaveCount(2);
  await go(page, '/');
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$950.00');
  await go(page, '/transactions');
  await page.getByRole('button', { name: 'To Store card' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await go(page, '/');
  // no payment: Checking 1,200, Store card $250 owed in full → $950
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$950.00');
});
