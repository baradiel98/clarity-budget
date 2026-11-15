import { expect, test, type Page } from '@playwright/test';
import { NO_DATA_ROWS_MESSAGE } from '@clarity/import';

const PHONES = [320, 360, 390, 430];
const LONG = 'Northwestern Regional Medical Center Pharmacy and Wellness Store #2231';

async function sample(page: Page, width: number) {
  await page.clock.setFixedTime(new Date('2026-11-13T10:00:00'));
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore sample data' }).click();
  await expect(page.getByTestId('month-end')).toBeVisible();
}
const go = (page: Page, path: string) => page.evaluate((p) => { history.pushState({}, '', p); dispatchEvent(new PopStateEvent('popstate')); scrollTo(0, 0); }, path);
const noSideScroll = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);

/**
 * A control's real hit area: the size of the region around its centre where a tap lands on it (elementFromPoint),
 * so an enlarged area that is covered by another control does not count.
 */
async function hitArea(page: Page, sel: string, nth = 0) {
  return page.locator(sel).nth(nth).evaluate((el) => {
    el.scrollIntoView({ block: 'center' });
    const b = el.getBoundingClientRect();
    const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
    const own = (x: number, y: number) => { const h = document.elementFromPoint(x, y); return !!h && (h === el || el.contains(h)); };
    const reach = (dx: number, dy: number) => { let d = 0; while (d < 40 && own(cx + dx * (d + 1), cy + dy * (d + 1))) d++; return d; };
    return { w: reach(-1, 0) + reach(1, 0) + 1, h: reach(0, -1) + reach(0, 1) + 1 };
  });
}

