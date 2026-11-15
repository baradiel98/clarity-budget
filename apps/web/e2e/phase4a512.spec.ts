import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 4A.5.12 through the real UI: every candidate listed (closest first, none pre-selected), a non-closest choice,
 * a different-amount candidate with its difference, an existing transfer linked from the other account's statement,
 * and the undo message. Sample data: Safe to Spend $2,427.17, Everyday Checking posted $2,871.23, Savings $5,200.00.
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
async function addTx(page: Page, o: { kind: 'Refund' | 'Transfer'; amount: string; merchant?: string; date: string; pending?: boolean; to?: string }) {
  await page.keyboard.press('n');
  const d = page.getByRole('dialog');
  await d.getByRole('button', { name: o.kind, exact: true }).click();
  await d.getByTestId('amount').fill(o.amount);
  if (o.merchant && o.kind !== 'Transfer') await d.getByTestId('merchant').fill(o.merchant);
  if (o.kind === 'Transfer') { await d.getByLabel('From account').selectOption({ label: 'Everyday Checking' }); await d.getByLabel('To account').selectOption({ label: o.to! }); }
  else await d.getByLabel('Account', { exact: true }).selectOption({ label: 'Everyday Checking' });
  await d.getByLabel('Date').fill(o.date);
  if (o.pending) { await d.getByRole('button', { name: 'Notes, split or pending' }).click(); await d.getByLabel(/Pending/).check(); }
  await d.getByTestId('save-tx').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
async function importCsv(page: Page, account: string, csv: string) {
  await page.getByRole('link', { name: 'Import Statement' }).click();
  await page.getByLabel('Import into account').selectOption({ label: account });
  await page.getByTestId('import-file').setInputFiles({ name: `${account}.csv`, mimeType: 'text/csv', buffer: Buffer.from('Date,Description,Amount,Balance\n' + csv) });
  await page.getByTestId('to-review').click();
}

test('two identical pending refunds: both listed, closest first, none pre-selected; the user picks the other one; undo explains', async ({ page }) => {
  await sample(page);
  await addTx(page, { kind: 'Refund', amount: '300', merchant: 'Refund A', date: '2026-11-10', pending: true });
  await addTx(page, { kind: 'Refund', amount: '300', merchant: 'Refund B', date: '2026-11-12', pending: true });
  await importCsv(page, 'Everyday Checking', '2026-11-13,AMAZON REFUND 8812,300.00,3171.23\n');
  const choice = page.getByTestId('match-choice-2');
  const labels = await choice.locator('label').allInnerTexts();
  expect(labels).toEqual([
    "It's this one: Nov 12 · Refund B · +$300.00 · Everyday Checking · pending",
    "It's this one: Nov 10 · Refund A · +$300.00 · Everyday Checking · pending",
    'Different transaction: none of these 2. Import it as new',
    'Leave it out',
  ]);
  await expect(choice.getByLabel('Leave it out')).toBeChecked(); // nothing chosen automatically
  await expect(page.getByLabel('Import row 2')).toBeDisabled();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/512-01-two-candidates.png`, fullPage: true });
  await choice.getByLabel(/^It's this one: Nov 10 · Refund A/).check();
  await expect(page.getByTestId('match-note-2')).toHaveText('It will be marked posted and linked to this row. Nothing new is added.');
  await expect(page.getByTestId('reconciliation')).toContainText('Matches');
  await page.getByTestId('commit-import').click();
  await expect(page.getByTestId('import-done')).toBeVisible();
  await page.getByRole('button', { name: 'Undo import' }).click();
  await expect(page.getByText('Import undone. Removed 0 imported transactions; “Refund A” in Everyday Checking is pending again and no longer linked to the statement.')).toBeVisible();
  await go(page, '/');
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,427.17');
});

test('a pending $300 refund cleared as $290: listed with the difference; choosing it explains that the amount is kept and the difference shows in the balance check', async ({ page }) => {
  await sample(page);
  await addTx(page, { kind: 'Refund', amount: '300', merchant: 'Store return', date: '2026-11-11', pending: true });
  await importCsv(page, 'Everyday Checking', '2026-11-13,AMAZON REFUND 8812,290.00,3161.23\n');
  const choice = page.getByTestId('match-choice-2');
  await choice.getByLabel("It's this one: Nov 11 · Store return · +$300.00 · Everyday Checking · pending · statement differs by −$10.00").check();
  await expect(page.getByTestId('match-note-2')).toContainText('Clarity has +$300.00; the statement shows +$290.00 (difference −$10.00).');
  const rc = page.getByTestId('reconciliation');
  await expect(rc).toContainText('−$10.00');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/512-02-different-amount.png`, fullPage: true });
  await rc.getByRole('checkbox', { name: /Record a balance adjustment of −\$10\.00/ }).check();
  await page.getByTestId('commit-import').click();
  await expect(page.getByTestId('import-done')).toBeVisible();
  await go(page, '/');
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,717.17'); // 2,427.17 + 290, once
});

test('an existing transfer to Savings: the Savings statement row is linked to it, not imported as new income', async ({ page }) => {
  await sample(page);
  await addTx(page, { kind: 'Transfer', amount: '100', date: '2026-11-09', to: 'Savings' }); // the transfer form has no description: “Transfer”
  await importCsv(page, 'Savings', '2026-11-13,DEPOSIT 7781,100.00,5300.00\n');
  const choice = page.getByTestId('match-choice-2');
  await expect(choice).toContainText("It's this one: Nov 9 · Transfer · +$100.00 · Savings · posted · transfer");
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/512-03-transfer.png`, fullPage: true });
  await choice.getByLabel(/^It's this one: Nov 9 · Transfer/).check();
  // Phase 4A.5.14: the note also says the other account's side isn't changed
  await expect(page.getByTestId('match-note-2')).toHaveText("Already posted in Clarity: this row will be linked to it. Nothing new is added. Only this account's side of the transfer is linked. The Everyday Checking side stays as it is until its own statement shows it (or you mark it posted).");
  await expect(page.getByTestId('reconciliation')).toContainText('Matches');
  await page.getByTestId('commit-import').click();
  await expect(page.getByTestId('import-done')).toBeVisible();
  await go(page, '/settings');
  await expect(page.getByRole('main')).toContainText('$5,300.00'); // 5,200 + 100 once, not 5,400
  await expect(page.getByRole('main')).not.toContainText('$5,400.00');
});
