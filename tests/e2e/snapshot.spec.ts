import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { actAs } from './auth';

/** T-020 Step 3: the generated viewer opens from a plain file with the network off. */
test('snapshot.html works from file:// offline and shows demo_c3', async ({ page, context }) => {
  await actAs(page, 'Admin');
  const response = await page.request.get('/api/admin/snapshot.html');
  expect(response.ok()).toBe(true);
  const body = await response.body();
  expect(body.length).toBeLessThan(2_000_000);
  const file = join(mkdtempSync(join(tmpdir(), 'snapshot-')), 'snapshot.html');
  writeFileSync(file, body);

  const outside: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith('file:') && !request.url().startsWith('data:'))
      outside.push(request.url());
  });
  await context.setOffline(true);
  await page.goto(`file://${file}`);

  await expect(page.getByText('Read-only copy. Use the app to edit.')).toBeVisible();
  await expect(page.getByText(/^Generated \d{4}-\d{2}-\d{2} \d{2}:\d{2}/)).toBeVisible();
  const search = page.getByLabel('Search lines');
  await search.fill('demo_c3');
  await expect(page.getByRole('status')).toContainText('1 of');
  await page.getByRole('link', { name: /demo_c3/ }).click();
  await expect(page.getByRole('heading', { name: /demo_c3/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'ID methods' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Cryopreservation' })).toBeVisible();
  await page.getByRole('link', { name: '← All lines' }).click();
  await expect(page.getByLabel('Search lines')).toBeVisible();

  // Legible on a phone: no sideways scrolling of the page itself.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  expect(outside).toEqual([]);
});
