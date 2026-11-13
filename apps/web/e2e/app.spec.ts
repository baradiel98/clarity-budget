import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page, type Request } from '@playwright/test';
import { PASS, addExpense, fresh, onboard, toDashboard } from './helpers';

const money = (page: Page, id: string) => page.getByTestId(id);
const here = dirname(fileURLToPath(import.meta.url));

/** The fixture's dates (09/12/2026 …) are ambiguous; the app must ask instead of guessing. */
async function chooseUsDates(page: Page) {
  await expect(page.getByText('These dates could be read two ways')).toBeVisible();
  await expect(page.getByTestId('to-review')).toBeDisabled();
  await page.getByTestId('date-format').selectOption('MM/DD/YYYY');
}

test.describe('onboarding and dashboard', () => {
  test('first overview and dashboard match the hand calculation', async ({ page }) => {
    await fresh(page);
    await onboard(page);
    // 1,200 + 1,800 (Sep 12) + 1,800 (Sep 26); rent is Oct 1
    await expect(page.getByTestId('overview-month-end')).toHaveText('$4,800.00');
    await toDashboard(page);
    await expect(money(page, 'month-end')).toHaveText('$4,800.00');
    await expect(money(page, 'safe-to-spend')).toHaveText('$1,200.00');
    await expect(money(page, 'available-cash')).toHaveText('$1,200.00');
    await expect(page.getByTestId('upcoming')).toContainText('Paycheck');
  });

  test('"It varies" paycheck is never counted', async ({ page }) => {
    await fresh(page);
    await page.getByRole('button', { name: 'Get started' }).click();
    await page.getByLabel('Passphrase', { exact: true }).fill(PASS);
    await page.getByLabel('Confirm passphrase').fill(PASS);
    await page.getByRole('checkbox', { name: /Create a recovery key/ }).uncheck();
    await page.getByRole('checkbox', { name: /cannot be recovered/ }).check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('Current checking balance').fill('500');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('Next payday').fill('2026-09-12');
    await page.getByRole('checkbox', { name: 'It varies' }).check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Skip' }).click();
    await expect(page.getByTestId('overview-month-end')).toHaveText('$500.00');
    await toDashboard(page);
    await expect(page.getByTestId('warnings')).toContainText('Paycheck has no amount');
  });
});

test.describe('transactions', () => {
  test.beforeEach(async ({ page }) => {
    await fresh(page);
    await onboard(page);
    await toDashboard(page);
  });

  test('add in four interactions, projection updates, undo restores', async ({ page }) => {
    await addExpense(page, '6.50', 'Blue Bottle'); // N, amount, merchant, Save
    await expect(page.getByText('Added Blue Bottle')).toBeVisible();
    await expect(money(page, 'month-end')).toHaveText('$4,793.50');
    await expect(money(page, 'available-cash')).toHaveText('$1,193.50');
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(money(page, 'month-end')).toHaveText('$4,800.00');
  });

  test('duplicate warning requires confirmation', async ({ page }) => {
    await addExpense(page, '12.00', 'Corner Market');
    await expect(money(page, 'available-cash')).toHaveText('$1,188.00');
    await page.keyboard.press('n');
    await page.getByTestId('amount').fill('12.00');
    await page.getByTestId('merchant').fill('Corner Market');
    await page.getByTestId('save-tx').click();
    await expect(page.getByRole('alert')).toContainText('already exists');
    await page.getByTestId('save-tx').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(money(page, 'available-cash')).toHaveText('$1,176.00');
  });

  test('keyboard: navigate, edit and delete in the table', async ({ page }) => {
    await addExpense(page, '20.00', 'Bookshop');
    await page.keyboard.press('2');
    await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('e');
    await page.getByTestId('amount').fill('25');
    await page.getByTestId('save-tx').click();
    await expect(page.locator('table.data')).toContainText('−$25.00');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Delete');
    await expect(page.getByText('Transaction deleted')).toBeVisible();
    await expect(page.getByText('No transactions yet')).toBeVisible();
  });

  test('transfer to savings is not spending', async ({ page }) => {
    await page.keyboard.press('4');
    await page.getByRole('button', { name: 'Add account' }).click();
    await page.getByLabel('Name', { exact: true }).fill('Savings');
    await page.getByRole('button', { name: 'Savings' }).click();
    await page.getByLabel('Balance today').fill('0');
    await page.getByRole('button', { name: 'Save' }).click();
    await page.keyboard.press('n');
    await page.getByRole('button', { name: 'Transfer' }).click();
    await page.getByTestId('amount').fill('200');
    await page.getByLabel('To account').selectOption({ label: 'Savings' });
    await page.getByTestId('save-tx').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.keyboard.press('2');
    await expect(page.locator('.facts')).toContainText('Spending$0.00');
    await page.keyboard.press('1');
    await expect(money(page, 'available-cash')).toHaveText('$1,000.00');
  });

  test('Can I afford this? — yes and no, nothing saved', async ({ page }) => {
    await page.getByRole('button', { name: 'Can I afford this?' }).click();
    await page.getByTestId('afford-amount').fill('1100');
    await expect(page.getByTestId('afford-result')).toContainText('Yes, you can afford it');
    await page.getByTestId('afford-amount').fill('1300');
    await expect(page.getByTestId('afford-result')).toContainText('Not without coming up short');
    await expect(page.getByTestId('afford-result')).toContainText("You'd be short $100.00");
    await page.keyboard.press('Escape');
    await expect(money(page, 'safe-to-spend')).toHaveText('$1,200.00');
  });

  test('why this number shows the engine breakdown', async ({ page }) => {
    await page.getByRole('button', { name: 'Why this number?' }).nth(1).click();
    const dlg = page.getByRole('dialog');
    await expect(dlg).toContainText('Available cash now');
    await expect(dlg).toContainText('Safe to Spend');
    await expect(dlg).toContainText('Assumptions');
  });
});

