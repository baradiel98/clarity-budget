import { expect, test } from '@playwright/test';

test.describe('startup safety net', () => {
  test('app script fails to load: diagnostics explain it and offer repair', async ({ page }) => {
    await page.route(/\/assets\/index-.*\.js$/, (r) => r.abort());
    await page.goto('/');
    await expect(page.getByText('Loading Clarity…')).toBeVisible();
    const diag = page.locator('#clarity-diagnostics');
    await expect(diag).toBeVisible({ timeout: 20_000 });
    await expect(diag).toContainText('app script did not run');
    await expect(diag).toContainText('Could not load /assets/index-');
    await expect(diag).toContainText('Storage (IndexedDB)works');
    await page.unroute(/\/assets\/index-.*\.js$/);
    await diag.getByRole('button', { name: 'Repair and reload' }).click();
    await expect(page.getByRole('button', { name: 'Get started' })).toBeVisible({ timeout: 20_000 });
    await expect(diag).toHaveCount(0);
  });

  test('storage never answers: a clear message instead of an endless loading screen', async ({ page }) => {
    await page.addInitScript(() => {
      // Simulate a browser where IndexedDB requests never complete.
      const hang = () => ({}) as IDBOpenDBRequest;
      Object.defineProperty(window, 'indexedDB', { value: { open: hang, deleteDatabase: hang, databases: async () => [] }, configurable: true });
    });
    await page.goto('/');
    await expect(page.getByText("Clarity couldn't start")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#clarity-diagnostics')).toContainText('did not respond within 4 seconds', { timeout: 20_000 });
  });

  test('normal start never shows the diagnostics', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Get started' })).toBeVisible();
    await page.waitForTimeout(11_000);
    await expect(page.locator('#clarity-diagnostics')).toHaveCount(0);
  });
});
