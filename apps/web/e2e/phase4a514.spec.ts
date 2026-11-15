import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 4A.5.14 through the real UI (production build, sample data; Safe to Spend $2,427.17, Everyday Checking posted
 * $2,871.23, Savings $5,200.00; today Fri, Nov 13, 2026): each transfer leg settles on its own; money on its way in is
 * not spendable; a transfer fee is explicit; old pending items are listed; the import says exactly what it did; the
 * Add form never hides a pending setting.
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
/** A transfer recorded through the form; `status` is the visible Status choice. */
async function transfer(page: Page, o: { amount: string; from: string; to: string; date: string; status: string }) {
  await page.keyboard.press('n');
  const d = page.getByRole('dialog');
  await d.getByRole('button', { name: 'Transfer', exact: true }).click();
  await d.getByTestId('amount').fill(o.amount);
  await d.getByLabel('From account').selectOption({ label: o.from });
  await d.getByLabel('To account').selectOption({ label: o.to });
  await d.getByLabel('Date').fill(o.date);
  await d.getByTestId('transfer-status').selectOption({ label: o.status });
  // the sample schedules a $250 savings transfer on Nov 30; these test transfers are not that payment
  const occ = d.getByRole('checkbox', { name: /won't be counted again in your forecast/ });
  if (await occ.count()) await occ.uncheck();
  await d.getByTestId('save-tx').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
async function importCsv(page: Page, account: string, csv: string) {
  await page.getByRole('link', { name: 'Import Statement' }).click();
  await page.getByLabel('Import into account').selectOption({ label: account });
  await page.getByTestId('import-file').setInputFiles({ name: `${account}.csv`, mimeType: 'text/csv', buffer: Buffer.from('Date,Description,Amount,Balance\n' + csv) });
  await page.getByTestId('to-review').click();
}

test('D7: Pending ticked on an expense, then Transfer: the Status choice shows it (no hidden checkbox); back to Expense shows Pending ticked', async ({ page }) => {
  await sample(page);
  await page.keyboard.press('n');
  const d = page.getByRole('dialog');
  await d.getByRole('button', { name: 'Notes, split or pending' }).click();
  await d.getByLabel(/Pending/).check();
  await d.getByRole('button', { name: 'Transfer', exact: true }).click();
  await expect(d.getByTestId('transfer-status')).toHaveValue('none');
  await expect(d.getByTestId('transfer-status').locator('option:checked')).toHaveText('Not posted by either bank yet');
  await expect(d.getByLabel(/Pending \(not yet cleared/)).toHaveCount(0);
  await d.getByTestId('transfer-status').selectOption({ label: 'Sent · awaiting deposit' });
  await d.getByRole('button', { name: 'Expense', exact: true }).click();
  await expect(d.getByLabel(/Pending \(not yet cleared/)).toBeChecked(); // shown, not hidden
  await d.getByRole('button', { name: 'Transfer', exact: true }).click();
  await d.getByTestId('transfer-status').selectOption({ label: 'Posted by both banks' });
  await d.getByRole('button', { name: 'Expense', exact: true }).click();
  await expect(d.getByLabel(/Pending \(not yet cleared/)).not.toBeChecked();
});

test('D1/D8: checking → savings; the checking statement links ITS leg only ("Sent · awaiting deposit"); the import says 0 imported, 1 linked; undo names both sides', async ({ page }) => {
  await sample(page);
  await transfer(page, { amount: '100', from: 'Everyday Checking', to: 'Savings', date: '2026-11-12', status: 'Not posted by either bank yet' });
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,327.17'); // money going out counts at once
  await importCsv(page, 'Everyday Checking', '2026-11-13,ONLINE TRANSFER TO SAV,-100.00,2771.23\n');
  const choice = page.getByTestId('match-choice-2');
  await choice.getByLabel("It's this one: Nov 12 · Transfer · −$100.00 · Everyday Checking · pending · transfer").check();
  await expect(page.getByTestId('match-note-2')).toHaveText("It will be marked posted and linked to this row. Nothing new is added. Only this account's side of the transfer is linked. The Savings side stays as it is until its own statement shows it (or you mark it posted).");
  await expect(page.getByTestId('reconciliation')).toContainText('Matches');
  await expect(page.getByTestId('commit-import')).toHaveText('Link 1 to existing');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/514-01-link-one-leg.png`, fullPage: true });
  await page.getByTestId('commit-import').click();
  await expect(page.getByTestId('import-done')).toContainText('Import complete');
  await expect(page.getByTestId('import-result')).toHaveText('0 new transactions imported · 1 existing transaction linked (1 marked posted) · 1 transfer awaiting the other bank');
  await expect(page.getByTestId('import-done')).not.toContainText('Imported 1 transaction');
  await page.getByRole('button', { name: 'View transactions' }).click();
  const badges = page.getByTestId('transfer-settlement');
  await expect(badges.filter({ hasText: 'Sent · awaiting deposit in Savings' }).first()).toBeVisible();
  await expect(badges.filter({ hasText: 'Sent from Everyday Checking · awaiting deposit' }).first()).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/514-02-sent-awaiting-deposit.png`, fullPage: false });
  await go(page, '/');
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,327.17');
  await go(page, '/import');
  await page.getByRole('button', { name: 'Undo' }).first().click();
  await expect(page.getByText('Import undone. Removed 0 imported transactions; “Transfer” in Everyday Checking is pending again and no longer linked to the statement; the other side in Savings is unchanged (pending).')).toBeVisible();
});

test('D2: savings → checking still pending at checking: not spendable ($2,427.17, not $2,527.17); "Why this number?" says so', async ({ page }) => {
  await sample(page);
  await transfer(page, { amount: '100', from: 'Savings', to: 'Everyday Checking', date: '2026-11-12', status: 'Sent · awaiting deposit' });
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,427.17');
  await transfer(page, { amount: '50', from: 'Savings', to: 'Everyday Checking', date: '2026-11-12', status: 'Posted by both banks' });
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,477.17'); // a transfer both banks posted counts
  await page.getByTestId('why-sts').click();
  await expect(page.getByRole('dialog')).toContainText('Everyday Checking: pending credit not yet available');
});

test('D6: $100 sent, $95 arrived: linked only with the $5 fee confirmed; the fee is a separate expense in checking; nothing else changes', async ({ page }) => {
  await sample(page);
  await transfer(page, { amount: '100', from: 'Everyday Checking', to: 'Savings', date: '2026-11-12', status: 'Not posted by either bank yet' });
  await importCsv(page, 'Savings', '2026-11-13,WIRE IN,95.00,5295.00\n');
  const choice = page.getByTestId('match-choice-2');
  await choice.getByLabel("It's this one, and the bank charged a $5.00 transfer fee (recorded as spending in Everyday Checking): Nov 12 · Transfer · +$100.00 · Savings · pending · transfer · statement differs by −$5.00").check();
  await expect(page.getByTestId('match-note-2')).toContainText('Clarity records the transfer as $95.00 and the $5.00 fee as a separate expense in Everyday Checking. Nothing else is changed.');
  await expect(page.getByTestId('reconciliation')).toContainText('Matches');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/514-03-fee.png`, fullPage: true });
  await page.getByTestId('commit-import').click();
  await expect(page.getByTestId('import-result')).toHaveText('0 new transactions imported · 1 existing transaction linked (1 marked posted) · 1 transfer fee recorded · 1 transfer awaiting the other bank');
  await go(page, '/');
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,327.17'); // checking: −$95 transfer and −$5 fee, both still pending
  await go(page, '/settings');
  await expect(page.getByRole('main')).toContainText('$5,295.00');
});

test('D4: a check entered Oct 20 and cashed Nov 12 is listed as an older pending transaction; linked once ($2,227.17, not $2,027.17)', async ({ page }) => {
  await sample(page);
  await page.keyboard.press('n');
  const d = page.getByRole('dialog');
  await d.getByTestId('amount').fill('200');
  await d.getByTestId('merchant').fill('Check 12');
  await d.getByLabel('Account', { exact: true }).selectOption({ label: 'Everyday Checking' });
  await d.getByLabel('Date').fill('2026-10-20');
  await d.getByRole('button', { name: 'Notes, split or pending' }).click();
  await d.getByLabel(/Pending/).check();
  await d.getByTestId('save-tx').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,227.17');
  await importCsv(page, 'Everyday Checking', '2026-11-12,CHECK 12,-200.00,2671.23\n');
  await expect(page.getByTestId('match-stale-2')).toHaveText('Older pending transactions (outside the normal 10-day matching window)');
  await expect(page.getByLabel('Import row 2')).toBeDisabled();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/514-04-stale.png`, fullPage: true });
  await page.getByTestId('match-choice-2').getByLabel(/^It's this one: Oct 20 · Check 12 · −\$200\.00 · Everyday Checking · pending · entered 23 days before this row, outside the normal 10-day matching window$/).check();
  await page.getByTestId('commit-import').click();
  await expect(page.getByTestId('import-result')).toHaveText('0 new transactions imported · 1 existing transaction linked (1 marked posted)');
  await go(page, '/');
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,227.17');
});