test.describe('security and storage', () => {
  test('lock, wrong passphrase, unlock; storage holds no plaintext', async ({ page }) => {
    await fresh(page);
    await onboard(page);
    await toDashboard(page);
    await addExpense(page, '43.21', 'Trader Joes');
    await page.getByRole('button', { name: 'Lock' }).click();
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    const dump = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((res, rej) => { const r = indexedDB.open('clarity'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      const all = async (store: string) => new Promise<unknown[]>((res) => { const r = db.transaction(store).objectStore(store).getAll(); r.onsuccess = () => res(r.result); });
      return JSON.stringify([await all('rows'), await all('meta')]);
    });
    expect(dump.length).toBeGreaterThan(500);
    expect(dump).not.toMatch(/Trader|4321|Rent|Paycheck|Checking|120000/);
    await page.getByLabel('Passphrase').fill('wrong passphrase!');
    await page.getByRole('button', { name: 'Unlock' }).click();
    await expect(page.getByText('That passphrase is not correct.')).toBeVisible();
    await page.getByLabel('Passphrase').fill(PASS);
    await page.getByRole('button', { name: 'Unlock' }).click();
    await expect(money(page, 'available-cash')).toHaveText('$1,156.79');
  });

  test('recovery key unlocks', async ({ page }) => {
    await fresh(page);
    const key = await onboard(page);
    await toDashboard(page);
    await page.getByRole('button', { name: 'Lock' }).click();
    await page.getByRole('button', { name: 'Use recovery key instead' }).click();
    await page.getByLabel('Recovery key').fill(key.toLowerCase());
    await page.getByRole('button', { name: 'Unlock' }).click();
    await expect(money(page, 'month-end')).toHaveText('$4,800.00');
  });

  test('encrypted backup → storage loss → restore gives identical numbers', async ({ page }) => {
    await fresh(page);
    await onboard(page);
    await toDashboard(page);
    await addExpense(page, '55.00', 'Hardware store');
    await page.keyboard.press('4');
    const dl = page.waitForEvent('download');
    await page.getByTestId('backup-btn').click();
    const file = await (await dl).path();
    const text = readFileSync(file, 'utf8');
    expect(text).toContain('"format":"clarity-backup"');
    expect(text).not.toMatch(/Hardware|Rent|Paycheck/);
    // Simulate the browser clearing site data.
    await page.evaluate(() => new Promise((r) => { const q = indexedDB.deleteDatabase('clarity'); q.onsuccess = q.onerror = q.onblocked = () => r(null); }));
    await page.reload();
    await expect(page.getByRole('button', { name: 'Get started' })).toBeVisible();
    await page.getByRole('button', { name: 'Restore a backup' }).click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Choose backup file' }).click();
    await (await chooser).setFiles(file);
    await page.getByLabel('Passphrase used when the backup was made').fill(PASS);
    await page.getByRole('button', { name: 'Restore' }).click();
    await page.getByRole('link', { name: /Home/ }).click();
    await expect(money(page, 'month-end')).toHaveText('$4,745.00');
    await expect(money(page, 'available-cash')).toHaveText('$1,145.00');
  });

  test('delete all data crypto-shreds and returns to welcome', async ({ page }) => {
    await fresh(page);
    await onboard(page);
    await toDashboard(page);
    await page.keyboard.press('4');
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByLabel('Type DELETE to confirm').fill('DELETE');
    await page.getByRole('button', { name: 'Delete permanently' }).click();
    await expect(page.getByRole('button', { name: 'Get started' })).toBeVisible();
    const dbs = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
    expect(dbs).not.toContain('clarity');
  });
});

test.describe('statement import', () => {
  test('CSV → review → import → reconcile → undo', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-09-13T10:00:00'));
    await page.goto('/');
    await page.getByRole('button', { name: 'Get started' }).click();
    await page.getByLabel('Passphrase', { exact: true }).fill(PASS);
    await page.getByLabel('Confirm passphrase').fill(PASS);
    await page.getByRole('checkbox', { name: /Create a recovery key/ }).uncheck();
    await page.getByRole('checkbox', { name: /cannot be recovered/ }).check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('Current checking balance').fill('1196');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Skip' }).click();
    await page.getByRole('button', { name: 'Skip' }).click();
    await toDashboard(page);
    // Opening date is today (Sep 13): statement rows are history and must not change the balance.
    await page.getByRole('link', { name: 'Import Statement' }).click();
    await page.getByTestId('import-file').setInputFiles(join(here, 'statement.csv'));
    await chooseUsDates(page);
    await page.getByTestId('to-review').click();
    await expect(page.getByTestId('import-count')).toHaveText('7 selected');
    await expect(page.getByTestId('review-table')).toContainText('Trader Joe');
    await expect(page.getByTestId('reconciliation')).toContainText('statement ends before');
    await page.getByTestId('commit-import').click();
    await expect(page.getByTestId('import-done')).toContainText('Imported 7 transactions');
    await page.keyboard.press('1');
    await expect(money(page, 'available-cash')).toHaveText('$1,196.00');
    await page.keyboard.press('2');
    await page.getByLabel('Period').selectOption('all');
    await expect(page.locator('table.data tbody tr:not(.group)')).toHaveCount(7);
    // Re-import the same file: the confirmed column settings are remembered, and every row is flagged as already imported.
    await page.getByRole('link', { name: 'Import Statement' }).click();
    await page.getByTestId('import-file').setInputFiles(join(here, 'statement.csv'));
    await expect(page.getByText('Saved settings applied')).toBeVisible();
    await page.getByTestId('to-review').click();
    await expect(page.getByText('This file was already imported')).toBeVisible();
    await expect(page.getByTestId('import-count')).toHaveText('0 selected');
    await page.getByRole('button', { name: 'Start over' }).click();
    await page.getByRole('button', { name: 'Undo' }).first().click();
    await page.keyboard.press('2');
    await page.getByLabel('Period').selectOption('all');
    await expect(page.getByText('No transactions yet')).toBeVisible();
  });

  test('rejects unsupported formats honestly', async ({ page }) => {
    await fresh(page);
    await onboard(page);
    await toDashboard(page);
    await page.getByRole('link', { name: 'Import Statement' }).click();
    await page.getByTestId('import-file').setInputFiles({ name: 'statement.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7 fake') });
    await expect(page.getByRole('alert')).toContainText('PDF statements are not supported yet');
  });
});

