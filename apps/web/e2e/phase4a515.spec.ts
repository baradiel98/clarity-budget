import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 4A.5.15 through the real UI (production build, sample data: Safe to Spend $2,427.17; today Fri, Nov 13, 2026).
 * A Store card owing $250 with no payment scheduled lowers it to $2,177.17. A $100 payment from Everyday Checking that
 * neither bank has posted yet is counted exactly once: checking −$100, the card owes $150 → still $2,177.17
 * (4A.5.14 counted it twice: $2,077.17). The same scenario as apps/mobile/test/card-payment-transit.test.tsx.
 */
const SHOTS = process.env.SHOTS_DIR;
async function sample(page: Page) {
  await page.clock.setFixedTime(new Date('2026-11-13T10:00:00'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 1100 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore sample data' }).click();
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,427.17');
}
const go = (page: Page, path: string) => page.evaluate((p) => { history.pushState({}, '', p); dispatchEvent(new PopStateEvent('popstate')); scrollTo(0, 0); }, path);

test('a card payment pending at both banks is counted once; "Why this number?" names it; posting either side changes nothing', async ({ page }) => {
  await sample(page);
  await go(page, '/settings');
  await page.getByRole('button', { name: 'Add account' }).click();
  const a = page.getByRole('dialog');
  await a.getByLabel('Name').fill('Store card');
  await a.getByRole('group', { name: 'Account type' }).getByRole('button', { name: 'Credit card' }).click();
  await a.getByLabel('Amount owed today').fill('250');
  await a.getByRole('button', { name: /^(Add account|Save)$/ }).click();
  await go(page, '/');
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,177.17');
  await page.keyboard.press('n');
  const d = page.getByRole('dialog');
  await d.getByRole('button', { name: 'Transfer', exact: true }).click();
  await d.getByTestId('amount').fill('100');
  await d.getByLabel('From account').selectOption({ label: 'Everyday Checking' });
  await d.getByLabel('To account').selectOption({ label: 'Store card (card payment)' });
  await d.getByTestId('transfer-status').selectOption({ label: 'Not posted by either bank yet' });
  // not the payment of a scheduled item (the form offers to link one; that is a separate, existing feature)
  const occ = d.getByRole('checkbox', { name: /won't be counted again in your forecast/ });
  if (await occ.count()) await occ.uncheck();
  await d.getByTestId('save-tx').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,177.17');
  await page.getByTestId('why-sts').click();
  const why = page.getByRole('dialog');
  await expect(why).toContainText('Store card: $100.00 payment from Everyday Checking not yet posted by the card issuer');
  await expect(why).toContainText("already counted from Everyday Checking, so the $100.00 of card debt it pays isn't counted again. If it's returned or rejected: when the returned money shows on a statement, choose \"It's the return of this card payment\" in the import review (not a separate deposit)");
  await expect(why).toContainText('Store card: owed now');
  await expect(why).toContainText('−$150.00');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/515-01-why.png`, fullPage: false });
  await page.keyboard.press('Escape');
  // the card issuer posts it (checking still pending): nothing moves
  await page.getByRole('link', { name: 'Transactions' }).first().click();
  await page.getByRole('button', { name: 'From Everyday Checking', exact: true }).first().click();
  const e = page.getByRole('dialog');
  await e.getByTestId('transfer-status').selectOption({ label: 'Posted by the card issuer · not yet by the paying bank' }); // Phase 4A.5.17 card wording
  await e.getByTestId('save-tx').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await go(page, '/');
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,177.17');
});
