import { expect, test, type Page } from '@playwright/test';

/** Phase 4A.5.2 (Policy B) through the real UI, on sample data (Safe to Spend $2,427.17). Today is Fri, Nov 13, 2026. */
async function sample(page: Page) {
  await page.clock.setFixedTime(new Date('2026-11-13T10:00:00'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore sample data' }).click();
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,427.17');
}
const go = (page: Page, path: string) => page.evaluate((p) => { history.pushState({}, '', p); dispatchEvent(new PopStateEvent('popstate')); scrollTo(0, 0); }, path);

test('a card balance with no payment scheduled is owed now, and "Why this number?" says so (same as mobile)', async ({ page }) => {
  await sample(page);
  await go(page, '/settings');
  await page.getByRole('button', { name: 'Add account' }).click();
  const d = page.getByRole('dialog');
  await d.getByLabel('Name').fill('Store card');
  await d.getByRole('group', { name: 'Account type' }).getByRole('button', { name: 'Credit card' }).click();
  await d.getByLabel('Amount owed today').fill('250');
  await d.getByRole('button', { name: /^(Add account|Save)$/ }).click();
  await go(page, '/');
  // every day drops by the $250 owed now: 2,427.17 − 250 = 2,177.17
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,177.17');
  await page.getByTestId('why-sts').click();
  const why = page.getByRole('dialog');
  await expect(why).toContainText('Store card: owed now');
  await expect(why).toContainText('no payment is scheduled for it, so it is counted as owed now');
  await expect(why).toContainText('−$250.00');
  await page.keyboard.press('Escape');
  // "Can I afford this?" uses the same rule: lowest point 2,377.17 (before the $200 reserve), so $2,400 goes below zero
  await page.getByRole('button', { name: 'Can I afford this?' }).first().click();
  await page.getByRole('dialog').getByTestId('afford-amount').fill('2400');
  await expect(page.getByTestId('afford-headline')).toHaveText('Not without coming up short');
});
