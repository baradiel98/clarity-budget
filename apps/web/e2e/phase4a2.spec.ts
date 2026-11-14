import { expect, test, type Page } from '@playwright/test';

/** Phase 4A.2 through the real UI. Today is Fri, Nov 13, 2026. */
async function onboard(page: Page, o: { balance: string; bill?: { name: string; amount: string; date: string } }) {
  await page.clock.setFixedTime(new Date('2026-11-13T10:00:00'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByLabel('Passphrase', { exact: true }).fill('correct horse battery staple');
  await page.getByLabel('Confirm passphrase').fill('correct horse battery staple');
  await page.getByRole('checkbox', { name: /Create a recovery key/ }).uncheck();
  await page.getByRole('checkbox', { name: /cannot be recovered/ }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Current checking balance').fill(o.balance);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Skip' }).click(); // no paycheck
  if (o.bill) {
    await page.getByLabel('Name').fill(o.bill.name);
    await page.getByLabel('Amount').fill(o.bill.amount);
    await page.getByLabel('Due date').fill(o.bill.date);
    await page.getByRole('button', { name: 'See my overview' }).click();
  } else {
    await page.getByRole('button', { name: 'Skip' }).click();
  }
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

test('D1: a scheduled transfer from an empty savings account is not counted as money arriving', async ({ page }) => {
  await onboard(page, { balance: '300', bill: { name: 'Rent', amount: '1200', date: '2026-12-01' } });
  await page.getByTestId('go-dashboard').click();
  await addAccount(page, 'Rainy day', 'Savings', '0');
  await go(page, '/planning');
  await page.getByRole('region', { name: 'Transfers & savings' }).getByRole('button', { name: 'Add' }).click();
  const d = page.getByRole('dialog');
  await d.getByRole('group', { name: 'Kind' }).getByRole('button', { name: 'Transfer / card payment' }).click();
  await d.getByLabel('Name').fill('Top up');
  await d.getByLabel('From account').selectOption({ label: 'Rainy day' });
  await d.getByLabel('To account').selectOption({ label: 'Checking' });
  await d.getByLabel('Amount', { exact: true }).fill('1000');
  await d.getByLabel('How often').selectOption('once');
  await d.getByLabel('Date', { exact: true }).fill('2026-11-25');
  await d.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await go(page, '/');
  // 300 + 0 (the savings account has nothing to send) − 1,200 = −900. Before Phase 4A.2: +100.
  await expect(page.getByTestId('safe-to-spend')).toHaveText('Short by $900.00');
  const w = page.getByTestId('warnings');
  await expect(w).toContainText("Top up: Rainy day won't have the money");
  await expect(w).toContainText('Only that amount is counted; $1,000.00 is not.');
});

test('R2: a bill paid from an account that would run short is flagged; Safe to Spend still shows the combined amount', async ({ page }) => {
  await onboard(page, { balance: '500' });
  await page.getByTestId('go-dashboard').click();
  await addAccount(page, 'Wallet', 'Cash', '300');
  await go(page, '/planning');
  await page.getByRole('button', { name: 'Add bill' }).click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Name').fill('Car repair');
  await d.getByLabel('Paid from').selectOption({ label: 'Wallet' });
  await d.getByLabel('Amount', { exact: true }).fill('600');
  await d.getByLabel('How often').selectOption('once');
  await d.getByLabel('Date', { exact: true }).fill('2026-11-20');
  await d.getByRole('button', { name: 'Save' }).click();
  await go(page, '/');
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$200.00');
  const w = page.getByTestId('warnings');
  await expect(w).toContainText('Wallet would go to −$300.00 on Nov 20');
  await expect(w).toContainText('Move $300.00 into Wallet before Nov 20');
  await page.getByTestId('why-sts').click();
  await expect(page.getByRole('dialog')).toContainText('Combines your spendable accounts');
});

test('no regular income: the card, Can I afford this?, Planning and the overview all state the limit', async ({ page }) => {
  await onboard(page, { balance: '2000', bill: { name: 'Rent', amount: '1400', date: '2026-12-01' } });
  await expect(page.getByText('Lowest balance this month')).toBeVisible();
  await page.getByTestId('go-dashboard').click();
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$600.00');
  await expect(page.getByTestId('sts-caption')).toHaveText('No regular income is scheduled, so this only covers bills through Dec 31.');
  await expect(page.getByTestId('sts-caption')).toHaveClass(/warn/);
  await expect(page.getByTestId('sts-next')).toHaveText('Next after Dec 31: Rent $1,400.00 on Jan 1 — not included.');
  await expect(page.getByRole('region', { name: 'Key balances' })).toContainText('Lowest balance this month');
  await page.getByRole('button', { name: 'Can I afford this?' }).first().click();
  await page.getByRole('dialog').locator('input').first().fill('600');
  const r = page.getByTestId('afford-result');
  await expect(r).toContainText('Yes, through Dec 31');
  await expect(r).not.toContainText('Yes, you can afford it');
  await expect(page.getByTestId('afford-scope')).toHaveText('Checked against everything scheduled through Dec 31. No regular income is scheduled, so nothing after that is covered. Next after Dec 31: Rent $1,400.00 on Jan 1 — not included.');
  await page.keyboard.press('Escape');
  await go(page, '/planning');
  await expect(page.getByTestId('timeline-scope')).toHaveText("Shows what's scheduled through Dec 31, the end of the Safe to Spend forecast. Recurring items continue after that; see the lists. Next after Dec 31: Rent $1,400.00 on Jan 1 — not included.");
});

test('entering the scheduled rent through Add Transaction links it to the bill: shown, and counted once', async ({ page }) => {
  // The duplicate the audit built directly in the engine can't be created this way: the form links the entry to the bill.
  // (An unlinked planned transaction is flagged by the engine's possible-duplicate warning; see account-integrity.test.ts.)
  await page.clock.setFixedTime(new Date('2026-11-13T10:00:00'));
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore sample data' }).click();
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,427.17');
  await page.keyboard.press('n');
  await page.getByTestId('amount').fill('1450');
  await page.getByTestId('merchant').fill('Rent');
  await page.getByRole('dialog').getByLabel('Date').fill('2026-12-01');
  await expect(page.getByRole('dialog')).toContainText("This pays Rent due Dec 1, so it won't be counted again in your forecast.");
  await page.getByTestId('save-tx').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,427.17'); // not $977.17: counted once
  await expect(page.getByTestId('warnings')).toHaveCount(0);
});
