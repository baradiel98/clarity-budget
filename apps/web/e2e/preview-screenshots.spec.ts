import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { fresh } from './helpers';

/** Account sign-in preview captures. Run with SCREENSHOTS=1. */
const out = join(dirname(fileURLToPath(import.meta.url)), '../../../docs/screenshots', process.env.SHOT_DIR ?? 'after');
test.skip(!process.env.SCREENSHOTS, 'set SCREENSHOTS=1');

for (const [w, h, name] of [[1440, 900, 'desktop'], [390, 844, 'mobile']] as const) {
  test(`sign-in preview ${name}`, async ({ page }) => {
    mkdirSync(out, { recursive: true });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: w, height: h });
    await fresh(page);
    await page.evaluate(() => { history.pushState(null, '', '/preview/sign-in'); dispatchEvent(new PopStateEvent('popstate')); });
    await expect(page.getByRole('heading', { name: 'Welcome to Clarity' })).toBeVisible();
    const shot = async (s: string) => { await page.waitForTimeout(200); await page.screenshot({ path: join(out, `${name}-signin-${s}.png`), fullPage: true }); };
    await shot('default');
    await page.getByLabel('Email').fill('alex@example.com');
    await page.getByLabel('Password', { exact: true }).fill('a password');
    await page.getByRole('group', { name: 'Preview state' }).getByRole('button', { name: 'Error' }).click();
    await shot('error');
    await page.getByRole('group', { name: 'Preview state' }).getByRole('button', { name: 'Loading' }).click();
    await shot('loading');
    await page.getByRole('group', { name: 'Preview state' }).getByRole('button', { name: 'Normal' }).click();
    await page.getByLabel('Password', { exact: true }).press('Enter');
    await expect(page.getByRole('heading', { name: 'Accounts aren’t available yet' })).toBeVisible();
    await shot('notice');
    await page.getByRole('button', { name: 'Back to the preview' }).click();
    await page.getByRole('button', { name: 'Create an account' }).click();
    await shot('create');
  });
}
