import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 4A.8 through the real UI in Chromium (production build, sample data; today Fri, Nov 13, 2026). A Store card owing
 * $250 (no payment scheduled): Safe to Spend $2,177.17 (sample $2,427.17 − 250).
 * - A checking statement with "PAYMENT TO STORE CARD −$100" and "RETURNED PAYMENT +$100" (neither in Clarity): paired,
 *   Checking −100 + 100 and the card still owed $250 → $2,177.17. As a separate refund it would be $2,277.17.
 * - A $100 payment fully returned; the Store card statement shows $80 received: no fee option (returns can't exceed
 *   the payment).
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
  await go(page, '/settings');
  await page.getByRole('button', { name: 'Add account' }).click();
  const a = page.getByRole('dialog');
  await a.getByLabel('Name').fill('Store card');
  await a.getByRole('group', { name: 'Account type' }).getByRole('button', { name: 'Credit card' }).click();
  await a.getByLabel('Amount owed today').fill('250');
  await a.getByRole('button', { name: /^(Add account|Save)$/ }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await go(page, '/');
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,177.17');
}
const CSV = 'Date,Description,Amount,Balance\n2026-11-12,PAYMENT TO STORE CARD,-100.00,2771.23\n2026-11-13,RETURNED PAYMENT,100.00,2871.23\n';
async function review(page: Page) {
  await page.getByRole('link', { name: 'Import Statement' }).click();
  await page.getByLabel('Import into account').selectOption({ label: 'Everyday Checking' });
  await page.getByTestId('import-file').setInputFiles({ name: 'nov.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) });
  await page.getByTestId('to-review').click();
  await expect(page.getByTestId('review-table')).toBeVisible();
  // The sample schedules an Electricity bill (~$91) that the review suggests linking to the −$100 row and ticks by
  // default; a card payment isn't that bill, so it is unticked here (that suggestion is a separate, earlier behaviour,
  // reported in the Phase 4A.8 report).
  const occ = page.locator('tr', { has: page.getByLabel('Import row 2') }).getByRole('checkbox', { name: /Electricity/ });
  if (await occ.count()) await occ.uncheck();
}
const PAIR = "It's the return of the card payment in row 2: Nov 12 · PAYMENT TO STORE CARD · −$100.00";

test('a statement with a card payment and its return: paired on confirmation; Safe to Spend stays $2,177.17', async ({ page }) => {
  await sample(page);
  await review(page);
  // the payment row: a transfer with Store card suggested, not selected yet; the return row: unselected, a decision asked
  await expect(page.getByLabel('Import row 2')).not.toBeChecked();
  await expect(page.getByLabel('Import row 3')).not.toBeChecked();
  await expect(page.getByLabel('Import row 3')).toBeDisabled();
  const choice = page.getByTestId('match-choice-3');
  await expect(choice).toContainText('Is this the return of a card payment in this statement?');
  await choice.getByLabel(PAIR).check();
  // the payment row isn't selected yet: explained, import blocked
  await expect(page.getByTestId('pair-problem-3')).toHaveText('To record this return, import row 2 as a transfer to your credit card (Type: Transfer, then the card).');
  await expect(page.getByTestId('commit-import')).toBeDisabled();
  await expect(page.locator('tr', { has: page.getByLabel('Import row 2') }).getByLabel('Other account')).toHaveValue(/.+/);
  await page.getByLabel('Import row 2').check();
  await expect(page.getByTestId('pair-problem-3')).toHaveCount(0);
  await expect(page.getByTestId('return-kind-3')).toContainText('Linked as the return of $100.00 of the $100.00 card payment in row 2 (Nov 12) of this statement, not imported as income.');
  await expect(page.getByTestId('commit-import')).toHaveText('Import 1 transaction and record 1 returned payment');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/4a8-01-statement-pair.png`, fullPage: true });
  await page.getByTestId('commit-import').click();
  await expect(page.getByTestId('import-result')).toHaveText('1 new transaction imported · 1 returned card payment recorded');
  await go(page, '/');
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,177.17');
});

test('the user says the return is a separate transaction: imported as new (their decision) → $2,277.17', async ({ page }) => {
  await sample(page);
  await review(page);
  await page.getByLabel('Import row 2').check();
  await page.getByTestId('match-choice-3').getByLabel("No, it's a separate transaction. Import it as new").check();
  await page.getByTestId('commit-import').click();
  await expect(page.getByTestId('import-result')).toHaveText('2 new transactions imported · 1 transfer awaiting the other bank');
  await go(page, '/');
  // Checking −100 + 100; Store card 250 − 100 on its way = 150 → 2,427.17 − 150
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,277.17');
});

test('a fully returned $100 payment: the card statement\'s $80 can\'t be linked as the payment with a fee', async ({ page }) => {
  await sample(page);
  // the payment, then its return entered by hand
  await page.keyboard.press('n');
  let d = page.getByRole('dialog');
  await d.getByRole('button', { name: 'Transfer', exact: true }).click();
  await d.getByTestId('amount').fill('100');
  await d.getByLabel('From account').selectOption({ label: 'Everyday Checking' });
  await d.getByLabel('To account').selectOption({ label: 'Store card (card payment)' });
  await d.getByLabel('Date').fill('2026-11-12');
  await d.getByTestId('transfer-status').selectOption({ label: 'Not posted by either bank yet' });
  const occ = d.getByRole('checkbox', { name: /won't be counted again in your forecast/ });
  if (await occ.count()) await occ.uncheck();
  await d.getByTestId('save-tx').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.keyboard.press('n');
  d = page.getByRole('dialog');
  await d.getByRole('button', { name: 'Income', exact: true }).click();
  await d.getByTestId('amount').fill('100');
  await d.getByLabel('Account', { exact: true }).selectOption({ label: 'Everyday Checking' });
  await d.getByLabel('Date').fill('2026-11-13');
  await d.getByTestId('return-check').getByLabel(/^It's the return of this card payment/).check();
  await d.getByTestId('save-tx').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await go(page, '/');
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,177.17');
  // the Store card statement: $80 received
  await page.getByRole('link', { name: 'Import Statement' }).click();
  await page.getByLabel('Import into account').selectOption({ label: 'Store card' });
  await page.getByTestId('import-file').setInputFiles({ name: 'card.csv', mimeType: 'text/csv', buffer: Buffer.from('Date,Description,Amount,Balance\n2026-11-13,PAYMENT THANK YOU,80.00,-170.00\n') });
  // on this card statement charges are negative and the payment received is positive
  await page.getByRole('button', { name: 'Negative', exact: true }).click();
  await page.getByTestId('to-review').click();
  const choice = page.getByTestId('match-choice-2');
  await expect(choice).toContainText("Can't be linked: $100.00 of this payment was already returned, so it can't become $80.00 with a transfer fee (returns can't exceed the payment). Remove the return first, or leave the row out.");
  await expect(choice.getByRole('radio', { name: /Nov 12 · .*\+\$100\.00 · Store card/ })).toBeDisabled();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/4a8-02-fee-refused.png`, fullPage: true });
  await go(page, '/');
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,177.17');
});

test('Capture: once "It\'s the return of this card payment" is chosen, Category is hidden (as in the Add form)', async ({ page }) => {
  await sample(page);
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
  await go(page, '/capture');
  await page.getByTestId('capture-text').fill('Received $100 today in Everyday Checking');
  await page.getByTestId('capture-read').click();
  const draft = page.getByTestId('draft');
  await expect(draft.getByLabel(/^Category/)).toBeVisible();
  await draft.getByTestId('capture-return-check').getByLabel(/^It's the return of this card payment/).check();
  await expect(draft.getByLabel(/^Category/)).toHaveCount(0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/4a8-03-capture-no-category.png`, fullPage: false });
  await draft.getByTestId('capture-return-check').getByLabel("No, it's separate income").check();
  await expect(draft.getByLabel(/^Category/)).toBeVisible();
});
