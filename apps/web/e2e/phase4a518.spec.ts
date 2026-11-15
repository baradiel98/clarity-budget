import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 4A.5.18 through the real UI (production build, sample data; today Fri, Nov 13, 2026). A Store card owing $250
 * (no payment scheduled): Safe to Spend $2,177.17; a $100 card payment from Everyday Checking posted by neither side is
 * counted once ($2,177.17). Recorded as separate income the returned $100 would give $2,277.17.
 */
const SHOTS = process.env.SHOTS_DIR;
const go = (page: Page, path: string) => page.evaluate((p) => { history.pushState({}, '', p); dispatchEvent(new PopStateEvent('popstate')); scrollTo(0, 0); }, path);
async function sample(page: Page) {
  await page.clock.setFixedTime(new Date('2026-11-13T10:00:00'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 1100 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore sample data' }).click();
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,427.17');
}
async function addAccount(page: Page, name: string, type: 'Credit card' | 'Checking', amount: string) {
  await go(page, '/settings');
  await page.getByRole('button', { name: 'Add account' }).click();
  const a = page.getByRole('dialog');
  await a.getByLabel('Name').fill(name);
  await a.getByRole('group', { name: 'Account type' }).getByRole('button', { name: type }).click();
  await a.getByLabel(type === 'Credit card' ? 'Amount owed today' : 'Balance today').fill(amount);
  await a.getByRole('button', { name: /^(Add account|Save)$/ }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
async function cardPayment(page: Page) {
  await addAccount(page, 'Store card', 'Credit card', '250');
  await page.keyboard.press('n');
  const d = page.getByRole('dialog');
  await d.getByRole('button', { name: 'Transfer', exact: true }).click();
  await d.getByTestId('amount').fill('100');
  await d.getByLabel('From account').selectOption({ label: 'Everyday Checking' });
  await d.getByLabel('To account').selectOption({ label: 'Store card (card payment)' });
  await d.getByLabel('Date').fill('2026-11-13');
  await d.getByTestId('transfer-status').selectOption({ label: 'Not posted by either bank yet' });
  const occ = d.getByRole('checkbox', { name: /won't be counted again in your forecast/ });
  if (await occ.count()) await occ.uncheck();
  await d.getByTestId('save-tx').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await go(page, '/');
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,177.17');
}

test('manual entry: $100 income offered as the return of the card payment; a decision is required; recording it keeps $2,177.17', async ({ page }) => {
  await sample(page);
  await cardPayment(page);
  await page.keyboard.press('n');
  const d = page.getByRole('dialog');
  await d.getByRole('button', { name: 'Income', exact: true }).click();
  await d.getByTestId('amount').fill('100');
  await d.getByLabel('Account', { exact: true }).selectOption({ label: 'Everyday Checking' });
  await d.getByLabel('Date').fill('2026-11-13');
  const check = d.getByTestId('return-check');
  await expect(check).toContainText('Is this money a returned card payment?');
  await d.getByTestId('save-tx').click();
  await expect(d.getByTestId('form-error')).toHaveText('Choose whether this is a returned card payment, or close to decide later.');
  await check.getByLabel("It's the return of this card payment: Nov 13 · Transfer · −$100.00 · Everyday Checking · pending · transfer · card payment").check();
  await expect(d.getByTestId('return-note')).toContainText("it no longer counts as paying Store card, so Store card's debt is counted in full again. It isn't counted as income. The payment itself is kept (with its history); undo removes the return.");
  await expect(d.getByTestId('form-error')).toHaveCount(0); // the earlier prompt is cleared once a choice is made
  await expect(d.getByLabel('Category')).toHaveCount(0); // a return has no category
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/518-01-manual-return.png`, fullPage: false });
  await d.getByTestId('save-tx').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,177.17');
  // nothing left to return: a second $100 deposit isn't offered as a return
  await page.keyboard.press('n');
  await page.getByRole('dialog').getByRole('button', { name: 'Income', exact: true }).click();
  await page.getByRole('dialog').getByTestId('amount').fill('100');
  await page.getByRole('dialog').getByLabel('Account', { exact: true }).selectOption({ label: 'Everyday Checking' });
  await expect(page.getByRole('dialog').getByTestId('return-check')).toHaveCount(0);
  await expect(page.getByRole('dialog').getByTestId('return-ask')).toHaveCount(0);
});

test('import: a $40 "PAYMENT RETURNED" row is offered as a partial return; the row shows what is recorded instead of type and category', async ({ page }) => {
  await sample(page);
  await cardPayment(page);
  await page.getByRole('link', { name: 'Import Statement' }).click();
  await page.getByLabel('Import into account').selectOption({ label: 'Everyday Checking' });
  await page.getByTestId('import-file').setInputFiles({ name: 'nov.csv', mimeType: 'text/csv', buffer: Buffer.from('Date,Description,Amount,Balance\n2026-11-13,PAYMENT RETURNED STORE CARD,40.00,2911.23\n') });
  await page.getByTestId('to-review').click();
  await page.getByTestId('match-choice-2').getByLabel(/^It's a partial return of this card payment: Nov 13 · Transfer · −\$100\.00 · Everyday Checking · pending · transfer · card payment · returns \$40\.00 of \$100\.00, \$60\.00 left paid$/).check();
  await expect(page.getByTestId('return-kind-2')).toContainText('Linked as the return of $40.00 of the $100.00 payment to Store card on Nov 13, not imported as income.');
  await expect(page.getByTestId('review-table').getByLabel('Type')).toHaveCount(0);
  await expect(page.getByTestId('match-note-2')).toContainText('Only $40.00 of the $100.00 payment came back; the other $60.00 still counts as paying Store card.');
  await expect(page.getByTestId('commit-import')).toHaveText('Record 1 returned payment');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/518-02-partial-import.png`, fullPage: true });
  await page.getByTestId('commit-import').click();
  await expect(page.getByTestId('import-result')).toHaveText('0 new transactions imported · 1 returned card payment recorded');
  await go(page, '/');
  // checking −100 + 40; Store card 250 − 60 = 190 → 2,427.17 − 60 − 190 = 2,177.17
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,177.17');
});

test('opening balance: a pending $50 from before "New checking" was added counts; the user can say it had already posted', async ({ page }) => {
  await sample(page);
  await addAccount(page, 'New checking', 'Checking', '500');
  await go(page, '/');
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,927.17');
  await page.keyboard.press('n');
  const d = page.getByRole('dialog');
  await d.getByTestId('amount').fill('50');
  await d.getByTestId('merchant').fill('Old hold');
  await d.getByLabel('Account', { exact: true }).selectOption({ label: 'New checking' });
  await d.getByLabel('Date').fill('2026-11-10');
  await d.getByRole('button', { name: 'Notes, split or pending' }).click();
  await d.getByLabel(/Pending/).check();
  await d.getByTestId('save-tx').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,877.17');
  await page.getByRole('link', { name: 'Transactions' }).first().click();
  await page.getByRole('button', { name: 'Old hold', exact: true }).first().click();
  await expect(page.getByRole('dialog').getByTestId('opening-posted')).toContainText('because the balance you entered was the posted balance');
  await page.getByRole('dialog').getByRole('button', { name: 'It had already posted when I added New checking' }).click();
  await go(page, '/');
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,927.17');
});
