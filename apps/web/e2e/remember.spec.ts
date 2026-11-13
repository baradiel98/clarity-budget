import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { addExpense, fresh, onboard, PASS, toDashboard } from './helpers';

const here = dirname(fileURLToPath(import.meta.url));
const pass = (page: Page) => page.getByLabel('Passphrase', { exact: true });
const lockScreen = (page: Page) => page.getByRole('heading', { name: 'Unlock Clarity' });

async function setUp(page: Page) {
  await fresh(page);
  const key = await onboard(page);
  await toDashboard(page);
  return key;
}
async function lock(page: Page) {
  await page.getByRole('button', { name: 'Lock' }).click();
  await expect(lockScreen(page)).toBeVisible();
}
async function unlock(page: Page, opts: { remember?: 7 | 30 | false; secret?: string } = {}) {
  const box = page.getByRole('checkbox', { name: 'Remember this device' });
  if (opts.remember) {
    await box.check();
    await page.getByRole('radio', { name: `${opts.remember} days` }).check();
  } else if (opts.remember === false) {
    await box.uncheck();
  }
  await pass(page).fill(opts.secret ?? PASS);
  await pass(page).press('Enter');
  // wait until unlocking (and remembering) has finished, unless a wrong secret is expected
  if (!opts.secret) await expect(page.getByTestId('month-end')).toBeVisible();
}
const trustRecord = (page: Page) =>
  page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((res, rej) => { const r = indexedDB.open('clarity-device', 1); r.onupgradeneeded = () => r.result.createObjectStore('trust', { keyPath: 'id' }); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const rec = await new Promise<Record<string, unknown> | undefined>((res) => { const r = db.transaction('trust').objectStore('trust').get('device'); r.onsuccess = () => res(r.result); });
    db.close();
    if (!rec) return null;
    const key = rec.key as CryptoKey;
    let exportable = true;
    try { await crypto.subtle.exportKey('raw', key); } catch { exportable = false; }
    return { extractable: key.extractable, exportable, usages: key.usages, days: rec.days, suspended: rec.suspended, expiresAt: rec.expiresAt, fields: Object.keys(rec).sort() };
  });
const at = (iso: string) => new Date(`${iso}T10:00:00`);

