import { expect, test, type Page } from '@playwright/test';

/** Phase 4A.4 through the real UI, on sample data (Safe to Spend $2,427.17). Today is Fri, Nov 13, 2026. */
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
async function afford(page: Page, amount: string, account: string, date: string) {
  await page.getByRole('button', { name: 'Can I afford this?' }).first().click();
  const d = page.getByRole('dialog');
  await d.getByTestId('afford-amount').fill(amount);
  await d.getByLabel('Pay with').selectOption({ label: account });
  await d.getByLabel('When').fill(date);
  return d;
}

test('F1: a bill paid from an empty savings account is counted against spendable cash (same result as mobile)', async ({ page }) => {
  await sample(page);
  await addAccount(page, 'College fund', 'Savings', '0');
  await go(page, '/planning');
  await page.getByRole('button', { name: 'Add bill' }).click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Name').fill('Tuition');
  await d.getByLabel('Paid from').selectOption({ label: 'College fund' });
  await d.getByLabel('Amount', { exact: true }).fill('500');
  await d.getByLabel('How often').selectOption('once');
  await d.getByLabel('Date', { exact: true }).fill('2026-11-13');
  await d.getByRole('button', { name: 'Save' }).click();
  await go(page, '/');
  // every day's low drops by $500: 2,427.17 − 500.00 (before Phase 4A.4 it stayed $2,427.17)
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$1,927.17');
  const w = page.getByTestId('warnings');
  await expect(w).toContainText("Tuition: College fund can't cover it");
  await expect(w).toContainText('Safe to Spend counts the other $500.00 against your spendable accounts.');
});

test('F3: "Can I afford this?" never says Yes for a date it did not check, or for an account that cannot pay', async ({ page }) => {
  await sample(page);
  let d = await afford(page, '100', 'Everyday Checking', '2027-03-01');
  await expect(d.getByTestId('afford-headline')).toHaveText("Can't check Mar 1 yet: the forecast ends Dec 31");
  await expect(d.getByTestId('afford-result')).not.toContainText('Safe to Spend after this purchase');
  await page.keyboard.press('Escape');
  await addAccount(page, 'Wallet', 'Cash', '100');
  await go(page, '/');
  d = await afford(page, '400', 'Wallet', '2026-11-13');
  // Wallet: 100 − 400 = −300; the other accounts cover it, but it is not a plain yes
  await expect(d.getByTestId('afford-headline')).toHaveText('Only if you move $300.00 into Wallet by Nov 13');
  await expect(d.getByTestId('afford-result')).toContainText('Wallet would go to −$300.00 on Nov 13');
});