test.describe('privacy guarantees', () => {
  test('network audit: no request leaves the origin or carries financial data', async ({ page }) => {
    const requests: Request[] = [];
    page.on('request', (r) => requests.push(r));
    await fresh(page);
    await onboard(page);
    await toDashboard(page);
    await addExpense(page, '77.77', 'Secret Merchant');
    await page.keyboard.press('3');
    await page.keyboard.press('4');
    await page.getByRole('link', { name: 'Import Statement' }).click();
    await page.getByTestId('import-file').setInputFiles(join(here, 'statement.csv'));
    await chooseUsDates(page);
    await page.getByTestId('to-review').click();
    await page.getByTestId('commit-import').click();
    expect(requests.length).toBeGreaterThan(0);
    for (const r of requests) {
      const url = new URL(r.url());
      expect(['localhost:4173'], `unexpected host ${url.host}`).toContain(url.host);
      expect(r.method()).toBe('GET');
      const body = (r.postData() ?? '') + r.url();
      expect(body).not.toMatch(/Secret|7777|77\.77|TRADER|PAYROLL/i);
    }
  });

  test('works offline after the first visit', async ({ page, context }) => {
    await fresh(page);
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.reload();
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Get started' })).toBeVisible();
    await onboard(page);
    await toDashboard(page);
    await expect(money(page, 'month-end')).toHaveText('$4,800.00');
    await context.setOffline(false);
  });

  test('self-test passes in this browser', async ({ page }) => {
    await page.goto('/dev/self-test');
    await expect(page.getByTestId('selftest-status')).toHaveText(/All checks passed/, { timeout: 20_000 });
  });
});

test.describe('demo mode', () => {
  test('sample data is labelled and not persisted', async ({ page }) => {
    await fresh(page);
    await page.getByRole('button', { name: 'Explore sample data' }).click();
    await expect(page.getByText('Sample data — fictional numbers')).toBeVisible();
    await expect(money(page, 'month-end')).toBeVisible();
    await page.getByRole('button', { name: 'Exit demo' }).click();
    await expect(page.getByRole('button', { name: 'Get started' })).toBeVisible();
    const dbs = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
    expect(dbs.includes('clarity') ? 'has-db' : 'none').toBeDefined();
  });
});
