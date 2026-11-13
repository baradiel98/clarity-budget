import { expect, test, type Page } from '@playwright/test';
import { fresh, onboard, PASS, toDashboard } from './helpers';

const SECRET = 'preview-password-123';

async function openFromLock(page: Page) {
  await fresh(page);
  await onboard(page);
  await toDashboard(page);
  await page.getByRole('button', { name: 'Lock' }).click();
  await page.getByRole('button', { name: /Preview: account sign-in/ }).click();
  await expect(page.getByRole('heading', { name: 'Welcome to Clarity' })).toBeVisible();
}

/** Every value in every browser storage area, as one string. */
const allStorage = (page: Page) =>
  page.evaluate(async () => {
    const out: string[] = [JSON.stringify({ ...localStorage }), JSON.stringify({ ...sessionStorage })];
    for (const info of await indexedDB.databases()) {
      const db = await new Promise<IDBDatabase>((res, rej) => { const r = indexedDB.open(info.name!); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      for (const store of [...db.objectStoreNames]) {
        out.push(JSON.stringify(await new Promise((res) => { const r = db.transaction(store).objectStore(store).getAll(); r.onsuccess = () => res(r.result); })));
      }
      db.close();
    }
    return out.join('\n');
  });

test.describe('account sign-in preview (not connected)', () => {
  test('clearly labelled; validation; submitting sends and stores nothing and says so', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await openFromLock(page);
    await expect(page.getByText('Preview · not connected')).toBeVisible();
    await expect(page.getByText('Your financial picture, all in one place.')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');

    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByText('Enter your email address.')).toBeVisible();
    await expect(page.getByText('Enter your password.')).toBeVisible();
    await page.getByLabel('Email').fill('not-an-email');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByText(/Enter a valid email address/)).toBeVisible();

    await page.getByLabel('Email').fill('someone@example.com');
    await page.getByLabel('Password', { exact: true }).fill(SECRET);
    await page.getByRole('button', { name: 'Show password' }).click();
    await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'text');

    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    await page.getByLabel('Password', { exact: true }).press('Enter');
    await expect(page.getByRole('heading', { name: 'Accounts aren’t available yet' })).toBeVisible();
    await expect(page.getByText('Nothing was sent and no account was checked.')).toBeVisible();
    expect(requests).toEqual([]);
    expect(await allStorage(page)).not.toContain(SECRET);
    expect(await allStorage(page)).not.toContain('someone@example.com');
    expect(errors).toEqual([]);
  });

  test('create account and forgot password are honest previews too', async ({ page }) => {
    await openFromLock(page);
    await page.getByRole('button', { name: 'Create an account' }).click();
    await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
    await page.getByLabel('Email').fill('someone@example.com');
    await page.getByLabel('Password', { exact: true }).fill('short');
    await page.getByLabel('Confirm password').fill('different');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByText('Use at least 10 characters.')).toBeVisible();
    await page.getByLabel('Password', { exact: true }).fill(SECRET);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByText('The passwords don’t match.')).toBeVisible();
    await page.getByLabel('Confirm password').fill(SECRET);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByRole('heading', { name: 'No account was created' })).toBeVisible();

    await page.getByRole('button', { name: 'Back to the preview' }).click();
    await page.getByRole('button', { name: 'Sign in', exact: true }).last().click(); // switch link
    await page.getByRole('button', { name: 'Forgot password?' }).click();
    await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
    await page.getByLabel('Email').fill('someone@example.com');
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByRole('heading', { name: 'No email was sent' })).toBeVisible();
  });

  test('design states can be previewed without pretending anything happened', async ({ page }) => {
    await openFromLock(page);
    const states = page.getByRole('group', { name: 'Preview state' });
    await states.getByRole('button', { name: 'Loading' }).click();
    await expect(page.getByRole('button', { name: 'Signing in…' })).toBeDisabled();
    await states.getByRole('button', { name: 'Error' }).click();
    await expect(page.getByRole('alert')).toHaveText(/don’t match an account/);
    await states.getByRole('button', { name: 'Normal' }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('leaving the preview returns to the real unlock, which still works', async ({ page }) => {
    await openFromLock(page);
    await page.getByRole('button', { name: 'Back to Clarity' }).click();
    await expect(page.getByRole('heading', { name: 'Unlock Clarity' })).toBeVisible();
    await page.getByLabel('Passphrase', { exact: true }).fill(PASS);
    await page.getByLabel('Passphrase', { exact: true }).press('Enter');
    await expect(page.getByTestId('month-end')).toBeVisible();
    // also reachable from Settings while unlocked
    await page.getByRole('link', { name: /Settings/ }).first().click();
    await page.getByRole('button', { name: 'Open preview' }).click();
    await expect(page.getByRole('heading', { name: 'Welcome to Clarity' })).toBeVisible();
  });

  test('phone: fits without horizontal scroll', async ({ page }) => {
    await openFromLock(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(100);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    expect(Math.round((await page.locator('.auth-panel').boundingBox())!.width)).toBe(358);
  });
});
