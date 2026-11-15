import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 4B.3 through the real UI in Chromium (production build, sample data; today Fri, Nov 13, 2026).
 * The sample already links three November transactions to their scheduled items: Rent (Nov 1), Paycheck (Nov 5) and
 * Streaming (Nov 9, on the Visa Card). "Paid this month" lists them; it records and calculates nothing.
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
const rows = (page: Page) => page.getByTestId('paid-row');

test('collapsed by default; opens and closes from the keyboard; lists the three November payments; opening one shows its transaction', async ({ page }) => {
  await sample(page);
  await go(page, '/planning');
  const toggle = page.getByRole('button', { name: /^Paid this month/ });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('paid-count')).toHaveText('3 items');
  await expect(rows(page)).toHaveCount(0);
  // the schedule stays first and in full
  await expect(page.getByTestId('timeline')).toBeVisible();
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(rows(page)).toHaveCount(3);
  await expect(rows(page).nth(0)).toHaveAccessibleName('Rent. Paid Nov 1. −$1,450.00, Everyday Checking. Posted. Open the transaction.');
  await expect(rows(page).nth(1)).toHaveAccessibleName('Paycheck. Received Nov 5. +$1,860.00, Everyday Checking. Posted. Open the transaction.');
  await expect(rows(page).nth(2)).toHaveAccessibleName('Streaming. Paid Nov 9. −$15.49, Visa Card. Posted. Open the transaction.');
  // paid on the due date: no separate due date is shown
  await expect(rows(page).nth(0)).not.toContainText('due');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/4b3-01-paid-1440.png`, fullPage: false });
  // open the transaction (the normal Edit form), from the keyboard
  await rows(page).nth(0).focus();
  await page.keyboard.press('Enter');
  const d = page.getByRole('dialog');
  await expect(d.getByTestId('linked-occurrence')).toContainText('Records the scheduled payment Rent due Nov 1.');
  await expect(d.getByTestId('amount')).toHaveValue('1450.00');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(rows(page)).toHaveCount(0);
  // looking at the history changed nothing
  await go(page, '/');
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,427.17');
  await expect(page.getByTestId('available-cash')).toHaveText('$2,871.23');
});

test('a bill paid early and still pending, a card payment awaiting the card issuer; unlinking removes the entry', async ({ page }) => {
  await sample(page);
  // Phone ($65, due Nov 22) paid today from Checking, still pending at the bank
  await page.getByRole('button', { name: 'Mark paid: Phone' }).click();
  let d = page.getByRole('dialog');
  await d.getByRole('button', { name: 'Notes, split or pending' }).click();
  await d.getByLabel('Pending (not yet cleared by the bank)').check();
  await d.getByTestId('save-tx').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // Card payment (due Nov 25) sent today: posted at Checking, not yet by the card issuer
  await page.getByRole('button', { name: 'Mark paid: Card payment' }).click();
  d = page.getByRole('dialog');
  await d.getByTestId('amount').fill('247.66');
  await d.getByTestId('transfer-status').selectOption({ label: 'Sent · awaiting posting by the card issuer' });
  await d.getByTestId('save-tx').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // $2,871.23 − $65.00 (Phone, pending: money out counts at once) − $247.66 (card payment) − $91.40 (Electricity, Nov 18)
  // = $2,467.17 low on Nov 18, before the Nov 19 paycheck; − $200.00 reserve
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,267.17');
  await go(page, '/planning');
  await page.getByRole('button', { name: /^Paid this month/ }).click();
  await expect(page.getByTestId('paid-count')).toHaveText('5 items');
  const phone = rows(page).filter({ hasText: 'Phone' });
  await expect(phone).toHaveAccessibleName('Phone. Paid Nov 13, due Nov 22. −$65.00, Everyday Checking. Pending. Open the transaction.');
  await expect(phone.getByTestId('paid-status')).toHaveText('Pending');
  const card = rows(page).filter({ hasText: 'Card payment' });
  await expect(card).toContainText('Paid Nov 13 · due Nov 25 · Everyday Checking → Visa Card');
  await expect(card.getByTestId('paid-status')).toHaveText('Sent · awaiting posting by Visa Card');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/4b3-02-paid-pending-card.png`, fullPage: false });
  // the paid items are no longer in the schedule; each appears once here
  await expect(rows(page).filter({ hasText: 'Phone' })).toHaveCount(1);
  // unlink the Phone payment from its Edit form: it leaves the history and the bill is due again
  await phone.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Unlink' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('paid-count')).toHaveText('4 items');
  await expect(rows(page).filter({ hasText: 'Phone' })).toHaveCount(0);
  await go(page, '/');
  // the $65 is still recorded and the Phone bill is due again (Nov 22, after the Nov 19 paycheck, so after the Nov 18
  // low point): Safe to Spend is unchanged at $2,267.17, the same as the engine gives without this screen
  await expect(page.getByRole('button', { name: 'Mark paid: Phone' })).toBeVisible();
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,267.17');
});

test('390px: the section sits below the schedule, collapsed; empty months say so', async ({ page }) => {
  await sample(page, 390);
  await go(page, '/planning');
  const toggle = page.getByRole('button', { name: /^Paid this month/ });
  expect((await page.getByTestId('timeline').boundingBox())!.y).toBeLessThan((await toggle.boundingBox())!.y);
  await toggle.click();
  await expect(rows(page)).toHaveCount(3);
  await toggle.scrollIntoViewIfNeeded();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/4b3-03-paid-390.png`, fullPage: false });
  // December: nothing recorded as paid yet
  await page.clock.setFixedTime(new Date('2026-12-02T10:00:00'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await go(page, '/');
  await go(page, '/planning');
  await expect(page.getByTestId('paid-count')).toHaveText('None yet');
  await page.getByRole('button', { name: /^Paid this month/ }).click();
  await expect(page.getByTestId('paid-empty')).toHaveText('Nothing scheduled has been recorded as paid in December yet. When you use Mark paid (or link a payment), it appears here.');
});
