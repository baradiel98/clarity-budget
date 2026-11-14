import { expect, test, type Page } from '@playwright/test';
import { fresh, onboard, toDashboard } from './helpers';

/** Phase 2: dashboard reconciliation and explanations, chart, transactions totals, responsive layout. */
async function sampleOn(page: Page, date: string, width = 1440) {
  await page.clock.setFixedTime(new Date(`${date}T10:00:00`));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width, height: 1000 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore sample data' }).click();
  await expect(page.getByTestId('month-end')).toBeVisible();
}

test.describe('dashboard (sample data, Nov 13 2026)', () => {
  test('every item behind the month-end figure is listed; Safe to Spend explains the later items', async ({ page }) => {
    await sampleOn(page, '2026-11-13');
    await expect(page.getByTestId('month-end')).toHaveText('$4,077.17');
    await expect(page.getByRole('heading', { name: /Upcoming · through Nov 30/ })).toBeVisible();
    const up = page.getByTestId('upcoming');
    for (const [name, amt] of [['Electricity', '−$91.40'], ['Paycheck', '+$1,860.00'], ['Phone', '−$65.00'], ['Card payment', '−$247.66'], ['Savings', '−$250.00']] as const) {
      await expect(up.locator('.list-row', { hasText: name })).toContainText(amt);
    }
    // Phase 4A: Safe to Spend now covers the Dec 1 rent (horizon = end of next month); it was $2,579.83 when it stopped at Nov 30.
    await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,427.17');
    await expect(page.getByTestId('sts-after')).toHaveText("Electricity, Phone, Card payment and Savings ($421.89) come after Dec 1, once $5,580.00 has come in. Your balance stays at or above the Dec 1 low through Dec 31, so they don't lower Safe to Spend.");
    // "Why this number?" lists the later items too
    await page.getByTestId('why-sts').click();
    await expect(page.getByRole('dialog')).toContainText("after the lowest point, doesn't lower it");
    await page.keyboard.press('Escape');
  });

  test('upcoming states are explained and estimated amounts are marked; record/mark paid still offered', async ({ page }) => {
    await sampleOn(page, '2026-11-13');
    const elec = page.getByTestId('upcoming').locator('.list-row', { hasText: 'Electricity' });
    await expect(elec.locator('.badge')).toHaveAttribute('title', /estimate/);
    await expect(elec.getByLabel('about')).toHaveText('≈');
    await expect(elec.getByRole('button', { name: 'Mark paid' })).toBeVisible();
    const pay = page.getByTestId('upcoming').locator('.list-row', { hasText: 'Paycheck' });
    await expect(pay.locator('.badge')).toHaveAttribute('title', /not received yet/);
    await expect(pay.getByRole('button', { name: 'Record' })).toBeVisible();
    await expect(page.getByText('Nothing here is recorded until you record it or mark it paid.')).toBeVisible();
  });

  test('repeated figures are said in words, not just repeated', async ({ page }) => {
    await sampleOn(page, '2026-11-13');
    await expect(page.getByText('Same low point (Nov 18), before your Nov 19 income')).toBeVisible();
    await expect(page.getByText('Nothing else is scheduled today')).toBeVisible();
    // "Why this number?" still available on every metric
    await expect(page.getByRole('button', { name: /Why this number\?/ })).toHaveCount(6);
  });

  test('chart fills its card, labels do not collide, and stays usable on a phone', async ({ page }) => {
    await sampleOn(page, '2026-11-13', 1440);
    const area = page.locator('.chart-area');
    expect((await area.boundingBox())!.height).toBeGreaterThan(300);
    const noCollisions = async () => {
      const boxes = await page.locator('.chart-area text.fc-x').evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => [r.left, r.right]));
      boxes.sort((a, b) => a[0]! - b[0]!);
      for (let i = 1; i < boxes.length; i++) expect(boxes[i]![0]!).toBeGreaterThanOrEqual(boxes[i - 1]![1]!);
      return boxes.length;
    };
    expect(await noCollisions()).toBeGreaterThanOrEqual(4);
    await expect(page.locator('.chart-area text.fc-x.strong')).toHaveText('Today');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(150);
    expect(await noCollisions()).toBeGreaterThanOrEqual(2);
    expect((await area.boundingBox())!.height).toBeGreaterThanOrEqual(247);
  });
});

test('transactions: totals say what they cover; planned items are listed but not totalled', async ({ page }) => {
  await fresh(page); // Sep 3, 2026
  await onboard(page);
  await toDashboard(page);
  await page.keyboard.press('n');
  await page.getByTestId('amount').fill('100');
  await page.getByTestId('merchant').fill('Concert tickets');
  await page.getByLabel('Date', { exact: true }).fill('2026-09-20');
  await page.getByTestId('save-tx').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.keyboard.press('n');
  await page.getByTestId('amount').fill('25');
  await page.getByTestId('merchant').fill('Bakery');
  await page.getByTestId('save-tx').click();
  await page.getByRole('link', { name: /^Transactions/ }).first().click();
  await expect(page.getByTestId('tx-scope')).toHaveText('Totals for 1 recorded transaction · September 2026 · 1 planned not included');
  await expect(page.getByTestId('tx-totals')).toContainText('$25.00');
  await expect(page.getByTestId('tx-planned')).toContainText('−$100.00');
  await expect(page.locator('tr.planned')).toContainText('Concert tickets');
  await expect(page.locator('tr.planned')).toContainText('Planned');
  await page.getByLabel('Search transactions').fill('bak');
  await expect(page.getByTestId('tx-scope')).toHaveText('Totals for 1 recorded transaction · September 2026 · filtered');
  await expect(page.getByTestId('tx-planned')).toHaveCount(0);
});

test('one content width; no horizontal scroll on Home and Transactions from phone to 2048px', async ({ page }) => {
  const expected: Record<number, number> = { 1280: 971, 1440: 1122, 1920: 1440, 2048: 1440 };
  for (const w of [390, 834, 1280, 1440, 1920, 2048]) {
    await sampleOn(page, '2026-11-13', w);
    for (const name of ['Home', 'Transactions']) {
      // the sidebar on desktop and the tab bar on phones both have these links
      await page.getByRole('link', { name: new RegExp(`^${name}`) }).first().click();
      await page.waitForTimeout(100);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), `${name} @ ${w}`).toBeLessThanOrEqual(0);
      if (expected[w]) expect(Math.round(await page.locator('.main-inner').evaluate((e) => e.getBoundingClientRect().width)), `${name} @ ${w}`).toBe(expected[w]);
    }
  }
});
