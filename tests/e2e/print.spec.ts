import { expect, test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

test('print view includes line records and produces a two-page or shorter PDF for demo_c3 and DEMO_E5', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop-1280',
    'PDF layout is checked at the desktop print width',
  );
  await page.addInitScript(() => {
    window.print = () => {
      (window as Window & { printCalled?: boolean }).printCalled = true;
    };
  });
  const lines = [
    ['fx-demo_c3', 'demo_c3', 'CGAATACTGCATCTCGCGCGCACACT'],
    ['fx-demo_e5', 'DEMO_E5', 'G125 to T'],
  ] as const;
  for (const [id, name, expected] of lines) {
    await page.goto(`/lines/${id}/print`);
    await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
    await expect(page.getByText(expected, { exact: true })).toBeVisible();
    await expect(page.locator('.print-footer')).toContainText('Generated');
    expect(
      await page.evaluate(() => (window as Window & { printCalled?: boolean }).printCalled),
    ).toBe(true);
    await page.emulateMedia({ media: 'print' });
    const pdf = await page.pdf({ format: 'A4', printBackground: true });
    expect(pdf.byteLength).toBeGreaterThan(1_000);
    const pageCount = [...pdf.toString('latin1').matchAll(/\/Type\s*\/Page\b/g)].length;
    expect(pageCount).toBeLessThanOrEqual(2);
    await writeFile(testInfo.outputPath(`${name}.pdf`), pdf);
    await page.emulateMedia({ media: 'screen' });
  }
});
