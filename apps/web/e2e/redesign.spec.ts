import { expect, test, type Page } from '@playwright/test';
import { fresh, onboard, toDashboard } from './helpers';

async function addGroceries(page: Page, amount: string) {
  await page.keyboard.press('n');
  await page.getByTestId('amount').fill(amount);
  await page.getByTestId('merchant').fill('Corner Market');
  await page.getByLabel('Category').selectOption({ label: 'Groceries' });
  await page.getByTestId('save-tx').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test.describe('dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await fresh(page);
    await onboard(page);
    await toDashboard(page);
  });

  test('Safe to Spend breakdown shows the engine arithmetic and adds up', async ({ page }) => {
    const eq = page.getByTestId('sts-breakdown');
    await expect(eq).toContainText('Available cash now$1,200.00');
    await expect(eq).toContainText('Lowest point · Sep 3$1,200.00');
    await expect(eq).toContainText('Safe to Spend$1,200.00');
    // set a reserve: the breakdown and the headline change together
    await page.keyboard.press('6');
    await page.getByLabel('Minimum cash reserve').fill('150');
    await page.getByLabel('Minimum cash reserve').blur();
    await page.keyboard.press('1');
    await expect(page.getByTestId('sts-breakdown')).toContainText('Minimum cash reserve−$150.00');
    await expect(page.getByTestId('safe-to-spend')).toHaveText('$1,050.00');
  });

  test('forecast chart: hover, keyboard and range', async ({ page }) => {
    const chart = page.getByTestId('forecast-chart');
    await expect(chart).toHaveAttribute('aria-label', /Projected \$4,800\.00 on Sep 30\. Lowest \$1,200\.00 on Sep 3\./);
    const box = (await chart.boundingBox())!;
    await page.mouse.move(box.x + box.width - 2, box.y + 60);
    await expect(page.getByTestId('chart-tip')).toContainText('$4,800.00');
    await page.mouse.move(0, 0);
    await chart.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('chart-tip')).toContainText('Sep 4');
    await page.getByRole('button', { name: '90 days' }).click();
    // 90 days from Sep 3 is Dec 2: 1,200 + six paychecks (10,800) − rent on Oct 1, Nov 1, Dec 1 (4,200) = 7,800
    await expect(chart).toHaveAttribute('aria-label', /to Dec 2\. Projected \$7,800\.00/);
    // the headline number does not change with the chart range
    await expect(page.getByTestId('month-end')).toHaveText('$4,800.00');
  });

  test('recent transactions open the editor', async ({ page }) => {
    await addGroceries(page, '60');
    await page.getByTestId('recent').getByRole('button', { name: 'Edit Corner Market' }).click();
    await expect(page.getByRole('dialog')).toContainText('Edit transaction');
  });
});

test.describe('budget and reports', () => {
  test.beforeEach(async ({ page }) => {
    await fresh(page);
    await onboard(page);
    await toDashboard(page);
    await addGroceries(page, '60');
  });

  test('budget: set, overspend, edit, clear, drill into transactions', async ({ page }) => {
    await page.keyboard.press('3');
    await expect(page.getByRole('heading', { name: 'Budget' })).toBeVisible();
    const row = page.getByTestId('budget-cat_groceries');
    await expect(row).toContainText('Not budgeted');
    const input = row.getByRole('textbox');
    await input.fill('50');
    await input.press('Enter');
    await expect(row).toContainText('Over by $10.00');
    await expect(page.getByTestId('budget-left')).toHaveText('$10.00');
    await expect(page.getByText('1 category is over budget')).toBeVisible();
    await row.getByRole('textbox').fill('100');
    await row.getByRole('textbox').blur();
    await expect(row).toContainText('$40.00 left');
    await expect(page.getByTestId('budget-total')).toHaveText('$100.00');
    await expect(page.getByTestId('budget-spent')).toHaveText('$60.00');
    // budgets survive lock and unlock (stored encrypted with the category)
    await page.getByRole('button', { name: 'Lock' }).click();
    await page.getByLabel('Passphrase', { exact: true }).fill('river otter lantern');
    await page.getByRole('button', { name: 'Unlock' }).click();
    await page.keyboard.press('3');
    await expect(page.getByTestId('budget-cat_groceries')).toContainText('$40.00 left');
    await page.getByRole('button', { name: 'Groceries: view transactions' }).click();
    await expect(page.locator('table.data tbody tr:not(.group)')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Clear filters' })).toBeVisible();
    // clearing the amount removes the budget
    await page.keyboard.press('3');
    await page.getByTestId('budget-cat_groceries').getByRole('textbox').fill('');
    await page.getByTestId('budget-cat_groceries').getByRole('textbox').blur();
    await expect(page.getByTestId('budget-cat_groceries')).toContainText('Not budgeted');
  });

  test('reports use recorded transactions only and link to them', async ({ page }) => {
    await page.keyboard.press('5');
    await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible();
    await expect(page.getByTestId('report-net')).toHaveText('−$60.00');
    await expect(page.getByTestId('report-categories')).toContainText('Groceries');
    await expect(page.getByTestId('report-categories')).toContainText('100%');
    await expect(page.getByTestId('report-table')).toContainText('September 2026 · so far');
    await page.getByTestId('report-categories').getByRole('button').click();
    await expect(page.locator('table.data tbody tr:not(.group)')).toHaveCount(1);
  });
});

test.describe('phone-width layout', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('tab bar navigation, add from the tab bar, no sideways scrolling on any page', async ({ page }) => {
    await fresh(page);
    await onboard(page);
    await toDashboard(page);
    await expect(page.locator('.sidebar')).toBeHidden();
    const bar = page.getByRole('navigation', { name: 'Main (compact)' });
    await expect(bar).toBeVisible();
    await bar.getByRole('button', { name: 'Add Transaction' }).click();
    await page.getByTestId('amount').fill('12');
    await page.getByTestId('merchant').fill('Bakery');
    await page.getByTestId('save-tx').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const noOverflow = async () => expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await noOverflow();
    await bar.getByRole('link', { name: 'Transactions' }).click();
    await expect(page.locator('table.data')).toContainText('Bakery');
    await noOverflow();
    await bar.getByRole('link', { name: 'Planning' }).click();
    await noOverflow();
    for (const name of ['Budget', 'Reports', 'Import Statement', 'Settings', 'Privacy Center']) {
      await bar.getByRole('button', { name: 'More' }).click();
      await page.getByRole('dialog').getByRole('link', { name }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(page.getByRole('heading', { level: 1 })).toContainText(name);
      await noOverflow();
    }
  });
});
