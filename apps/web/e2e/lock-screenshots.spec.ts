import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { fresh, onboard } from './helpers';

/** Lock screen captures. Run with SCREENSHOTS=1 (SHOT_DIR=before|after, default after). */
const out = join(dirname(fileURLToPath(import.meta.url)), '../../../docs/screenshots', process.env.SHOT_DIR ?? 'after');
test.skip(!process.env.SCREENSHOTS, 'set SCREENSHOTS=1');

for (const scheme of ['light', 'dark'] as const) {
  for (const [w, h, name] of [[1440, 900, 'desktop'], [390, 844, 'mobile']] as const) {
    test(`lock ${name} ${scheme}`, async ({ page }) => {
      mkdirSync(out, { recursive: true });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await page.setViewportSize({ width: w, height: h });
      await fresh(page);
      await onboard(page);
      await page.getByTestId('go-dashboard').click();
      if (name === 'mobile') {
        await page.getByRole('button', { name: 'More' }).click();
        await page.getByRole('dialog').getByRole('button', { name: 'Lock' }).click();
      } else {
        await page.getByRole('button', { name: 'Lock' }).click();
      }
      const shot = async (state: string) => {
        await page.waitForTimeout(250);
        await page.screenshot({ path: join(out, `${name}-lock-${state}-${scheme}.png`) });
      };
      await shot('default');
      const field = page.getByLabel('Passphrase', { exact: true });
      await field.fill('wrong passphrase');
      await shot('typing');
      await page.keyboard.press('Enter');
      await expect(page.getByRole('alert')).toBeVisible();
      await shot('error');
      await page.getByRole('button', { name: 'Use recovery key instead' }).click();
      await shot('recovery');
      await page.getByRole('button', { name: /Use passphrase instead|Back/ }).first().click();
      const help = page.getByRole('button', { name: /Lost both\?|Forgot your passphrase\?/ });
      await help.click();
      await shot('help');
    });
  }
}
