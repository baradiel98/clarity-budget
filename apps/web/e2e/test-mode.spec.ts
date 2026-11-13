import { expect, test } from '@playwright/test';
import { addExpense, fresh } from './helpers';

/** Runs against the CLARITY_TEST_MODE=1 build (port 4174), never the production build. */
test.describe('11: developer test mode (test build only)', () => {
  test('opens straight to sample data, survives refreshes, and every page works', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await fresh(page);
    await expect(page.getByTestId('test-mode-banner')).toContainText('Fictional sample data');
    await expect(page.getByTestId('month-end')).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('month-end')).toBeVisible();
    for (const name of ['Transactions', 'Budget', 'Planning', 'Reports', 'Settings', 'Home']) {
      await page.getByRole('link', { name: new RegExp(name) }).first().click();
      await expect(page.locator('.main-inner h1').first()).toBeVisible();
    }
    // the real data store is never created or touched in test mode
    const dbs = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
    expect(dbs).toContain('clarity-test');
    expect(dbs).not.toContain('clarity');
    expect(errors).toEqual([]);
  });

  test('changes persist across reloads; "Reset test data" restores fresh sample data', async ({ page }) => {
    await fresh(page);
    await expect(page.getByTestId('month-end')).toBeVisible();
    await addExpense(page, '12.34', 'Test Bakery');
    await page.reload();
    await expect(page.getByTestId('recent')).toContainText('Test Bakery');
    page.once('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: 'Reset test data' }).click();
    await expect(page.getByTestId('month-end')).toBeVisible();
    await expect(page.getByTestId('recent')).not.toContainText('Test Bakery');
  });

  test('the lock screen can still be tested, with the sample passphrase shown', async ({ page }) => {
    await fresh(page);
    await page.getByRole('button', { name: 'Lock' }).click();
    await expect(page.getByText('Test mode: the sample data passphrase is “clarity sample data”.')).toBeVisible();
    await page.getByLabel('Passphrase', { exact: true }).fill('clarity sample data');
    await page.getByLabel('Passphrase', { exact: true }).press('Enter');
    await expect(page.getByTestId('month-end')).toBeVisible();
  });
});
