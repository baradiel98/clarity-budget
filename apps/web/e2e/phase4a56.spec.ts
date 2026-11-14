import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 4A.5.6 through the real UI: pending credits and the balance convention.
 * Sample data: Safe to Spend $2,427.17 (lowest Dec 1), Everyday Checking. Today is Fri, Nov 13, 2026.
 */
const HINT = 'Enter the posted (cleared) balance your bank shows right now, without pending items';
async function sample(page: Page) {
  await page.clock.setFixedTime(new Date('2026-11-13T10:00:00'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore sample data' }).click();
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,427.17');
}
const go = (page: Page, path: string) => page.evaluate((p) => { history.pushState({}, '', p); dispatchEvent(new PopStateEvent('popstate')); scrollTo(0, 0); }, path);

test('onboarding says what the balance should include', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-13T10:00:00'));
  await page.goto('/');
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByLabel('Passphrase', { exact: true }).fill('correct horse battery staple');
  await page.getByLabel('Confirm passphrase').fill('correct horse battery staple');
  await page.getByRole('checkbox', { name: /Create a recovery key/ }).uncheck();
  await page.getByRole('checkbox', { name: /cannot be recovered/ }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText(HINT)).toBeVisible();
});

test('a pending refund into checking is visible but not spendable; marking it posted adds it exactly once', async ({ page }) => {
  await sample(page);
  await page.keyboard.press('n');
  const d = page.getByRole('dialog');
  await d.getByRole('button', { name: 'Refund', exact: true }).click();
  await d.getByTestId('amount').fill('300');
  await d.getByTestId('merchant').fill('Store return');
  await d.getByRole('button', { name: 'Notes, split or pending' }).click();
  await d.getByLabel(/Pending/).check();
  await d.getByTestId('save-tx').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // recorded balance shows it (2,871.23 + 300), Safe to Spend doesn't (was $2,727.17 before Phase 4A.5.6)
  await expect(page.getByTestId('available-cash')).toHaveText('$3,171.23');
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,427.17');
  await page.getByTestId('why-sts').click();
  const why = page.getByRole('dialog');
  await expect(why).toContainText('Everyday Checking: pending credit not yet available');
  await expect(why).toContainText("pending; it's in your recorded balance but not counted until it clears");
  await expect(why).toContainText('−$300.00');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Why this number? Current recorded balance' }).click();
  await expect(page.getByRole('dialog')).toContainText("includes $300.00 of pending credits, which aren't available to spend until they clear");
  await page.keyboard.press('Escape');
  // affordability uses the same money: lowest point 2,627.17 before the $200 reserve → $2,700 is short
  await page.getByRole('button', { name: 'Can I afford this?' }).first().click();
  await page.getByRole('dialog').getByTestId('afford-amount').fill('2700');
  await expect(page.getByTestId('afford-headline')).toHaveText('Not without coming up short');
  await page.keyboard.press('Escape');
  // the refund clears: edit it and untick Pending → +$300 once
  await go(page, '/transactions');
  await page.getByLabel('Search transactions').fill('Store return');
  await page.getByLabel('Search transactions').blur();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('e');
  await page.getByRole('dialog').getByLabel(/Pending/).uncheck();
  await page.getByTestId('save-tx').click();
  await go(page, '/');
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,727.17');
  await expect(page.getByTestId('available-cash')).toHaveText('$3,171.23');
});

test('Update balance asks for the posted balance, lists pending items, and doesn\'t absorb them', async ({ page }) => {
  await sample(page);
  await page.keyboard.press('n');
  const d = page.getByRole('dialog');
  await d.getByRole('button', { name: 'Refund', exact: true }).click();
  await d.getByTestId('amount').fill('300');
  await d.getByTestId('merchant').fill('Store return');
  await d.getByRole('button', { name: 'Notes, split or pending' }).click();
  await d.getByLabel(/Pending/).check();
  await d.getByTestId('save-tx').click();
  await go(page, '/settings');
  await page.getByRole('button', { name: 'Update balance of Everyday Checking' }).click();
  const u = page.getByRole('dialog');
  await expect(u.getByTestId('update-balance-hint')).toContainText("Clarity's posted balance is $2,871.23.");
  await expect(u.getByTestId('update-balance-hint')).toContainText(HINT);
  await expect(u.getByTestId('update-balance-pending')).toContainText('Store return');
  await expect(u.getByTestId('update-balance-pending')).toContainText('If any of them has cleared at your bank, mark it posted first');
  // the bank's posted balance equals Clarity's posted balance: nothing to adjust (Phase 4A.5.8: confirmed without a transaction)
  await expect(u.getByLabel('Posted balance per bank')).toHaveValue('2871.23');
  await expect(u.getByTestId('balance-matches')).toBeVisible();
  await expect(u.getByRole('button', { name: 'Record adjustment' })).toHaveCount(0);
  await expect(u.getByRole('button', { name: 'Confirm balance' })).toBeEnabled();
});

test('a transaction dated on the day a balance was entered can be marked "Already included"', async ({ page }) => {
  await sample(page);
  await go(page, '/settings');
  await page.getByRole('button', { name: 'Add account' }).click();
  const a = page.getByRole('dialog');
  await expect(a.getByText(HINT)).toBeVisible();
  await a.getByLabel('Name').fill('New checking');
  await a.getByRole('group', { name: 'Account type' }).getByRole('button', { name: 'Checking' }).click();
  await a.getByLabel('Balance today').fill('800');
  await a.getByRole('button', { name: /^(Add account|Save)$/ }).click();
  await go(page, '/');
  const before = await page.getByTestId('available-cash').textContent();
  await page.keyboard.press('n');
  const d = page.getByRole('dialog');
  await d.getByRole('button', { name: 'Income', exact: true }).click();
  await d.getByTestId('amount').fill('300');
  await d.getByLabel('Account').selectOption({ label: 'New checking' });
  await expect(d.getByTestId('already-included')).toContainText("Already included in this account's balance as of Nov 13");
  await expect(d.getByTestId('already-included').getByRole('checkbox')).not.toBeChecked(); // same day: counted unless ticked (Phase 4A.5.8)
  await d.getByTestId('already-included').getByRole('checkbox').check();
  await d.getByTestId('save-tx').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('available-cash')).toHaveText(before!); // not added again
});