test.describe('remember this device', () => {
  test('1–2, 8: first visit asks for the passphrase; wrong passphrases fail; without "remember" a refresh locks again', async ({ page }) => {
    await setUp(page);
    await page.reload();
    await expect(lockScreen(page)).toBeVisible();
    await expect(page.getByTestId('lock-reason')).toHaveCount(0);
    await unlock(page, { remember: 7, secret: 'not my passphrase' });
    await expect(page.getByRole('alert')).toHaveText('That passphrase is not correct.');
    expect(await trustRecord(page)).toBeNull(); // a failed attempt never remembers anything
    await unlock(page, { remember: false });
    await expect(page.getByTestId('month-end')).toBeVisible();
    await page.reload();
    await expect(lockScreen(page)).toBeVisible();
  });

  test('3–4, 10: remembered for 7 days survives refreshes and reopening; existing records stay readable', async ({ page, context }) => {
    await setUp(page);
    await addExpense(page, '43.21', 'Trader Joes');
    await lock(page);
    await unlock(page, { remember: 7 });
    await expect(page.getByTestId('available-cash')).toHaveText('$1,156.79');
    await page.reload();
    await expect(page.getByTestId('available-cash')).toHaveText('$1,156.79');
    // "close the browser and come back": a new tab after closing the old one
    await page.close();
    const again = await context.newPage();
    await again.clock.setFixedTime(at('2026-09-09'));
    await again.goto('/');
    await expect(again.getByTestId('available-cash')).toHaveText('$1,156.79');
    await again.getByRole('link', { name: /Settings/ }).first().click();
    await expect(again.getByTestId('device-row')).toContainText('Remembered until');
  });

  test('5: after the trust period, the passphrase is required again (and then works)', async ({ page }) => {
    await setUp(page);
    await lock(page);
    await unlock(page, { remember: 7 });
    await expect(page.getByTestId('month-end')).toBeVisible();
    await page.clock.setFixedTime(at('2026-09-10')); // 7 days later, exactly at expiry
    await page.reload();
    await expect(page.getByTestId('lock-reason')).toHaveText(/remembered access on this device has ended/);
    await expect(page.getByRole('checkbox', { name: 'Remember this device' })).not.toBeChecked();
    expect(await trustRecord(page)).toBeNull();
    await unlock(page);
    await expect(page.getByTestId('month-end')).toBeVisible();
  });

  test('30 days: coming back on day 29 opens directly; on day 30 the passphrase is needed', async ({ page, context }) => {
    await setUp(page);
    await lock(page);
    await unlock(page, { remember: 30 });
    // Time passes with the tab closed (an open tab would hit the inactivity lock first, which is intended).
    await page.close();
    const day29 = await context.newPage();
    await day29.clock.setFixedTime(at('2026-10-02'));
    await day29.goto('/');
    await expect(day29.getByTestId('month-end')).toBeVisible();
    await day29.close();
    const day30 = await context.newPage();
    await day30.clock.setFixedTime(at('2026-10-03'));
    await day30.goto('/');
    await expect(day30.getByTestId('lock-reason')).toContainText('ended');
  });

  test('6: Lock locks at once, stays locked after a refresh, and one passphrase entry resumes remembered access', async ({ page }) => {
    await setUp(page);
    await lock(page);
    await unlock(page, { remember: 7 });
    await lock(page);
    await expect(page.getByTestId('lock-reason')).toHaveText('Clarity is locked.');
    await page.reload();
    await expect(page.getByTestId('lock-reason')).toContainText('was locked on this device');
    await expect(page.getByRole('checkbox', { name: 'Remember this device' })).toBeChecked();
    await unlock(page);
    await page.reload();
    await expect(page.getByTestId('month-end')).toBeVisible();
  });

  test('automatic lock after inactivity also pauses remembered access', async ({ page }) => {
    await setUp(page);
    await lock(page);
    await unlock(page, { remember: 7 });
    await expect(page.getByTestId('month-end')).toBeVisible();
    await page.clock.setFixedTime(new Date('2026-09-03T10:20:00')); // default auto-lock: 15 minutes
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(page.getByTestId('lock-reason')).toHaveText('Locked after a period of inactivity.');
    await page.reload();
    await expect(lockScreen(page)).toBeVisible();
  });

  test('7: forgetting this device requires the passphrase again', async ({ page }) => {
    await setUp(page);
    await lock(page);
    await unlock(page, { remember: 30 });
    await page.getByRole('link', { name: /Settings/ }).first().click();
    await page.getByRole('button', { name: 'Forget this device' }).click();
    await expect(page.getByTestId('device-row')).toContainText('Not remembered');
    expect(await trustRecord(page)).toBeNull();
    await page.reload();
    await expect(lockScreen(page)).toBeVisible();
  });

  test('9: the recovery key still unlocks, and can also remember the device', async ({ page }) => {
    const key = await setUp(page);
    await lock(page);
    await page.getByRole('button', { name: 'Use recovery key instead' }).click();
    await page.getByRole('checkbox', { name: 'Remember this device' }).check();
    await page.getByLabel('Recovery key', { exact: true }).fill(key);
    await page.getByLabel('Recovery key', { exact: true }).press('Enter');
    await expect(page.getByTestId('month-end')).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('month-end')).toBeVisible();
  });

  test('key material: device key is non-extractable; no passphrase anywhere in browser storage', async ({ page }) => {
    await setUp(page);
    await lock(page);
    await unlock(page, { remember: 7 });
    await expect(page.getByTestId('month-end')).toBeVisible();
    const rec = (await trustRecord(page))!;
    expect(rec.extractable).toBe(false);
    expect(rec.exportable).toBe(false);
    expect(rec.usages.sort()).toEqual(['decrypt', 'encrypt']);
    expect(rec.fields).toEqual(['createdAt', 'ct', 'days', 'expiresAt', 'id', 'iv', 'key', 'suspended', 'v', 'vaultId']);
    const everything = await page.evaluate(async () => {
      const out = [JSON.stringify({ ...localStorage }), JSON.stringify({ ...sessionStorage }), document.cookie];
      for (const info of await indexedDB.databases()) {
        const db = await new Promise<IDBDatabase>((res) => { const r = indexedDB.open(info.name!); r.onsuccess = () => res(r.result); });
        for (const s of [...db.objectStoreNames]) out.push(JSON.stringify(await new Promise((res) => { const r = db.transaction(s).objectStore(s).getAll(); r.onsuccess = () => res(r.result); })));
        db.close();
      }
      return out.join('\n');
    });
    expect(everything).not.toContain(PASS);
  });

  test('deleting all data also forgets the device', async ({ page }) => {
    await setUp(page);
    await lock(page);
    await unlock(page, { remember: 7 });
    await page.getByRole('link', { name: /Settings/ }).first().click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByLabel('Type DELETE to confirm').fill('DELETE');
    await page.getByRole('button', { name: 'Delete permanently' }).click();
    await expect(page.getByRole('button', { name: 'Get started' })).toBeVisible();
    expect(await trustRecord(page)).toBeNull();
  });

  test('12: the production build contains no test mode; no URL turns it on', async ({ page }) => {
    const assets = join(here, '../dist/assets');
    const js = readdirSync(assets).filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(assets, f), 'utf8')).join('\n');
    expect(js).not.toContain('clarity sample data');
    expect(js).not.toContain('clarity-test');
    expect(js).not.toContain('Test mode');
    // sanity: the same strings are present in the test-mode build, so the check above is meaningful
    const testAssets = join(here, '../dist-test/assets');
    const testJs = readdirSync(testAssets).filter((f) => f.endsWith('.js')).map((f) => readFileSync(join(testAssets, f), 'utf8')).join('\n');
    expect(testJs).toContain('clarity sample data');

    await setUp(page);
    for (const url of ['/?test=1', '/?testMode=true', '/?dev=1#test']) {
      await page.goto(url);
      await expect(lockScreen(page)).toBeVisible();
      await expect(page.getByTestId('test-mode-banner')).toHaveCount(0);
    }
  });
});
