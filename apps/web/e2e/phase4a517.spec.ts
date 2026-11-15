import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 4A.5.17 through the real UI (production build, sample data; today Fri, Nov 13, 2026). A Store card owing $250
 * with no payment scheduled: Safe to Spend $2,177.17. A $100 card payment from Everyday Checking, posted by neither
 * side, is counted once ($2,177.17). The checking statement shows the debit and the returned payment: the review lists
 * the return option for the payment; confirming it keeps Safe to Spend at $2,177.17 (the card owes $250 again and the
 * money is back). Importing the return as separate income would give $2,277.17.
 */
const SHOTS = process.env.SHOTS_DIR;
async function setup(page: Page) {
  await page.clock.setFixedTime(new Date('2026-11-13T10:00:00'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 1100 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore sample data' }).click();
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,427.17');
  await page.evaluate(() => { history.pushState({}, '', '/settings'); dispatchEvent(new PopStateEvent('popstate')); });
  await page.getByRole('button', { name: 'Add account' }).click();
  const a = page.getByRole('dialog');
  await a.getByLabel('Name').fill('Store card');
  await a.getByRole('group', { name: 'Account type' }).getByRole('button', { name: 'Credit card' }).click();
  await a.getByLabel('Amount owed today').fill('250');
  await a.getByRole('button', { name: /^(Add account|Save)$/ }).click();
  await page.keyboard.press('n');
  const d = page.getByRole('dialog');
  await d.getByRole('button', { name: 'Transfer', exact: true }).click();
  await d.getByTestId('amount').fill('100');
  await d.getByLabel('From account').selectOption({ label: 'Everyday Checking' });
  await d.getByLabel('To account').selectOption({ label: 'Store card (card payment)' });
  await d.getByLabel('Date').fill('2026-11-13');
  await expect(d.getByTestId('transfer-status').locator('option')).toContainText(['Sent · awaiting posting by the card issuer']); // F4: card wording
  await d.getByTestId('transfer-status').selectOption({ label: 'Not posted by either bank yet' });
  const occ = d.getByRole('checkbox', { name: /won't be counted again in your forecast/ });
  if (await occ.count()) await occ.uncheck();
  await d.getByTestId('save-tx').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test('F1: the returned card payment is offered on its row; confirming it records the return (not income) and the card debt counts again', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { history.pushState({}, '', '/'); dispatchEvent(new PopStateEvent('popstate')); });
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,177.17');
  await page.getByRole('link', { name: 'Import Statement' }).click();
  await page.getByLabel('Import into account').selectOption({ label: 'Everyday Checking' });
  await page.getByTestId('import-file').setInputFiles({ name: 'nov.csv', mimeType: 'text/csv', buffer: Buffer.from('Date,Description,Amount,Balance\n2026-11-13,STORE CARD PAYMENT,-100.00,2771.23\n2026-11-13,RETURNED PAYMENT STORE CARD,100.00,2871.23\n') });
  await page.getByTestId('to-review').click();
  await expect(page.getByTestId('import-count')).toHaveText('0 selected'); // never imported silently
  const ret = page.getByTestId('match-choice-3');
  const label = "It's the return of this card payment: Nov 13 · Transfer · −$100.00 · Everyday Checking · pending · transfer · card payment";
  await expect(ret.getByLabel(label)).toBeVisible();
  await page.getByTestId('match-choice-2').getByLabel(/^It's this one: Nov 13 · Transfer · −\$100\.00/).check();
  await ret.getByLabel(label).check();
  await expect(page.getByTestId('match-note-3')).toContainText("Clarity records the money coming back to Everyday Checking and the payment as returned: it no longer counts as paying Store card, so Store card's debt is counted in full again. It isn't counted as income.");
  await expect(page.getByTestId('reconciliation')).toContainText('Matches');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/517-01-return.png`, fullPage: true });
  await page.getByTestId('commit-import').click();
  await expect(page.getByTestId('import-result')).toHaveText('0 new transactions imported · 1 existing transaction linked (1 marked posted) · 1 returned card payment recorded');
  await page.evaluate(() => { history.pushState({}, '', '/'); dispatchEvent(new PopStateEvent('popstate')); });
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,177.17');
  await page.getByTestId('why-sts').click();
  await expect(page.getByRole('dialog')).not.toContainText('not yet posted by the card issuer');
  await expect(page.getByRole('dialog')).toContainText('−$250.00');
});

test('F3/F4: before the return, the explanation says what to do if it fails; the list says "awaiting posting by Store card"', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => { history.pushState({}, '', '/'); dispatchEvent(new PopStateEvent('popstate')); });
  await page.getByTestId('why-sts').click();
  await expect(page.getByRole('dialog')).toContainText('If it\'s returned or rejected: when the returned money shows on a statement, choose "It\'s the return of this card payment" in the import review (not a separate deposit), and the card debt is counted in full again; if the money never left Everyday Checking, delete the payment');
  await page.keyboard.press('Escape');
  await page.getByRole('link', { name: 'Transactions' }).first().click();
  await expect(page.getByTestId('transfer-settlement').filter({ hasText: 'Not posted by either bank yet' }).first()).toBeVisible();
  await page.getByRole('button', { name: 'From Everyday Checking', exact: true }).first().click();
  await page.getByRole('dialog').getByTestId('transfer-status').selectOption({ label: 'Sent · awaiting posting by the card issuer' });
  await page.getByRole('dialog').getByTestId('save-tx').click();
  await expect(page.getByTestId('transfer-settlement').filter({ hasText: 'Sent from Everyday Checking · awaiting posting by Store card' }).first()).toBeVisible();
  await expect(page.getByTestId('transfer-settlement').filter({ hasText: 'Sent · awaiting posting by Store card' }).first()).toBeVisible();
});