async function addTx(page: Page, o: { kind?: 'Expense' | 'Income' | 'Transfer' | 'Refund'; amount: string; merchant?: string; to?: string }) {
  await page.keyboard.press('n');
  if (o.kind && o.kind !== 'Expense') await page.getByRole('group', { name: 'Type' }).getByRole('button', { name: o.kind }).click();
  await page.getByTestId('amount').fill(o.amount);
  if (o.merchant) await page.getByTestId('merchant').fill(o.merchant);
  if (o.to) await page.getByLabel('To account').selectOption({ label: o.to });
  await page.getByTestId('save-tx').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test.describe('1. Planning on phones', () => {
  for (const w of PHONES) {
    test(`${w}px: rows fit the card, amounts and balances whole, actions reachable`, async ({ page }) => {
      await sample(page, w);
      await go(page, '/planning');
      const tl = page.getByTestId('timeline');
      await expect(tl).toBeVisible();
      await noSideScroll(page);
      const r = await tl.evaluate((t) => {
        const card = t.closest('.card')!.getBoundingClientRect();
        const pad = parseFloat(getComputedStyle(t.closest('.card')!).paddingRight);
        const right = card.right - pad + 0.5;
        const bad = [...t.querySelectorAll('.tl-item, .tl-head, .tl-amt, .tl-act, .tl-head .money')].filter((e) => e.getBoundingClientRect().right > right).map((e) => e.className);
        const amts = [...t.querySelectorAll('.tl-amt')].map((e) => ({ text: e.textContent, clipped: e.scrollWidth > e.clientWidth + 1 }));
        const acts = [...t.querySelectorAll('button.tl-act')].map((e) => e.getBoundingClientRect()).map((b) => [Math.round(b.width), Math.round(b.height)]);
        return { bad, amts, acts };
      });
      expect(r.bad).toEqual([]);
      expect(r.amts.filter((a) => a.clipped)).toEqual([]);
      expect(r.amts.map((a) => a.text)).toContain('≈−$91.40');
      expect(r.amts.map((a) => a.text)).toContain('+$1,860.00');
      for (const [aw, ah] of r.acts) { expect(aw).toBeGreaterThanOrEqual(40); expect(ah).toBeGreaterThanOrEqual(40); }
      await expect(tl.locator('.tl-head').first()).toContainText('$2,779.83');
      // names are not broken mid-word: one-word names stay on one line
      for (const name of ['Paycheck', 'Electricity', 'Streaming']) {
        const h = await tl.locator('.tl-label').filter({ hasText: name }).first().locator('span').first().evaluate((e) => e.getBoundingClientRect().height);
        expect(h, name).toBeLessThanOrEqual(24);
      }
      // the actions menu still opens and offers its choices
      await tl.getByRole('button', { name: 'Actions for Electricity' }).first().click();
      await expect(page.getByRole('menuitem', { name: 'Mark paid' })).toBeVisible();
    });
  }
});

test.describe('2. Transactions on phones', () => {
  for (const w of PHONES) {
    test(`${w}px: stacked rows, names whole, selection and bulk actions work`, async ({ page }) => {
      await sample(page, 1280);
      await addTx(page, { amount: '1234567.89', merchant: LONG });
      await addTx(page, { kind: 'Refund', amount: '24.50', merchant: 'Bookshop' });
      await addTx(page, { kind: 'Transfer', amount: '300', to: 'Savings' });
      await addTx(page, { kind: 'Income', amount: '125', merchant: 'Freelance invoice' });
      await go(page, '/transactions');
      await page.setViewportSize({ width: w, height: 900 });
      const list = page.getByTestId('tx-list');
      await expect(list).toBeVisible();
      await expect(page.locator('table.data')).toHaveCount(0);
      await noSideScroll(page);
      // every name is shown in full (wraps, never cut) and the amount stays on line 1
      const rows = await list.locator('.tx-item').evaluateAll((items) => items.map((li) => {
        const n = li.querySelector('.tx-n')!, a = li.querySelector('.tx-amt')!, l2 = li.querySelector('.tx-l2')!;
        const nb = n.getBoundingClientRect(), ab = a.getBoundingClientRect(), lb = li.getBoundingClientRect();
        return { name: n.textContent, amount: a.textContent, l2: l2.textContent, clipped: n.scrollWidth > n.clientWidth + 1 || a.scrollWidth > a.clientWidth + 1, overlap: nb.right > ab.left + 0.5 && nb.top < ab.bottom, outside: ab.right > lb.right + 0.5 };
      }));
      expect(rows.filter((r) => r.clipped || r.overlap || r.outside)).toEqual([]);
      const by = (name: string) => rows.find((r) => r.name === name)!;
      expect(by(LONG).amount).toBe('−$1,234,567.89');
      expect(by('Whole Foods')).toMatchObject({ amount: '−$64.12', l2: 'Nov 12 · Groceries' });
      expect(by('Bookshop').l2).toContain('Refund');
      expect(by('Freelance invoice').amount).toBe('+$125.00');
      expect(rows.some((r) => r.name === 'To Savings' && r.amount === '−$300.00' && r.l2.includes('Transfer'))).toBe(true);
      expect(by('Paycheck').amount).toBe('+$1,860.00');
      // account information: in the accessible description, and in the details sheet the row opens
      const wf = list.getByRole('button', { name: /Whole Foods/ }).first();
      await expect(wf).toHaveAccessibleDescription(/Account: Visa Card/);
      await wf.click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expect(page.getByRole('dialog').getByLabel('Account')).toHaveValue(/.+/);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);
      // selection: comfortable hit areas, bulk bar appears and fits
      const hit = await hitArea(page, '.tx-check', 1);
      expect(hit.w).toBeGreaterThanOrEqual(40);
      expect(hit.h).toBeGreaterThanOrEqual(40);
      await list.getByRole('checkbox', { name: 'Select Whole Foods' }).first().check();
      await list.getByRole('checkbox', { name: 'Select Shell' }).first().check();
      const bulk = page.getByRole('region', { name: 'Bulk actions' });
      await expect(bulk).toContainText('2 selected');
      await noSideScroll(page);
      await page.getByText('Select all shown').click();
      await expect(bulk).toContainText(/\d+ selected/);
      await bulk.getByRole('button', { name: 'Clear' }).click();
      await expect(bulk).toHaveCount(0);
      // keyboard: Space toggles the checkbox, Enter opens the row
      await list.getByRole('checkbox', { name: 'Select Shell' }).first().focus();
      await page.keyboard.press('Space');
      await expect(page.getByRole('region', { name: 'Bulk actions' })).toContainText('1 selected');
      await page.keyboard.press('Tab');
      await page.keyboard.press('Enter');
      await expect(page.getByRole('dialog')).toBeVisible();
    });
  }

  test('desktop keeps the table; checkboxes have a larger click area', async ({ page }) => {
    await sample(page, 1280);
    await go(page, '/transactions');
    await expect(page.locator('table.data')).toBeVisible();
    await expect(page.getByTestId('tx-list')).toHaveCount(0);
    await expect(page.locator('table.data thead th')).toHaveText(['', 'Date', 'Merchant', 'Category', 'Account', 'Amount']);
    const hit = await hitArea(page, 'table.data tbody .check-hit', 0);
    expect(hit.w).toBeGreaterThanOrEqual(32);
    expect(hit.h).toBeGreaterThanOrEqual(32);
    await page.locator('table.data tbody .check-hit').first().click({ position: { x: 4, y: 18 } }); // left edge of the area, not the box
    await expect(page.getByRole('region', { name: 'Bulk actions' })).toContainText('1 selected');
  });
});

