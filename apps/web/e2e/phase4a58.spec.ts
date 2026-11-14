import { expect, test, type Page } from '@playwright/test';
import { fresh, PASS, toDashboard } from './helpers';

/**
 * Phase 4A.5.8 through the real UI: signed balances, card credit, the "Already included" rules, the pending-match
 * safeguard in Update balance, per-account transfer inclusion, backdated entries and history labels.
 * Sample data: Safe to Spend $2,427.17, Everyday Checking $2,871.23 (opened Oct 14). Today is Fri, Nov 13, 2026.
 */
async function sample(page: Page) {
  await page.clock.setFixedTime(new Date('2026-11-13T10:00:00'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore sample data' }).click();
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,427.17');
}
const go = (page: Page, path: string) => page.evaluate((p) => { history.pushState({}, '', p); dispatchEvent(new PopStateEvent('popstate')); scrollTo(0, 0); }, path);
async function addAccount(page: Page, name: string, type: string, amount: string, cardMode?: 'Owed' | 'In credit') {
  await go(page, '/settings');
  await page.getByRole('button', { name: 'Add account' }).click();
  const a = page.getByRole('dialog');
  await a.getByLabel('Name').fill(name);
  await a.getByRole('group', { name: 'Account type' }).getByRole('button', { name: type }).click();
  if (cardMode) await a.getByRole('group', { name: 'Card balance' }).getByRole('button', { name: cardMode }).click();
  await a.getByLabel(type === 'Credit card' ? (cardMode === 'In credit' ? 'Credit on the card today' : 'Amount owed today') : 'Balance today').fill(amount);
  return a;
}
async function addPendingRefund(page: Page, cents: string, merchant: string) {
  await page.keyboard.press('n');
  const d = page.getByRole('dialog');
  await d.getByRole('button', { name: 'Refund', exact: true }).click();
  await d.getByTestId('amount').fill(cents);
  await d.getByTestId('merchant').fill(merchant);
  await d.getByRole('button', { name: 'Notes, split or pending' }).click();
  await d.getByLabel(/Pending/).check();
  await d.getByTestId('save-tx').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test('D1: an overdrawn account keeps its minus sign; invalid input gets a message', async ({ page }) => {
  await sample(page);
  let a = await addAccount(page, 'Overdrawn', 'Checking', '5-0');
  await a.getByRole('button', { name: 'Save' }).click();
  await expect(a).toContainText('Enter a balance like 1250.00, or -50.00 if the account is overdrawn.');
  await a.getByLabel('Balance today').fill('-50');
  await a.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('−$50.00').first()).toBeVisible();
  await go(page, '/');
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,377.17'); // 2,427.17 − 50 (not + 50)
  await expect(page.getByTestId('warnings')).toContainText('Overdrawn is overdrawn: −$50.00 today');
  // update it to a different negative figure
  await go(page, '/settings');
  await page.getByRole('button', { name: 'Update balance of Overdrawn' }).click();
  a = page.getByRole('dialog');
  await expect(a.getByLabel('Posted balance per bank')).toHaveValue('-50.00');
  await a.getByLabel('Posted balance per bank').fill('-120');
  await expect(a.getByTestId('adjustment-preview')).toContainText('−$70.00');
  await a.getByRole('button', { name: 'Record adjustment' }).click();
  await go(page, '/');
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,307.17');
});

test('D1 in onboarding: "-100" stays −$100 (it was saved as +$100 before Phase 4A.5.8)', async ({ page }) => {
  await fresh(page);
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByLabel('Passphrase', { exact: true }).fill(PASS);
  await page.getByLabel('Confirm passphrase').fill(PASS);
  await page.getByRole('checkbox', { name: /Create a recovery key/ }).uncheck();
  await page.getByRole('checkbox', { name: /cannot be recovered/ }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Current checking balance').fill('-100');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Skip' }).click();
  await page.getByRole('button', { name: 'Skip' }).click();
  await expect(page.getByTestId('overview-month-end')).toHaveText('−$100.00');
  await toDashboard(page);
  await expect(page.getByTestId('safe-to-spend')).toHaveText('Short by $100.00'); // how a negative Safe to Spend is shown
});

test('D4: a card in credit is shown and reconciled as a credit, never as money owed', async ({ page }) => {
  await sample(page);
  const a = await addAccount(page, 'Store card', 'Credit card', '50', 'In credit');
  await a.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('In credit $50.00')).toBeVisible();
  await go(page, '/');
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,427.17'); // a credit isn't spendable and nothing is owed
  await go(page, '/settings');
  await page.getByRole('button', { name: 'Update balance of Store card' }).click();
  const u = page.getByRole('dialog');
  await expect(u.getByTestId('update-balance-hint')).toContainText("Clarity's posted balance is $50.00 in credit.");
  await expect(u.getByLabel('Posted credit per bank')).toHaveValue('50.00');
  await expect(u.getByRole('button', { name: 'Confirm balance' })).toBeEnabled();
  await u.getByRole('group', { name: 'Card balance per bank' }).getByRole('button', { name: 'Owed' }).click();
  await u.getByLabel('Posted amount owed per bank').fill('30');
  await expect(u.getByTestId('adjustment-preview')).toContainText('+$80.00 to the amount owed');
  await u.getByLabel('Posted amount owed per bank').fill('-30');
  await expect(u).toContainText('Enter the amount without a sign, then choose Owed or In credit.');
  await u.getByLabel('Posted amount owed per bank').fill('30');
  await u.getByRole('button', { name: 'Record adjustment' }).click();
  await expect(page.getByText('Owed $30.00')).toBeVisible();
  await go(page, '/');
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,397.17');
});

