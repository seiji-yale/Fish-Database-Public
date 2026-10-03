import { expect, test } from '@playwright/test';
import { actAs } from './auth';

/** T-020 Step 4: Settings → Data & Backup shows the Dropbox mirror and an honest answer to Export now. */
test('Data & Backup: no Dropbox connection locally, and Export now says so', async ({ page }) => {
  await actAs(page, 'Admin');
  await page.goto('/settings#data');
  await expect(page.getByRole('heading', { name: 'Dropbox mirror' })).toBeVisible();
  await expect(page.getByText(/no Dropbox connection/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download ZIP' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download snapshot.html' })).toBeVisible();

  await page.getByRole('button', { name: 'Export now' }).click();
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'The Dropbox copy is not connected on this server.' }),
  ).toBeVisible();
});
