import { expect, test } from '@playwright/test';

test.describe('startup safety net', () => {
  test('app script fails to load: diagnostics explain it and offer repair', async ({ page }) => {
    await page.route(/\/assets\/index-.*\.js$/, (r) => r.abort());
    await page.goto('/');
    await expect(page.getByText('Loading Clarity…')).toBeVisible();
    const diag = page.locator('#clarity-diagnostics');
    await expect(diag).toBeVisible({ timeout: 25_000 });
    await expect(diag).toContainText('app script did not run');
    await expect(diag).toContainText('Could not load /assets/index-');
    await expect(diag).toContainText('Storage (IndexedDB)works');
    await page.unroute(/\/assets\/index-.*\.js$/);
    await diag.getByRole('button', { name: 'Repair and reload' }).click();
    await expect(page.getByRole('button', { name: 'Get started' })).toBeVisible({ timeout: 25_000 });
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
    await expect(page.locator('#clarity-diagnostics')).toContainText('did not respond within 4 seconds', { timeout: 25_000 });
  });

  test('normal start never shows the diagnostics', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Get started' })).toBeVisible();
    await page.waitForTimeout(16_000);
    await expect(page.locator('#clarity-diagnostics')).toHaveCount(0);
  });
});

test('loading screen shows the build version (to identify what a device is running)', async ({ page }) => {
  await page.route(/\/assets\/index-.*\.js$/, (r) => r.abort());
  await page.goto('/');
  await expect(page.getByText(/^Version [0-9a-f]{7}$/)).toBeVisible();
});

test('every script blocked (as AdGuard did): the static screen still explains what to do', async ({ page }) => {
  // Emulates AdGuard Tracking Protection's "/clarity-*.js" rule, which matches every .js URL on a
  // "clarity-…" hostname. HTML and CSS still load; no script runs, not even boot.js.
  await page.route(/\.js(\?|$)/, (r) => r.abort('blockedbyclient'));
  await page.goto('/');
  await expect(page.getByText('Loading Clarity…')).toBeVisible();
  const hint = page.getByText(/a content blocker such as AdGuard may be blocking Clarity's scripts/);
  // Hidden at first, then faded in by CSS alone after a few seconds (no script involved).
  expect(await hint.evaluate((el) => getComputedStyle(el).opacity)).toBe('0');
  await expect.poll(() => hint.evaluate((el) => getComputedStyle(el).opacity), { timeout: 10_000 }).toBe('1');
  await expect(hint).toContainText('Allow this site in the blocker, then reload.');
  expect(await page.evaluate(() => (window as unknown as { __clarityModuleLoaded?: boolean }).__clarityModuleLoaded ?? false)).toBe(false);
});
