import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { fresh } from './helpers';

/** Visual review captures (sample data). Run with SCREENSHOTS=1. */
const out = join(dirname(fileURLToPath(import.meta.url)), '../../../docs/screenshots/web');
test.skip(!process.env.SCREENSHOTS, 'set SCREENSHOTS=1');

for (const scheme of ['light', 'dark'] as const) {
  for (const width of [1280, 1440, 1920]) {
    test(`home ${scheme} ${width}`, async ({ page }) => {
      mkdirSync(out, { recursive: true });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await page.setViewportSize({ width, height: 900 });
      await fresh(page);
      await page.getByRole('button', { name: 'Explore sample data' }).click();
      await expect(page.getByTestId('month-end')).toBeVisible();
      await page.screenshot({ path: join(out, `home-${scheme}-${width}.png`) });
      if (width === 1440) {
        for (const [key, name] of [['2', 'transactions'], ['3', 'planning'], ['4', 'settings']] as const) {
          await page.keyboard.press(key);
          await page.waitForTimeout(150);
          await page.screenshot({ path: join(out, `${name}-${scheme}-${width}.png`) });
        }
        await page.keyboard.press('1');
        await page.getByRole('button', { name: 'Why this number?' }).nth(1).click();
        await page.waitForTimeout(150);
        await page.screenshot({ path: join(out, `explain-${scheme}-${width}.png`) });
        await page.keyboard.press('Escape');
        await page.keyboard.press('n');
        await page.waitForTimeout(150);
        await page.screenshot({ path: join(out, `add-${scheme}-${width}.png`) });
      }
    });
  }
}
