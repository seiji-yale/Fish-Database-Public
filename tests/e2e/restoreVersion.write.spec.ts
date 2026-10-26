import { expect, test } from '@playwright/test';
import { actAs } from './auth';
import type { Page, TestInfo } from '@playwright/test';

function unique(testInfo: TestInfo, suffix: string): string {
  const viewport = testInfo.project.name.replace('-writes', '').replace(/^(\w)\w*-/, '$1');
  return `${viewport}-${suffix}`;
}

async function createLine(page: Page, name: string): Promise<string> {
  const response = await page.request.post('/api/lines', {
    data: { name, gene: 'zg', dob: '2026-01-05' },
  });
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { id: string }).id;
}

async function startBreeding(page: Page, id: string, expectedVersion: number): Promise<void> {
  // The server's "today" is in America/New_York; UTC is a day ahead in the evening there.
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(
    new Date(),
  );
  const response = await page.request.post(`/api/lines/${id}/start-breeding`, {
    data: { expectedVersion, crossDate: today },
  });
  expect(response.ok()).toBe(true);
}

const restoreButtons = (page: Page) => page.getByRole('button', { name: /Restore this version/ });

test('T-040: Restore works on a Breeding line when the content differs', async ({
  page,
}, testInfo) => {
  await actAs(page, 'Bob');
  const id = await createLine(page, unique(testInfo, 't40-content'));
  await startBreeding(page, id, 1);
  await page.request.patch(`/api/lines/${id}`, { data: { expectedVersion: 2, gene: 'g2' } });
  await actAs(page, 'Admin');
  await page.goto(`/lines/${id}`);
  await restoreButtons(page).last().click();
  const confirm = page.getByRole('dialog', { name: 'Restore version 1?' });
  await expect(confirm.getByRole('button', { name: 'Restore' })).toBeEnabled();
  await confirm.getByRole('button', { name: 'Restore' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Restored the content of version 1' }),
  ).toBeVisible();
});

test('T-040: when only the status differs, the dialog says why Restore is off', async ({
  page,
}, testInfo) => {
  await actAs(page, 'Bob');
  const id = await createLine(page, unique(testInfo, 't40-status'));
  await startBreeding(page, id, 1);
  await actAs(page, 'Admin');
  await page.goto(`/lines/${id}`);
  await restoreButtons(page).last().click();
  const confirm = page.getByRole('dialog', { name: 'Restore version 1?' });
  await expect(confirm).toContainText('Nothing to restore');
  const button = confirm.getByRole('button', { name: 'Restore' });
  await expect(button).toBeDisabled();
  await expect(confirm).toContainText('does not change the status');
});

test('T-040: a failed preview shows the error and Try again loads it', async ({
  page,
}, testInfo) => {
  await actAs(page, 'Bob');
  const id = await createLine(page, unique(testInfo, 't40-retry'));
  await page.request.patch(`/api/lines/${id}`, { data: { expectedVersion: 1, gene: 'g2' } });
  await actAs(page, 'Admin');
  await page.goto(`/lines/${id}`);
  let failures = 1;
  await page.route('**/restore/1/preview', async (route) => {
    if (failures > 0) {
      failures -= 1;
      await route.fulfill({ status: 500, body: 'oops' });
    } else {
      await route.continue();
    }
  });
  await restoreButtons(page).last().click();
  const confirm = page.getByRole('dialog', { name: 'Restore version 1?' });
  await expect(confirm.getByRole('alert')).toContainText('could not be loaded');
  await expect(confirm.getByRole('button', { name: 'Restore' })).toBeDisabled();
  await confirm.getByRole('button', { name: 'Try again' }).click();
  await expect(confirm.getByRole('button', { name: 'Restore' })).toBeEnabled();
});
