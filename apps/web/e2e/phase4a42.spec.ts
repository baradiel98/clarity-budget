import { expect, test, type Page } from '@playwright/test';

/** Phase 4A.4.2 through the real UI, on sample data (Safe to Spend $2,427.17, lowest on Dec 1). Today is Fri, Nov 13, 2026. */
async function sample(page: Page) {
  await page.clock.setFixedTime(new Date('2026-11-13T10:00:00'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore sample data' }).click();
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,427.17');
}
const go = (page: Page, path: string) => page.evaluate((p) => { history.pushState({}, '', p); dispatchEvent(new PopStateEvent('popstate')); scrollTo(0, 0); }, path);
async function addAccount(page: Page, name: string, type: 'Savings' | 'Cash', balance: string) {
  await go(page, '/settings');
  await page.getByRole('button', { name: 'Add account' }).click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Name').fill(name);
  await d.getByRole('group', { name: 'Account type' }).getByRole('button', { name: type }).click();
  await d.getByLabel('Balance today').fill(balance);
  await d.getByRole('button', { name: /^(Add account|Save)$/ }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
async function addBill(page: Page, name: string, from: string, amount: string, date: string) {
  await go(page, '/planning');
  await page.getByRole('button', { name: 'Add bill' }).click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Name').fill(name);
  await d.getByLabel('Paid from').selectOption({ label: from });
  await d.getByLabel('Amount', { exact: true }).fill(amount);
  await d.getByLabel('How often').selectOption('once');
  await d.getByLabel('Date', { exact: true }).fill(date);
  await d.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
async function addTransfer(page: Page, name: string, from: string, to: string, amount: string, date: string) {
  await go(page, '/planning');
  await page.getByRole('region', { name: 'Transfers & savings' }).getByRole('button', { name: 'Add' }).click();
  const d = page.getByRole('dialog');
  await d.getByRole('group', { name: 'Kind' }).getByRole('button', { name: 'Transfer / card payment' }).click();
  await d.getByLabel('Name').fill(name);
  await d.getByLabel('From account').selectOption({ label: from });
  await d.getByLabel('To account').selectOption({ label: to });
  await d.getByLabel('Amount', { exact: true }).fill(amount);
  await d.getByLabel('How often').selectOption('once');
  await d.getByLabel('Date', { exact: true }).fill(date);
  await d.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test('archiving an account with a scheduled bill: review, cancel, then keep — the bill stays counted', async ({ page }) => {
  await sample(page);
  await addAccount(page, 'Old wallet', 'Cash', '0');
  await addBill(page, 'Gym', 'Old wallet', '800', '2026-12-01');
  await go(page, '/');
  // the lowest day (Dec 1) and every later day drop by $800: 2,427.17 − 800 = 1,627.17
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$1,627.17');

  await go(page, '/settings');
  await page.getByRole('button', { name: 'Archive Old wallet' }).click();
  const d = page.getByRole('dialog');
  await expect(d.getByTestId('archive-review')).toContainText('Gym: bill paid from Old wallet');
  await d.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Archive Old wallet' })).toBeVisible(); // still active
  await go(page, '/');
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$1,627.17');

  await go(page, '/settings');
  await page.getByRole('button', { name: 'Archive Old wallet' }).click();
  await page.getByRole('dialog').getByTestId('archive-confirm').click(); // every item left on "Keep"
  await expect(page.getByRole('button', { name: 'Restore Old wallet' })).toBeVisible();
  await go(page, '/');
  // still $1,627.17 (before Phase 4A.4.2 archiving dropped the bill: $2,427.17, no warning)
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$1,627.17');
  await go(page, '/planning');
  const all = page.getByTestId('all-warnings');
  await expect(all).toContainText("Gym: Old wallet can't cover it");
  await expect(all).toContainText('1 scheduled item still uses Old wallet, which is archived');
});

test('archiving with "Move to Everyday Checking": the bill moves, nothing else changes, still counted', async ({ page }) => {
  await sample(page);
  await addAccount(page, 'Old wallet', 'Cash', '0');
  await addBill(page, 'Gym', 'Old wallet', '800', '2026-12-01');
  await go(page, '/settings');
  await page.getByRole('button', { name: 'Archive Old wallet' }).click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Gym: bill paid from Old wallet').selectOption({ label: 'Move to Everyday Checking' });
  await d.getByTestId('archive-confirm').click();
  await expect(page.getByRole('button', { name: 'Restore Old wallet' })).toBeVisible();
  await go(page, '/');
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$1,627.17');
  await go(page, '/planning');
  // nothing uses the archived account any more, and the sample data has no other warnings: no list at all
  await expect(page.getByTestId('all-warnings')).toHaveCount(0);
});

test('more than five warnings: Home shows five and a count; the link opens the complete list in Planning', async ({ page }) => {
  await sample(page);
  await addAccount(page, 'Empty savings', 'Savings', '0');
  for (let k = 1; k <= 6; k++) await addTransfer(page, `Top up ${k}`, 'Empty savings', 'Everyday Checking', '100', `2026-11-${String(15 + k).padStart(2, '0')}`);
  await go(page, '/');
  const home = page.getByTestId('warnings');
  await expect(home.locator('.warning-row')).toHaveCount(5);
  const more = page.getByTestId('more-warnings');
  const extra = Number((await more.textContent())!.match(/^(\d+) more in Planning$/)![1]);
  expect(extra).toBeGreaterThanOrEqual(1);
  await more.click();
  const all = page.getByTestId('all-warnings');
  await expect(all).toBeInViewport();
  await expect(all.getByTestId('warning-item')).toHaveCount(5 + extra);
  for (let k = 1; k <= 6; k++) await expect(all).toContainText(`Top up ${k}: Empty savings won't have the money`);
});