test.describe('3. Touch targets on phones', () => {
  for (const w of PHONES) {
    test(`${w}px: Why icons and links, Budget category links are at least 40px and do not overlap others`, async ({ page }) => {
      await sample(page, w);
      // Phase 4B.2: Home shows 3 figure icons on the sample day (repeated figures are hidden)
      const icons = await page.locator('button.why').count();
      expect(icons).toBeGreaterThanOrEqual(3);
      for (let i = 0; i < icons; i++) {
        const h = await hitArea(page, 'button.why', i);
        expect(h.w, `why ${i}`).toBeGreaterThanOrEqual(40);
        expect(h.h, `why ${i}`).toBeGreaterThanOrEqual(40);
      }
      const links = await page.getByRole('button', { name: 'Why this number?', exact: true }).count();
      expect(links).toBeGreaterThanOrEqual(1);
      for (let i = 0; i < links; i++) {
        const h = await page.getByRole('button', { name: 'Why this number?', exact: true }).nth(i).evaluate((el) => { el.classList.add('qa-probe'); return 0; }).then(() => hitArea(page, '.qa-probe'));
        await page.locator('.qa-probe').evaluate((el) => el.classList.remove('qa-probe'));
        expect(h.h, `why link ${i}`).toBeGreaterThanOrEqual(40);
      }
      // focus stays visible on the enlarged controls
      // keyboard: the enlarged control is still reachable with Tab and shows its focus ring
      await page.locator('#h-bal').evaluate((e) => e.setAttribute('tabindex', '-1'));
      await page.locator('#h-bal').focus();
      await page.keyboard.press('Tab');
      const f = await page.evaluate(() => ({ why: document.activeElement?.classList.contains('why'), outline: getComputedStyle(document.activeElement!).outlineStyle }));
      expect(f).toEqual({ why: true, outline: 'solid' });
      await go(page, '/budget');
      for (let i = 0; i < 3; i++) {
        const h = await hitArea(page, '.budget-row .name button', i);
        expect(h.h, `budget ${i}`).toBeGreaterThanOrEqual(40);
      }
      await noSideScroll(page);
    });
  }
});

test('4. estimated bills: Planning shows the forecast amount with ≈ and explains the usual amount', async ({ page }) => {
  await sample(page, 1280);
  await go(page, '/planning');
  const bills = page.getByRole('region', { name: 'Bills & subscriptions' });
  const row = bills.locator('.item-row').filter({ hasText: 'Electricity' });
  await expect(row.locator('.amt')).toHaveText('≈$91.40');
  await expect(row.getByTestId('estimate-note')).toHaveText('Estimate: average of recent payments (your usual: $88.00)');
  await expect(page.getByTestId('timeline').locator('.tl-item').filter({ hasText: 'Electricity' }).first().locator('.tl-amt')).toHaveText('≈−$91.40');
  await expect(page.locator('.item-row .amt').filter({ hasText: '~' })).toHaveCount(0);
});

test.describe('5. Settings sections on phones', () => {
  for (const w of PHONES) {
    test(`${w}px: every section is visible without scrolling sideways`, async ({ page }) => {
      await sample(page, w);
      await go(page, '/settings');
      const nav = page.getByRole('navigation', { name: 'Settings sections' });
      const r = await nav.evaluate((n) => ({ sw: n.scrollWidth, cw: n.clientWidth, items: [...n.querySelectorAll('a')].map((a) => { const b = a.getBoundingClientRect(); return { t: a.textContent, l: b.left, r: b.right, h: b.height, clipped: a.scrollWidth > a.clientWidth + 1 }; }) }));
      expect(r.sw).toBeLessThanOrEqual(r.cw);
      expect(r.items.map((i) => i.t)).toEqual(['Accounts', 'Categories', 'Preferences', 'Security', 'Backup & export', 'Import history', 'Privacy & data']);
      for (const i of r.items) { expect(i.l, i.t!).toBeGreaterThanOrEqual(0); expect(i.r, i.t!).toBeLessThanOrEqual(w); expect(i.h).toBeGreaterThanOrEqual(40); expect(i.clipped, i.t!).toBe(false); }
      await noSideScroll(page);
      await nav.getByRole('link', { name: 'Privacy & data' }).click();
      await expect(page.locator('#data')).toBeInViewport();
    });
  }
});

test('6A. Capture: Prepare is disabled for empty or blank text', async ({ page }) => {
  await sample(page, 390);
  await go(page, '/capture');
  const prep = page.getByTestId('capture-read');
  await expect(prep).toBeDisabled();
  await page.getByTestId('capture-text').fill('   \n  ');
  await expect(prep).toBeDisabled();
  await page.getByTestId('capture-text').fill('asdf');
  await expect(prep).toBeEnabled();
  await prep.click();
  await expect(page.getByText(/No amount found in “asdf”/)).toBeVisible(); // existing validation message unchanged
});

test('6B. Import: a CSV with column names but no rows is rejected with a clear message', async ({ page }) => {
  await sample(page, 1280);
  await go(page, '/import');
  await page.getByTestId('import-file').setInputFiles({ name: 'empty-range.csv', mimeType: 'text/csv', buffer: Buffer.from('Date,Description,Amount\n\n') });
  await expect(page.getByRole('alert')).toHaveText(NO_DATA_ROWS_MESSAGE);
  await expect(page.getByText('Check how the file is read')).toHaveCount(0);
  // a normal file still goes through
  await page.getByTestId('import-file').setInputFiles({ name: 'ok.csv', mimeType: 'text/csv', buffer: Buffer.from('Date,Description,Amount\n2026-11-02,Coffee,-4.50\n') });
  await expect(page.getByText('Check how the file is read')).toBeVisible();
  await expect(page.getByText('1 row to read')).toBeVisible();
});

test('6C. sample Budget shows real budgets', async ({ page }) => {
  await sample(page, 1280);
  await go(page, '/budget');
  await expect(page.locator('main')).toContainText('$960.00');
  await expect(page.getByTestId('budget-cat_groceries')).not.toContainText('Not budgeted');
});
