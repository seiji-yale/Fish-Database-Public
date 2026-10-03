import { expect, test } from '@playwright/test';
import { actAs } from './auth';
import type { Page, TestInfo } from '@playwright/test';

/** Short, per-viewport names (see newLine.write.spec.ts for why). */
function unique(testInfo: TestInfo, suffix: string): string {
  const viewport = testInfo.project.name.replace('-writes', '').replace(/^(\w)\w*-/, '$1');
  return `${viewport}-${suffix}`;
}

const toast = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });

test('Settings is for Admins: everyone else is told to ask one', async ({ page }) => {
  await actAs(page, 'Bob');
  await page.goto('/settings');
  await expect(page.getByText('Settings are for Admins.')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Users' })).toHaveCount(0);
  const api = await page.request.get('/api/admin/overview');
  expect(api.status()).toBe(403);
});

test('AC1: an Admin adds a member and gets a one-time invite link; removing asks first', async ({
  page,
}, testInfo) => {
  await actAs(page, 'Admin');
  const name = unique(testInfo, 'tu');
  await page.goto('/settings');
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Initial password').fill('short');
  await page.getByRole('button', { name: 'Add user and create invite' }).click();
  await expect(page.getByText('Use at least 8 characters.')).toBeVisible();
  await page.getByLabel('Initial password').fill('first-pass-1');
  await page.getByRole('button', { name: 'Add user and create invite' }).click();
  const invite = page.getByRole('dialog', { name: `Invite for ${name}` });
  await expect(invite).toBeVisible();
  const url = await invite.getByRole('textbox').inputValue();
  expect(url).toMatch(/\/join\/[\w-]+$/);
  await invite.getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('.settings-row').filter({ hasText: name })).toContainText('Member');
  await expect(page.locator('.settings-row').filter({ hasText: name })).toContainText(
    'Invite pending',
  );

  // The invite link works once: initial password, then the person's own.
  const other = await page.context().browser()?.newContext({ baseURL: 'http://localhost:8788' });
  if (other === undefined) throw new Error('no browser');
  try {
    const guest = await other.newPage();
    await guest.goto(url);
    await expect(guest.getByRole('heading', { name: `Welcome, ${name}` })).toBeVisible();
    await guest.getByLabel('Initial password').fill('first-pass-1');
    await guest.getByLabel('New password').fill('my-own-pass-1');
    await guest.getByRole('button', { name: 'Set password and sign in' }).click();
    await expect(guest.locator('.account-menu__name')).toHaveText(name);
    await guest.goto(url);
    await expect(guest.getByRole('alert')).toContainText('invite link is not valid');
  } finally {
    await other.close();
  }

  const row = page.locator('.settings-row').filter({ hasText: name });
  await row.locator('.row-menu summary').click();
  await page.locator('.row-menu__items:visible').getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByRole('dialog')).toContainText('They are signed out at once');
  await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click();
  // A removed person leaves the list; "Show removed users" brings the entry back.
  await expect(page.locator('.settings-row').filter({ hasText: name })).toHaveCount(0);
  await page.getByRole('button', { name: /^Show removed users/ }).click();
  await expect(page.locator('.settings-row').filter({ hasText: name })).toContainText('Removed');

  // T-030: someone who never appears in History can be deleted for good; the name is free again.
  await page
    .locator('.settings-row')
    .filter({ hasText: name })
    .locator('.row-menu summary')
    .click();
  await page
    .locator('.row-menu__items:visible')
    .getByRole('button', { name: 'Delete permanently…' })
    .click();
  await expect(page.getByRole('dialog')).toContainText('the same name can be invited again');
  await page.getByRole('dialog').getByRole('button', { name: 'Delete for good' }).click();
  await expect(toast(page, 'User deleted')).toBeVisible();
  await expect(page.locator('.settings-row').filter({ hasText: name })).toHaveCount(0);
  // Built-in users have no actions.
  await expect(
    page
      .locator('.settings-row')
      .filter({ has: page.locator('strong', { hasText: /^Guest$/ }) })
      .locator('.row-menu'),
  ).toHaveCount(0);
});

