import { expect, test, type Page } from '@playwright/test';
import { fresh, PASS, toDashboard } from './helpers';
// Same fixture as the mobile jest test and the engine test: the two apps must show the same things.
import { HOME_SAMPLE as X } from '../../../packages/data/test/fixtures/home-sample-nov13';

const LONG_BILL = 'Comcast Xfinity Internet, TV and Home Phone Bundle Monthly Payment';
const LONG_PAY = 'Paycheck from Northwestern Regional Medical Center Payroll Services';

/** Onboard with chosen numbers (and optionally long names). Today is Sep 3, 2026. */
async function onboardWith(page: Page, o: { balance: string; pay: string; payName?: string; bill: string; billName: string; billDate: string }) {
  await fresh(page);
  await page.getByRole('button', { name: 'Get started' }).click();
  await page.getByLabel('Passphrase', { exact: true }).fill(PASS);
  await page.getByLabel('Confirm passphrase').fill(PASS);
  await page.getByRole('checkbox', { name: /Create a recovery key/ }).uncheck();
  await page.getByRole('checkbox', { name: /cannot be recovered/ }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Current checking balance').fill(o.balance);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Next payday').fill('2026-09-12');
  await page.getByLabel('Usual paycheck amount (optional)').fill(o.pay);
  if (o.payName) {
    // a second, long-named paycheck (the first keeps its default name)
    await page.getByRole('button', { name: 'Add another paycheck' }).click();
    const g = page.getByRole('group', { name: 'Paycheck 2' });
    await g.getByLabel('Name').fill(o.payName);
    const g2 = page.getByRole('group', { name: o.payName });
    await g2.getByLabel('Next payday').fill('2026-09-18');
    await g2.getByLabel('Usual paycheck amount (optional)').fill('950');
  }
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Name').fill(o.billName);
  await page.getByLabel('Amount').fill(o.bill);
  await page.getByLabel('Due date').fill(o.billDate);
  await page.getByRole('button', { name: 'See my overview' }).click();
  await toDashboard(page);
}

test.describe('Upcoming rows on narrow screens', () => {
  for (const w of [320, 360, 390, 430]) {
    test(`${w}px: long names are shown in full; amount and action stay visible`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: 900 });
      await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
      await onboardWith(page, { balance: '1200', pay: '1800', payName: LONG_PAY, bill: '1234567.89', billName: LONG_BILL, billDate: '2026-09-25' });
      const rows = page.getByTestId('upcoming').locator('.up-row');
      await expect(rows.first()).toBeVisible();
      for (const name of [LONG_BILL, LONG_PAY]) {
        const row = rows.filter({ hasText: name }).first();
        await row.scrollIntoViewIfNeeded();
        const title = row.locator('.title');
        await expect(title).toHaveText(name);
        // not clipped: the whole text fits its box (no ellipsis / overflow)
        const clip = await title.evaluate((e) => ({ sw: e.scrollWidth, cw: e.clientWidth, sh: e.scrollHeight, ch: e.clientHeight, ws: getComputedStyle(e).whiteSpace }));
        expect(clip.sw, name).toBeLessThanOrEqual(clip.cw);
        expect(clip.sh, name).toBeLessThanOrEqual(clip.ch);
        const box = (sel: string) => row.locator(sel).first().boundingBox();
        const [t, a, b] = [await box('.title'), await box('.up-amount'), await box('.up-action')];
        for (const r of [t!, a!, b!]) { expect(r.x).toBeGreaterThanOrEqual(0); expect(r.x + r.width).toBeLessThanOrEqual(w); }
        // the name never runs under the amount or the button
        expect(t!.x + t!.width).toBeLessThanOrEqual(a!.x + 0.5);
        expect(t!.x + t!.width).toBeLessThanOrEqual(b!.x + 0.5);
        expect(b!.height).toBeGreaterThanOrEqual(36); // comfortable touch target on phones
        // font size not shrunk to force things onto one line
        expect(await row.locator('.title').evaluate((e) => parseFloat(getComputedStyle(e).fontSize))).toBeGreaterThanOrEqual(14);
      }
      await expect(rows.filter({ hasText: LONG_BILL }).locator('.up-amount')).toHaveText('−$1,234,567.89');
      const wide = await page.evaluate(() => [...document.querySelectorAll("body *")].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).slice(0, 8).map((e) => e.tagName + "." + e.className + " " + Math.round(e.getBoundingClientRect().right) + " " + (e.textContent ?? "").slice(0, 50)));
      expect(wide, wide.join("\n")).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    });
  }

  test('empty Upcoming list says so with the real window', async ({ page }) => {
    await fresh(page);
    await page.getByRole('button', { name: 'Get started' }).click();
    await page.getByLabel('Passphrase', { exact: true }).fill(PASS);
    await page.getByLabel('Confirm passphrase').fill(PASS);
    await page.getByRole('checkbox', { name: /Create a recovery key/ }).uncheck();
    await page.getByRole('checkbox', { name: /cannot be recovered/ }).check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('Current checking balance').fill('500');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Skip' }).click();
    await page.getByRole('button', { name: 'Skip' }).click();
    await toDashboard(page);
    await expect(page.getByText('No bills, paychecks or planned expenses through Oct 31.')).toBeVisible(); // the Safe to Spend horizon (Phase 4A)
  });
});

