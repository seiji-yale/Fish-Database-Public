import { expect, test } from '@playwright/test';
import { actAs } from './auth';

/** T-035, owner acceptance 1 and 2 (read only): the Export menu, the CSV download and the print view. */

test('Export offers the CSV download and the print page; the CSV has the Section layout', async ({
  page,
}) => {
  await page.goto('/feeding?month=2026-10');
  await page.locator('.export-menu summary').click();
  await expect(page.getByRole('link', { name: 'Export as PDF' })).toHaveAttribute(
    'href',
    '/feeding/print?month=2026-10',
  );
  const downloading = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Export as CSV' }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('feeding-schedule_2026-10.csv');
  const path = await download.path();
  const { readFileSync } = await import('node:fs');
  const bytes = readFileSync(path);
  expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  const lines = bytes.toString('utf8').split('\r\n');
  expect(lines[0]).toContain('Section,Date,Weekday,Feeder,Note,Events');
  expect(lines.filter((line) => line.startsWith('day,'))).toHaveLength(31);
});

test('the print view shows the month with names in full, the totals and a footer, without the app shell', async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as unknown as { printed: number }).printed = 0;
    window.print = () => {
      (window as unknown as { printed: number }).printed += 1;
    };
  });
  await page.goto('/feeding/print?month=2026-10');
  await expect(
    page.getByRole('heading', { name: 'Feeding Schedule — October 2026', level: 1 }),
  ).toBeVisible();
  await expect(page.locator('.feeding-print__grid thead th')).toHaveText([
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
  ]);
  await expect(page.locator('.feeding-print__grid tbody tr')).toHaveCount(5);
  await expect(page.locator('.feeding-print__day')).toHaveCount(31);
  await expect(page.locator('.feeding-totals')).toBeVisible();
  await expect(page.locator('.print-footer')).toContainText(
    /Generated \d{4}-\d{2}-\d{2} \d{2}:\d{2} by Bob/,
  );
  await expect(page.locator('.top-nav, .app-header, .bottom-tabs')).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { printed: number }).printed))
    .toBe(1);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test.describe('the Guest view', () => {
  test.beforeEach(async ({ page }) => {
    await actAs(page, 'Guest');
  });
  test.afterEach(async ({ page }) => {
    await actAs(page, 'Bob');
  });

  test('has no Export menu and cannot open the print page or the CSV', async ({ page }) => {
    await page.goto('/feeding/print?month=2026-10');
    await expect(
      page.getByRole('heading', { name: 'Not available in the Guest view' }),
    ).toBeVisible();
    expect((await page.request.get('/api/feeding/summary.csv?month=2026-10')).status()).toBe(403);
  });
});
