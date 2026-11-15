import { expect, test } from '@playwright/test';
import { addExpense, TODAY } from './helpers';

/**
 * Phase 4A.5.14: two tabs of the same browser on the same stored workspace (the test-mode build, which keeps a real
 * IndexedDB vault). A change decided in a tab whose data is out of date is refused before anything is written, that
 * tab shows the latest data, and the user can try again. Runs against the CLARITY_TEST_MODE=1 build (port 4174).
 */
test('two tabs: a save from the out-of-date tab is refused and that tab is refreshed; an import committed in both tabs is added once', async ({ context }) => {
  const open = async () => { const p = await context.newPage(); await p.clock.setFixedTime(TODAY); await p.goto('/'); await expect(p.getByTestId('month-end')).toBeVisible(); return p; };
  const a = await open();
  const b = await open();
  // tab A adds an expense; tab B still has the data from before
  await addExpense(a, '12.34', 'Tab A Bakery');
  await b.keyboard.press('n');
  await b.getByTestId('amount').fill('5.00');
  await b.getByTestId('merchant').fill('Tab B Cafe');
  await b.getByTestId('save-tx').click();
  await expect(b.getByTestId('form-error')).toHaveText('Clarity was changed in another tab or window, so this change was not saved. The latest data is now shown; check it and try again.');
  await b.getByTestId('save-tx').click(); // trying again, now on the latest data
  await expect(b.getByRole('dialog')).toHaveCount(0);
  await expect(b.getByTestId('recent')).toContainText('Tab A Bakery');
  await expect(b.getByTestId('recent')).toContainText('Tab B Cafe');
  await a.reload();
  await expect(a.getByTestId('recent')).toContainText('Tab B Cafe');

  // both tabs review the same statement; A imports it; B's commit is refused (no duplicate) and B is refreshed
  const csv = 'Date,Description,Amount,Balance\n2026-09-02,CORNER STORE 4411,-7.77,100.00\n';
  for (const p of [a, b]) {
    await p.getByRole('link', { name: 'Import Statement' }).click();
    await p.getByLabel('Import into account').selectOption({ label: 'Everyday Checking' });
    await p.getByTestId('import-file').setInputFiles({ name: 'sep.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await p.getByTestId('to-review').click();
    await expect(p.getByTestId('import-count')).toHaveText('1 selected');
  }
  await a.getByTestId('commit-import').click();
  await expect(a.getByTestId('import-result')).toHaveText('1 new transaction imported');
  await b.getByTestId('commit-import').click();
  await expect(b.getByRole('alert').filter({ hasText: 'changed in another tab or window' })).toBeVisible();
  // reviewing the statement again in B: the row is already in Clarity (added once, by A)
  await b.reload();
  await b.getByRole('link', { name: 'Import Statement' }).click();
  await b.getByLabel('Import into account').selectOption({ label: 'Everyday Checking' });
  await b.getByTestId('import-file').setInputFiles({ name: 'sep.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await b.getByTestId('to-review').click();
  await expect(b.getByTestId('import-count')).toHaveText('0 selected');
  await expect(b.getByTestId('review-table')).toContainText('Already imported');
});