/** Y-axis labels must stay left of everything plotted, and never overlap each other. */
async function checkChartLabels(page: Page, label: string) {
  const r = await page.locator('.chart-area svg').evaluate((svg) => {
    const rect = (e: Element) => e.getBoundingClientRect();
    const ys = [...svg.querySelectorAll('text.fc-y')].map(rect);
    const plotted = [...svg.querySelectorAll('path.fc-line, circle, .fc-reveal text:not(.fc-x)')].map(rect).filter((b) => b.width > 0 || b.height > 0);
    // the "Lowest …" label: no sample point of its box lies on a recorded/projected line's stroke
    const low = svg.querySelector('text.fc-low') as SVGTextElement | null;
    let lowHits = 0;
    if (low) {
      const b = low.getBBox();
      const lines = [...svg.querySelectorAll('path.fc-line')] as SVGPathElement[];
      for (let i = 0; i <= 12; i++) for (let j = 0; j <= 4; j++) {
        const pt = new DOMPoint(b.x + (b.width * i) / 12, b.y + (b.height * j) / 4);
        if (lines.some((l) => l.isPointInStroke(pt))) lowHits++;
      }
    }
    return {
      lowHits, hasLow: !!low,
      labelsRight: Math.max(...ys.map((b) => b.right)),
      plotLeft: Math.min(...plotted.map((b) => b.left)),
      ys: ys.map((b) => [b.top, b.bottom]).sort((a, b) => a[0]! - b[0]!),
      count: ys.length,
    };
  });
  expect(r.count, label).toBeGreaterThanOrEqual(2);
  // the lowest point is always labelled: next to its dot, or (narrow charts with no clear spot) in a caption above
  expect(r.hasLow || (await page.locator('.fc-low-caption').count()) === 1, label).toBe(true);
  expect(r.lowHits, `${label}: "Lowest" label crosses a line`).toBe(0);
  expect(r.labelsRight, label).toBeLessThanOrEqual(r.plotLeft);
  for (let i = 1; i < r.ys.length; i++) expect(r.ys[i]![0]!, label).toBeGreaterThanOrEqual(r.ys[i - 1]![1]!);
}

