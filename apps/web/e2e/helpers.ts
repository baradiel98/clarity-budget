import { expect, type Page } from '@playwright/test';

export const PASS = 'river otter lantern';
export const TODAY = new Date('2026-09-03T10:00:00');

/** Fixed clock (Date only; timers keep running) and a clean origin. */
export async function fresh(page: Page) {
  await page.clock.setFixedTime(TODAY);
  await page.goto('/');
}

export async function onboard(page: Page, opts: { withBill?: boolean } = {}) {
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByLabel('Passphrase', { exact: true }).fill(PASS);
  await page.getByLabel('Confirm passphrase').fill(PASS);
  await page.getByRole('button', { name: 'Continue' }).click();
  const key = (await page.getByTestId('recovery-key').textContent())!;
  await page.getByLabel(/type the last group/).fill(key.split('-').pop()!);
  await page.getByRole('button', { name: "I've saved it" }).click();
  await page.getByLabel('Current checking balance').fill('1200');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Next payday').fill('2026-09-12');
  await page.getByLabel('Usual paycheck amount (optional)').fill('1800');
  await page.getByRole('button', { name: 'Continue' }).click();
  if (opts.withBill === false) {
    await page.getByRole('button', { name: 'Skip' }).click();
  } else {
    await page.getByLabel('Name').fill('Rent');
    await page.getByLabel('Amount').fill('1400');
    await page.getByLabel('Due date').fill('2026-10-01');
    await page.getByRole('button', { name: 'See my overview' }).click();
  }
  await expect(page.getByTestId('overview-month-end')).toBeVisible();
  return key;
}

export async function toDashboard(page: Page) {
  await page.getByTestId('go-dashboard').click();
  await expect(page.getByTestId('month-end')).toBeVisible();
}

export async function addExpense(page: Page, amount: string, merchant: string) {
  await page.keyboard.press('n');
  await page.getByTestId('amount').fill(amount);
  await page.getByTestId('merchant').fill(merchant);
  await page.getByTestId('save-tx').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
