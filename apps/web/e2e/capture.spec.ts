import { expect, test, type Page } from '@playwright/test';
import { addExpense, fresh, onboard, toDashboard } from './helpers';

const money = (page: Page, id: string) => page.getByTestId(id);

async function setUp(page: Page) {
  await fresh(page); // today is Thu, Sep 3 2026
  await onboard(page);
  await toDashboard(page);
}
async function capture(page: Page, text: string) {
  // in-app navigation (a page reload would lock Clarity, as it should)
  await page.getByRole('link', { name: /Clarity Capture/ }).first().click();
  await page.getByTestId('capture-text').fill(text);
  await page.getByTestId('capture-read').click();
}
const drafts = (page: Page) => page.getByTestId('draft');
const draft = (page: Page, i: number) => drafts(page).nth(i);

test.describe('Clarity Capture', () => {
  test('several items: drafts first, nothing saved until approved, then balances update', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await setUp(page);
    await expect(money(page, 'available-cash')).toHaveText('$1,200.00');
    await capture(page, 'Today I spent $45 at Walmart on groceries, $18 at Starbucks for coffee, and paid $65 for gas at Shell.');
    await expect(drafts(page)).toHaveCount(3);
    await expect(page.getByTestId('capture-summary')).toContainText('3 drafts');
    await expect(page.getByTestId('capture-summary')).toContainText('$128.00 out');
    await expect(draft(page, 0).getByLabel(/Merchant/)).toHaveValue('Walmart');
    await expect(draft(page, 1).getByLabel(/Category/)).toHaveValue('cat_coffee');
    await expect(draft(page, 2).getByLabel(/Category/)).toHaveValue('cat_fuel');
    // Drafts don't touch the data
    await page.getByRole('link', { name: /Home/ }).first().click();
    await expect(money(page, 'available-cash')).toHaveText('$1,200.00');
    await page.getByRole('link', { name: /Clarity Capture/ }).first().click();
    await expect(drafts(page)).toHaveCount(3); // drafts survive moving between pages
    await page.getByTestId('approve-all').click();
    await expect(drafts(page)).toHaveCount(0);
    await expect(page.getByText('Saved 3 transactions from Capture.')).toBeVisible();
    await page.getByRole('link', { name: /Home/ }).first().click();
    await expect(money(page, 'available-cash')).toHaveText('$1,072.00');
    await page.getByRole('link', { name: /^Transactions/ }).first().click();
    await expect(page.locator('table.data')).toContainText('Starbucks');
    expect(errors).toEqual([]);
  });

  test('edits before approving are what gets saved; one item can be approved on its own', async ({ page }) => {
    await setUp(page);
    await capture(page, 'Today $30 at Walmart, and $12 at CVS');
    await draft(page, 0).getByLabel(/Category/).selectOption('cat_groceries');
    await draft(page, 0).getByLabel(/Amount/).fill('31.50');
    await draft(page, 0).getByRole('button', { name: 'Approve' }).click();
    await expect(drafts(page)).toHaveCount(1);
    await page.getByRole('link', { name: /^Transactions/ }).first().click();
    const row = page.locator('tr', { hasText: 'Walmart' });
    await expect(row).toContainText('Groceries');
    await expect(row).toContainText('31.50');
    await expect(page.locator('table.data')).not.toContainText('CVS');
  });

  test('unclear items must be fixed or confirmed; nothing is guessed', async ({ page }) => {
    await setUp(page);
    await capture(page, 'I paid 200. Spent around $100 at the grocery store today.');
    await expect(drafts(page)).toHaveCount(2);
    await expect(page.getByTestId('approve-all')).toBeDisabled();
    const unclear = draft(page, 0);
    await expect(unclear).toContainText('It isn’t clear what this was');
    await expect(unclear).toContainText('Add the merchant or what it was for.');
    await expect(unclear.getByRole('button', { name: 'Approve' })).toBeDisabled();
    const approx = draft(page, 1);
    await expect(approx).toContainText('You said about $100.00');
    await approx.getByRole('button', { name: 'Confirm' }).click();
    await expect(approx.getByRole('button', { name: 'Approve' })).toBeEnabled();
    await expect(page.getByTestId('approve-all')).toHaveText(/Approve 1 ready/);
    // fix the unclear one
    await unclear.getByLabel(/Merchant/).fill('Electric company');
    await unclear.getByRole('button', { name: 'Confirm' }).first().click(); // what it was: confirmed
    await unclear.getByRole('button', { name: 'Confirm' }).first().click(); // no date mentioned: today is right
    await expect(page.getByTestId('approve-all')).toHaveText(/Approve all 2/);
  });

  test('possible duplicate is shown and must be kept explicitly', async ({ page }) => {
    await setUp(page);
    await addExpense(page, '18', 'Starbucks');
    await capture(page, '$18 at Starbucks today');
    await expect(draft(page, 0)).toContainText('already saved');
    await expect(draft(page, 0).getByRole('button', { name: 'Approve' })).toBeDisabled();
    await draft(page, 0).getByRole('button', { name: 'Keep it' }).click();
    await expect(draft(page, 0).getByRole('button', { name: 'Approve' })).toBeEnabled();
  });

  test('split purchase: one transaction, every part needs a category', async ({ page }) => {
    await setUp(page);
    await capture(page, 'I spent $120 at Costco today: $70 groceries, $30 household supplies, and $20 personal care.');
    await expect(drafts(page)).toHaveCount(1);
    const d = draft(page, 0);
    await expect(d).toContainText('Split into 3 categories');
    await expect(d).toContainText('Choose a category for “household supplies”');
    await d.getByRole('group', { name: 'Split into categories' }).getByRole('combobox').nth(1).selectOption('cat_shopping');
    await d.getByRole('button', { name: 'Approve' }).click();
    await page.getByRole('link', { name: /Home/ }).first().click();
    await expect(money(page, 'available-cash')).toHaveText('$1,080.00'); // $120 once, not $240
  });

  test('card payment with no card account asks for the card instead of recording spending', async ({ page }) => {
    await setUp(page);
    await capture(page, 'Paid $300 toward my credit card today');
    await expect(draft(page, 0).getByLabel('Type')).toHaveValue('transfer');
    await expect(draft(page, 0)).toContainText('there is no matching account');
    await expect(page.getByTestId('approve-all')).toBeDisabled();
  });

  test('failures keep the text: too long, nothing understood, and a storage failure while approving', async ({ page }) => {
    await setUp(page);
    const long = 'x'.repeat(4100);
    await capture(page, long);
    await expect(page.getByRole('alert')).toContainText('more than 4,000 characters');
    await expect(page.getByTestId('capture-text')).toHaveValue(long);
    await page.getByRole('button', { name: 'Add manually' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');

    await page.getByTestId('capture-text').fill('Went to the store with my sister');
    await page.getByTestId('capture-read').click();
    await expect(page.getByRole('status').filter({ hasText: 'No amount found in “Went to the store with my sister”' })).toBeVisible();
    await expect(page.getByTestId('capture-text')).toHaveValue('Went to the store with my sister');

    await page.getByTestId('capture-text').fill('$9 at CVS today and $14 at Target today');
    await page.getByTestId('capture-read').click();
    await expect(drafts(page)).toHaveCount(2);
    // simulate the database refusing the write
    await page.evaluate(() => {
      const w = window as unknown as { __put: typeof IDBObjectStore.prototype.put };
      w.__put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function () { throw new DOMException('Simulated failure', 'QuotaExceededError'); };
    });
    await page.getByTestId('approve-all').click();
    await expect(page.getByRole('alert')).toContainText('Nothing was saved');
    await expect(drafts(page)).toHaveCount(2);
    await page.evaluate(() => { IDBObjectStore.prototype.put = (window as unknown as { __put: typeof IDBObjectStore.prototype.put }).__put; });
    await page.getByRole('link', { name: /Home/ }).first().click();
    await expect(money(page, 'available-cash')).toHaveText('$1,200.00'); // nothing partial
    await page.getByRole('link', { name: /Clarity Capture/ }).first().click();
    await page.getByTestId('approve-all').click();
    await expect(drafts(page)).toHaveCount(0);
    await page.getByRole('link', { name: /Home/ }).first().click();
    await expect(money(page, 'available-cash')).toHaveText('$1,177.00');
  });

  test('entry points, keyboard shortcut, drafts cleared on lock, phone layout', async ({ page }) => {
    await setUp(page);
    await page.getByTestId('capture-launch').click();
    await expect(page.getByRole('heading', { name: 'Clarity Capture' })).toBeVisible();
    await page.getByTestId('capture-text').fill('$5 at CVS today');
    await page.getByTestId('capture-read').click();
    await expect(drafts(page)).toHaveCount(1);
    await page.getByRole('link', { name: /^Transactions/ }).first().click();
    await page.getByTestId('tx-capture').click();
    await expect(drafts(page)).toHaveCount(1);
    await page.getByRole('link', { name: /Home/ }).first().click();
    await page.keyboard.press('c');
    await expect(page.getByRole('heading', { name: 'Clarity Capture' })).toBeVisible();
    await page.getByRole('button', { name: 'Lock' }).click();
    await page.getByLabel('Passphrase', { exact: true }).fill('river otter lantern');
    await page.getByLabel('Passphrase', { exact: true }).press('Enter');
    await expect(drafts(page)).toHaveCount(0);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByTestId('capture-text').fill('Today I spent $120 at Costco: $70 groceries, $30 household supplies, and $20 personal care. Paid $300 toward my credit card.');
    await page.getByTestId('capture-read').click();
    await expect(drafts(page)).toHaveCount(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  });
});