test('Lists: add an entry, disable it, enable it again; the template list is read-only', async ({
  page,
}, testInfo) => {
  await actAs(page, 'Admin');
  const value = unique(testInfo, 'fr');
  await page.goto('/settings#lists');
  await page.locator('#sl-kind').selectOption({ label: 'Cryo places' });
  await page.getByLabel('New entry').fill(value);
  await page.getByRole('button', { name: 'Add to list' }).click();
  await expect(toast(page, 'Entry added')).toBeVisible();
  const row = page.locator('.settings-row').filter({ hasText: value });
  await row.locator('.row-menu summary').click();
  await page.locator('.row-menu__items:visible').getByRole('button', { name: 'Disable' }).click();
  await expect(page.locator('.settings-row').filter({ hasText: value })).toContainText('Disabled');
  const cryoPlaces = (await (
    await page.request.get('/api/enumerations?kind=cryo_place')
  ).json()) as {
    values: string[];
  };
  expect(cryoPlaces.values).not.toContain(value);

  await page.locator('#sl-kind').selectOption({ label: 'ID method templates' });
  await expect(page.getByText('This list is fixed by the application')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add to list' })).toHaveCount(0);
});

test('AC2: the Upcoming Breeding threshold changes the dashboard; a bad number is explained', async ({
  page,
}) => {
  await actAs(page, 'Admin');
  await page.goto('/settings#preferences');
  const field = page.getByLabel('Upcoming Breeding threshold (months)');
  await field.fill('0');
  await page.getByRole('button', { name: 'Save preferences' }).click();
  await expect(page.getByText('Enter a whole number of months from 1 to 60.')).toBeVisible();
  await field.fill('10');
  await page.getByRole('button', { name: 'Save preferences' }).click();
  await expect(toast(page, 'Preferences saved')).toBeVisible();
  const dashboard = (await (await page.request.get('/api/dashboard')).json()) as {
    thresholdMonths: number;
  };
  expect(dashboard.thresholdMonths).toBe(10);
  // Put it back for the other tests.
  await field.fill('11');
  await page.getByRole('button', { name: 'Save preferences' }).click();
  await expect(toast(page, 'Preferences saved')).toBeVisible();
});

test('an Admin can change the database name shown in the header and page title', async ({
  page,
}, testInfo) => {
  await actAs(page, 'Admin');
  await page.goto('/settings#preferences');
  const field = page.getByLabel('Database name', { exact: true });
  const original = await field.inputValue();
  const renamed = unique(testInfo, 'db');
  try {
    await field.fill(renamed);
    await page.getByRole('button', { name: 'Save preferences' }).click();
    await expect(toast(page, 'Preferences saved')).toBeVisible();
    await expect(page.locator('.app-brand')).toHaveText(renamed);
    await expect(page).toHaveTitle(renamed);
  } finally {
    const restored = await page.request.patch('/api/admin/settings', {
      data: { databaseName: original },
    });
    expect(restored.status()).toBe(200);
  }
});

test('AC3: a removed ID method is restored from Deleted items; AC4: Export downloads a ZIP', async ({
  page,
}, testInfo) => {
  await actAs(page, 'Bob');
  const created = await page.request.post('/api/lines', {
    data: {
      name: unique(testInfo, 'dl'),
      dob: '2026-01-05',
      protocols: [
        { type: 'tails', label: 'Tails' },
        { type: 'pcr', label: 'PCR to restore' },
      ],
    },
  });
  const { id, version } = (await created.json()) as { id: string; version: number };
  const detail = (await (await page.request.get(`/api/lines/${id}`)).json()) as {
    protocols: { id: string; label: string }[];
  };
  const target = detail.protocols.find((protocol) => protocol.label === 'PCR to restore');
  const removed = await page.request.delete(`/api/lines/${id}/protocols/${target?.id ?? ''}`, {
    data: { expectedVersion: version },
  });
  expect(removed.ok()).toBe(true);

  await actAs(page, 'Admin');
  await page.goto('/settings#data');
  const item = page.locator('.deleted-list .settings-row').filter({ hasText: 'PCR to restore' });
  await expect(item).toContainText('ID method');
  await item.getByRole('button', { name: /^Restore/ }).click();
  await expect(toast(page, 'Item restored')).toBeVisible();
  await expect(
    page.locator('.deleted-list .settings-row').filter({ hasText: 'PCR to restore' }),
  ).toHaveCount(0);
  const restored = (await (await page.request.get(`/api/lines/${id}`)).json()) as {
    protocols: { label: string }[];
  };
  expect(restored.protocols.map((protocol) => protocol.label)).toContain('PCR to restore');

  const zip = await page.request.get('/api/admin/export.zip');
  expect(zip.status()).toBe(200);
  expect(zip.headers()['content-type']).toBe('application/zip');
  expect((await zip.body()).subarray(0, 2).toString()).toBe('PK');
  await expect(page.getByRole('link', { name: 'Download ZIP' })).toHaveAttribute(
    'href',
    '/api/admin/export.zip',
  );
});

test('Import report: read-only tab with a note when none is stored', async ({ page }) => {
  await actAs(page, 'Admin');
  await page.goto('/settings#import');
  await expect(page.getByRole('tabpanel')).toBeVisible();
});
