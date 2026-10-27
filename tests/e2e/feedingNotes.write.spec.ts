import { expect, test } from '@playwright/test';
import { actAs } from './auth';

/** T-035, owner acceptance 3: the Admin saves Notes & links; the calendar page shows them with working links. */
test('an Admin saves the notes; Members see them with links, the Admin gets an Edit link', async ({
  page,
}, testInfo) => {
  // One setting for the whole lab: only one viewport project changes it.
  test.skip(testInfo.project.name !== 'desktop-1280-writes', 'the notes are one lab-wide setting');
  await actAs(page, 'Admin');
  await page.goto('/settings#preferences');
  await page
    .getByLabel('Feeding Schedule notes & links')
    .fill('Emergency: Dr. X, 555-0100\nProtocol: https://example.test/feeding-protocol.');
  await page.getByRole('button', { name: 'Save preferences' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Preferences saved' })).toBeVisible();

  await page.goto('/feeding');
  const notes = page.locator('.feeding-notes');
  await expect(notes).toContainText('Emergency: Dr. X, 555-0100');
  const link = notes.getByRole('link', { name: 'https://example.test/feeding-protocol' });
  await expect(link).toHaveAttribute('href', 'https://example.test/feeding-protocol');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(notes.getByRole('link', { name: 'Edit' })).toHaveAttribute(
    'href',
    '/settings#preferences',
  );

  await actAs(page, 'Bob');
  await page.goto('/feeding');
  await expect(page.locator('.feeding-notes')).toContainText('Emergency: Dr. X, 555-0100');
  await expect(page.locator('.feeding-notes').getByRole('link', { name: 'Edit' })).toHaveCount(0);

  await actAs(page, 'Admin');
  await page.goto('/settings#preferences');
  await page.getByLabel('Feeding Schedule notes & links').fill('');
  await page.getByRole('button', { name: 'Save preferences' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Preferences saved' })).toBeVisible();
  await page.goto('/feeding');
  await expect(page.locator('.feeding-notes')).toHaveCount(0);
});