test('D2/D8: a difference that matches a pending item must be resolved; marking it posted reconciles once, with no adjustment', async ({ page }) => {
  await sample(page);
  await addPendingRefund(page, '300', 'Store return');
  await go(page, '/settings');
  await page.getByRole('button', { name: 'Update balance of Everyday Checking' }).click();
  const u = page.getByRole('dialog');
  await u.getByLabel('Posted balance per bank').fill('3171.23'); // the refund has cleared at the bank
  const m = u.getByTestId('pending-match');
  await expect(m).toContainText('This difference matches pending items');
  await expect(m).toContainText('Nov 13');
  await expect(m).toContainText('Store return · Refund · pending');
  await expect(m).toContainText('+$300.00');
  await expect(u.getByRole('button', { name: 'Record adjustment' })).toBeDisabled();
  await m.getByRole('button', { name: 'Mark Store return posted' }).click();
  await expect(u.getByTestId('balance-matches')).toBeVisible();
  await u.getByRole('button', { name: 'Confirm balance' }).click();
  await expect(page.getByText("Everyday Checking matches your bank's posted balance as of Nov 13. No adjustment needed.")).toBeVisible();
  await go(page, '/');
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,727.17'); // +300 once
  await expect(page.getByTestId('available-cash')).toHaveText('$3,171.23');
  // the "unrelated" path keeps the item pending and records the adjustment
  await addPendingRefund(page, '40', 'Second return');
  await go(page, '/settings');
  await page.getByRole('button', { name: 'Update balance of Everyday Checking' }).click();
  await u.getByLabel('Posted balance per bank').fill('3211.23');
  await u.getByTestId('pending-unrelated').check();
  await u.getByRole('button', { name: 'Record adjustment' }).click();
  await go(page, '/');
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,767.17'); // +40 adjustment; the pending $40 still not spendable
  await page.getByTestId('why-sts').click();
  await expect(page.getByRole('dialog')).toContainText('Everyday Checking: pending credit not yet available');
  await expect(page.getByRole('dialog')).toContainText('−$40.00');
});

test('D3/D5: "Already included" is never offered for pending items; a transfer decides each account separately', async ({ page }) => {
  await sample(page);
  const a = await addAccount(page, 'New checking', 'Checking', '800');
  await a.getByRole('button', { name: 'Save' }).click();
  await go(page, '/');
  const cash0 = await page.getByTestId('available-cash').textContent();
  await page.keyboard.press('n');
  const d = page.getByRole('dialog');
  await d.getByRole('button', { name: 'Income', exact: true }).click();
  await d.getByTestId('amount').fill('300');
  await d.getByLabel('Account', { exact: true }).selectOption({ label: 'New checking' });
  await expect(d.getByTestId('already-included')).toBeVisible();
  await d.getByRole('button', { name: 'Notes, split or pending' }).click();
  await d.getByLabel(/Pending/).check();
  await expect(d.getByTestId('already-included')).toHaveCount(0);
  await d.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // transfer from the new account (balance entered today) to Everyday Checking (opened Oct 14)
  await page.getByRole('button', { name: /^Add Transaction/ }).first().click();
  await d.getByRole('button', { name: 'Transfer', exact: true }).click();
  await d.getByTestId('amount').fill('200');
  await d.getByLabel('From account').selectOption({ label: 'New checking' });
  await d.getByLabel('To account').selectOption({ label: 'Everyday Checking' });
  await expect(d.getByTestId('already-included')).toContainText("Already included in New checking's balance as of Nov 13");
  await expect(d.getByTestId('already-included-to')).toHaveCount(0); // Everyday Checking's balance can't include it
  await d.getByTestId('already-included').getByRole('checkbox').check();
  await d.getByTestId('save-tx').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  // New checking stays $800 (already after the move); Everyday Checking gains $200: available cash +200, not 0 (audit TR1)
  const n = (t: string | null) => Number(t!.replace(/[$,]/g, ''));
  await expect.poll(async () => n(await page.getByTestId('available-cash').textContent()) - n(cash0)).toBe(200);
});

test('D6/D7: a backdated purchase after a confirmed balance is history, labelled, and not added again', async ({ page }) => {
  await sample(page);
  await go(page, '/settings');
  await page.getByRole('button', { name: 'Update balance of Everyday Checking' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm balance' }).click();
  await go(page, '/');
  await page.keyboard.press('n');
  const d = page.getByRole('dialog');
  await d.getByTestId('amount').fill('25');
  await d.getByTestId('merchant').fill('Late receipt');
  await d.getByLabel('Account', { exact: true }).selectOption({ label: 'Everyday Checking' });
  await d.getByLabel('Date').fill('2026-11-10');
  await expect(d.getByTestId('already-included').getByRole('checkbox')).toBeChecked(); // before the Nov 13 confirmation
  await d.getByTestId('save-tx').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('safe-to-spend')).toHaveText('$2,427.17');
  await go(page, '/transactions');
  await page.getByLabel('Search transactions').fill('Late receipt');
  const badge = page.getByTestId('history-only').first();
  await expect(badge).toHaveText('Already in balance · Nov 13');
  await expect(badge).toHaveAttribute('title', 'Already included in balance as of Nov 13. Kept in history, not added again.');
});
