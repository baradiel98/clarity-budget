import { expect, test } from '@playwright/test';
import { fresh } from './helpers';

test('Settings shows the build version and can check for updates', async ({ page }) => {
  await fresh(page);
  const id = await page.locator('meta[name="clarity-build"]').getAttribute('content');
  expect(id).toMatch(/^[0-9a-f]{7}$|^\d{4}-/);
  await page.getByRole('button', { name: 'Explore sample data' }).click();
  await page.getByRole('link', { name: /Settings/ }).first().click();
  await expect(page.getByTestId('app-version')).toHaveText(`Version ${id}`);
  await page.getByRole('button', { name: 'Check for updates' }).click();
  // Same build on the server, so either "latest" or (if the worker is still installing) "downloading".
  await expect(page.getByText(/You have the latest version|A new version is downloading/)).toBeVisible();
});

test('a newly downloaded version offers a Reload button (never reloads by itself)', async ({ page }) => {
  await fresh(page);
  // Wait until the service worker controls the page (first load installs it).
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await expect(page.getByRole('button', { name: 'Explore sample data' })).toBeVisible();
  await expect(page.getByTestId('update-banner')).toHaveCount(0);

  // Simulate the new worker taking over, as happens after a deploy.
  await page.evaluate(() => navigator.serviceWorker.dispatchEvent(new Event('controllerchange')));
  const banner = page.getByTestId('update-banner');
  await expect(banner).toContainText('A new version of Clarity is ready.');
  await expect(page.getByRole('button', { name: 'Explore sample data' })).toBeVisible(); // page did not reload

  await banner.getByRole('button', { name: 'Reload' }).click();
  await expect(page.getByRole('button', { name: 'Explore sample data' })).toBeVisible();
  await expect(page.getByTestId('update-banner')).toHaveCount(0);
});