test.describe('chart axis labels never cover the data', () => {
  test('sample data: every range, desktop widths and a phone', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-11-13T10:00:00'));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Explore sample data' }).click();
    await expect(page.getByTestId('month-end')).toBeVisible();
    for (const w of [1280, 1440, 1920, 2048, 834, 430, 390, 360, 320]) {
      await page.setViewportSize({ width: w, height: 1000 });
      for (const range of ['Month-end', '30 days', '90 days']) {
        await page.getByRole('group', { name: 'Chart range' }).getByRole('button', { name: range }).click();
        await page.waitForTimeout(120);
        await checkChartLabels(page, `${w} ${range}`);
      }
    }
  });

  for (const [name, o] of [
    ['tiny balance', { balance: '12.34', pay: '50', bill: '20', billName: 'Phone', billDate: '2026-09-10' }],
    ['large balance', { balance: '1234567.89', pay: '25000', bill: '9000', billName: 'Mortgage', billDate: '2026-09-15' }],
    ['goes negative', { balance: '100', pay: '1800', bill: '1400', billName: 'Rent', billDate: '2026-09-05' }],
  ] as const) {
    test(`${name}: labels stay clear at 1280 and on a phone`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.setViewportSize({ width: 1280, height: 1000 });
      await onboardWith(page, o);
      for (const w of [1280, 390, 320]) {
        await page.setViewportSize({ width: w, height: 1000 });
        for (const range of ['Month-end', '90 days']) {
          await page.getByRole('group', { name: 'Chart range' }).getByRole('button', { name: range }).click();
          await page.waitForTimeout(120);
          await checkChartLabels(page, `${name} ${w} ${range}`);
        }
      }
    });
  }
});


test.describe('web Home shows the cross-platform sample figures (Nov 13, 2026)', () => {
  for (const w of [390, 1280]) {
    test(`${w}px`, async ({ page }) => {
      await page.clock.setFixedTime(new Date('2026-11-13T10:00:00'));
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.setViewportSize({ width: w, height: 1000 });
      await page.goto('/');
      await page.getByRole('button', { name: 'Explore sample data' }).click();
      await expect(page.getByTestId('month-end')).toHaveText(X.monthEnd);
      await expect(page.locator('.outlook .delta')).toContainText(X.monthEndDelta);
      await expect(page.getByTestId('safe-to-spend')).toHaveText(X.safeToSpend);
      await expect(page.locator('.card.sts')).toContainText(X.safeToSpendLine);
      await expect(page.getByTestId('sts-after')).toHaveText(X.safeToSpendAfterLow);
      const stats = page.getByRole('region', { name: 'Key balances' });
      await expect(page.getByTestId('available-cash')).toHaveText(X.recordedBalance);
      await expect(stats).toContainText(`${X.lowest}${X.lowestSub}`);
      await expect(stats).toContainText(`${X.lowestBeforeIncome}${X.lowestBeforeIncomeSub}`);
      await expect(stats).toContainText(`${X.endOfDay}${X.endOfDaySub}`);
      await expect(page.locator('#h-up')).toHaveText(`Upcoming · through ${X.upcomingUntil}`);
      const rows = page.getByTestId('upcoming').locator('.up-row');
      await expect(rows).toHaveCount(X.upcoming.length);
      for (const [i, [date, name, status, amount]] of X.upcoming.entries()) {
        await expect(rows.nth(i).locator('.title')).toHaveText(name);
        await expect(rows.nth(i).locator('.meta')).toContainText(`${date} ${status}`);
        await expect(rows.nth(i).locator('.up-amount')).toHaveText(amount);
      }
      const later = page.getByTestId('upcoming-later');
      await expect(later.locator('li')).toHaveCount(X.upcomingLater.length);
      for (const [i, [date, name, amount]] of X.upcomingLater.entries()) await expect(later.locator('li').nth(i)).toHaveText(`${date}${name}${amount}`);
      await expect(later).toContainText(X.upcomingLaterMore);
      const recent = page.getByTestId('recent').locator('.list-row');
      await expect(recent).toHaveCount(X.recent.length);
      for (const [i, [date, title, cat, amount]] of X.recent.entries()) await expect(recent.nth(i)).toHaveText(`${title}${date} · ${cat}${amount}`);
    });
  }
});
