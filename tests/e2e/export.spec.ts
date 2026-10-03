import { expect, test } from '@playwright/test';

test('Line Detail export menu opens print view and downloads its line CSV', async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    window.print = () => {
      (window as Window & { printCalled?: boolean }).printCalled = true;
    };
  });
  await page.goto('/lines/fx-demo_c3');
  const menu = page.locator('.export-menu');
  await expect(menu.locator('summary')).toBeVisible();
  if (testInfo.project.name === 'phone-375') await expect(menu).toHaveCSS('position', 'fixed');
  await menu.locator('summary').click();
  const pdfLink = menu.getByRole('link', { name: 'Export as PDF' });
  await expect(pdfLink).toHaveAttribute('href', '/lines/fx-demo_c3/print');
  await pdfLink.click();
  await expect(page).toHaveURL(/\/lines\/fx-demo_c3\/print$/);
  await expect(page.getByRole('heading', { name: 'demo_c3', level: 1 })).toBeVisible();
  expect(
    await page.evaluate(() => (window as Window & { printCalled?: boolean }).printCalled),
  ).toBe(true);
  await page.goBack();
  await menu.locator('summary').click();
  const downloadWait = page.waitForEvent('download');
  await menu.getByRole('link', { name: 'Export CSV' }).click();
  const download = await downloadWait;
  expect(download.suggestedFilename()).toMatch(/^fish-line_demo_c3_\d{4}-\d{2}-\d{2}\.csv$/);
});
