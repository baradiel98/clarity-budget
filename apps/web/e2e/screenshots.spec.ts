import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { fresh } from './helpers';

/** Visual review captures (sample data). Run with SCREENSHOTS=1. Output: docs/screenshots/after. */
const out = join(dirname(fileURLToPath(import.meta.url)), '../../../docs/screenshots/after');
test.skip(!process.env.SCREENSHOTS, 'set SCREENSHOTS=1');

const pages: [string, string][] = [['/', 'home'], ['/transactions', 'transactions'], ['/budget', 'budget'], ['/planning', 'planning'], ['/reports', 'reports'], ['/import', 'import'], ['/settings', 'settings'], ['/privacy', 'privacy']];

for (const scheme of ['light', 'dark'] as const) {
  for (const [w, h, name] of [[1440, 900, 'desktop'], [390, 844, 'mobile']] as const) {
    test(`${name} ${scheme}`, async ({ page }) => {
      mkdirSync(out, { recursive: true });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await page.setViewportSize({ width: w, height: h });
      await fresh(page);
      await page.screenshot({ path: join(out, `${name}-welcome-${scheme}.png`) });
      await page.getByRole('button', { name: 'Explore sample data' }).click();
      await expect(page.getByTestId('month-end')).toBeVisible();
      // give the demo a few budgets so the Budget page shows real states
      await page.evaluate(() => history.pushState(null, '', '/budget'));
      await page.evaluate(() => dispatchEvent(new PopStateEvent('popstate')));
      for (const [id, v] of [['cat_groceries', '450'], ['cat_dining', '30'], ['cat_coffee', '40'], ['cat_fuel', '120'], ['cat_housing', '1450'], ['cat_utilities', '100']] as const) {
        const input = page.getByTestId(`budget-${id}`).getByRole('textbox');
        await input.fill(v);
        await input.blur();
        await expect(page.getByTestId(`budget-${id}`)).toContainText(/left|Over/);
      }
      for (const [path, n] of pages) {
        await page.evaluate((p) => { history.pushState(null, '', p); dispatchEvent(new PopStateEvent('popstate')); scrollTo(0, 0); }, path);
        await page.waitForTimeout(250);
        await page.screenshot({ path: join(out, `${name}-${n}-${scheme}.png`), fullPage: name === 'mobile' || n === 'home' });
      }
      await page.evaluate(() => { history.pushState(null, '', '/'); dispatchEvent(new PopStateEvent('popstate')); scrollTo(0, 0); });
      await page.getByTestId('why-sts').click();
      await page.waitForTimeout(200);
      await page.screenshot({ path: join(out, `${name}-explain-${scheme}.png`) });
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Add Transaction' }).first().click();
      await page.waitForTimeout(200);
      await page.screenshot({ path: join(out, `${name}-add-${scheme}.png`) });
      await page.keyboard.press('Escape');
      if (name === 'desktop') {
        const chart = page.getByTestId('forecast-chart');
        const box = (await chart.boundingBox())!;
        await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.4);
        await expect(page.getByTestId('chart-tip')).toBeVisible();
        await page.screenshot({ path: join(out, `${name}-chart-hover-${scheme}.png`) });
      }
    });
  }
}
