import { expect, test, type Page } from '@playwright/test';

/** Phase 4A.4.4 through the real UI, on sample data (Safe to Spend $2,427.17, lowest on Dec 1). Today is Fri, Nov 13, 2026. */
async function sample(page: Page) {
  await page.clock.setFixedTime(new Date('2026-11-13T10:00:00'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore sample data' }).click();
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,427.17');
}
const go = (page: Page, path: string) => page.evaluate((p) => { history.pushState({}, '', p); dispatchEvent(new PopStateEvent('popstate')); scrollTo(0, 0); }, path);
async function addAccount(page: Page, name: string, type: 'Cash' | 'Credit card', amount: string) {
  await go(page, '/settings');
  await page.getByRole('button', { name: 'Add account' }).click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Name').fill(name);
  await d.getByRole('group', { name: 'Account type' }).getByRole('button', { name: type }).click();
  await d.getByLabel(type === 'Credit card' ? 'Amount owed today' : 'Balance today').fill(amount);
  await d.getByRole('button', { name: /^(Add account|Save)$/ }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test('archiving an overdrawn account: the review names the debt, and Safe to Spend does not go up', async ({ page }) => {
  await sample(page);
  await addAccount(page, 'Old wallet', 'Cash', '0');
  // a $300 expense today from the $0 wallet: it is overdrawn by $300
  await go(page, '/');
  await page.keyboard.press('n');
  const add = page.getByRole('dialog');
  await add.getByTestId('amount').fill('300');
  await add.getByTestId('merchant').fill('Repair');
  await add.getByLabel('Account').selectOption({ label: 'Old wallet' });
  await add.getByTestId('save-tx').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // every day's low drops by $300: 2,427.17 − 300 = 2,127.17
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,127.17');

  await go(page, '/settings');
  await page.getByRole('button', { name: 'Archive Old wallet' }).click();
  await expect(page.getByRole('dialog').getByTestId('archive-balance-note')).toHaveText("Old wallet is overdrawn by $300.00. Archiving doesn't clear it: Safe to Spend keeps counting $300.00 against your spendable accounts until Old wallet is back to $0.00.");
  await page.getByRole('dialog').getByTestId('archive-confirm').click();
  await expect(page.getByRole('button', { name: 'Restore Old wallet' })).toBeVisible();
  await go(page, '/');
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,127.17'); // before Phase 4A.4.4: $2,427.17
  await go(page, '/planning');
  await expect(page.getByTestId('all-warnings')).toContainText('Old wallet is archived and overdrawn by $300.00');
});

test('archiving a card that still owes money keeps its warning, and the review says so', async ({ page }) => {
  await sample(page);
  await addAccount(page, 'Store card', 'Credit card', '250');
  await go(page, '/settings');
  await page.getByRole('button', { name: 'Archive Store card' }).click();
  await expect(page.getByRole('dialog').getByTestId('archive-balance-note')).toContainText('Store card still owes $250.00.');
  await page.getByRole('dialog').getByTestId('archive-confirm').click();
  await go(page, '/');
  // Phase 4A.5.2 (Policy B): no payment is scheduled for the $250, so it is owed now and lowers every day, including
  // the Dec 1 low: 2,427.17 − 250 = 2,177.17. (Phase 4A.5: $2,427.17, set aside only at the end of the forecast.)
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,177.17');
  const w = page.getByTestId('warnings');
  await expect(w).toContainText('$250.00 on Store card with no payment scheduled');
  await expect(w).toContainText("Store card is archived; archiving doesn't clear what it owes.");
});
