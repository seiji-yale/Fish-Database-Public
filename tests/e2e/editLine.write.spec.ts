import { expect, test } from '@playwright/test';
import { actAs } from './auth';
import type { Page, TestInfo } from '@playwright/test';

/** Short, per-viewport names (see newLine.write.spec.ts for why). */
function unique(testInfo: TestInfo, suffix: string): string {
  const viewport = testInfo.project.name.replace('-writes', '').replace(/^(\w)\w*-/, '$1');
  return `${viewport}-${suffix}`;
}

/** Creates a line through the API and returns its id (the edit tests start from a known line). */
async function createLine(page: Page, name: string): Promise<string> {
  const response = await page.request.post('/api/lines', {
    data: {
      name,
      gene: 'zg',
      notes: 'first notes',
      dob: '2026-01-05',
      phenotypes: ['p1'],
      attributes: [{ key: 'Source', value: 'lab' }],
    },
  });
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { id: string }).id;
}

const edit = (page: Page) => page.getByRole('button', { name: 'Edit', exact: true });
const dialog = (page: Page) => page.getByRole('dialog', { name: /^Edit / });

test('AC1: edit the gene; History shows who, when, before and after', async ({
  page,
}, testInfo) => {
  const name = unique(testInfo, 'ed');
  await actAs(page, 'Bob');
  const id = await createLine(page, name);
  await page.goto(`/lines/${id}`);

  await edit(page).click();
  await expect(dialog(page)).toBeVisible();
  await expect(page.getByLabel('Line name', { exact: true })).toBeFocused();
  await page.getByLabel('Gene', { exact: true }).fill('zg-fixed');
  await page.getByLabel('Reason / note (optional)').fill('typo in the gene');
  await dialog(page).getByRole('button', { name: 'Save' }).click();

  await expect(dialog(page)).toHaveCount(0);
  await expect(
    page.getByRole('status').filter({ hasText: 'Line updated (version 2)' }),
  ).toBeVisible();
  await expect(edit(page)).toBeFocused();
  const item = page.locator('#history .history-item').first();
  await expect(item).toContainText('Bob');
  await expect(item).toContainText('Line details updated: gene.');
  await expect(item).toContainText('typo in the gene');
  await item.getByRole('button', { name: 'Show changes' }).click();
  await expect(item.getByRole('row', { name: 'Gene zg zg-fixed' })).toBeVisible();
});

test('the edit dialog warns about DOB, shows inline errors and asks before discarding', async ({
  page,
}, testInfo) => {
  await actAs(page, 'Bob');
  const id = await createLine(page, unique(testInfo, 'ev'));
  await page.goto(`/lines/${id}`);
  await edit(page).click();

  await page.getByLabel('Date of birth', { exact: true }).fill('2026-02-01');
  await expect(
    page.getByText('Changing the date of birth affects Upcoming Breeding.'),
  ).toBeVisible();
  await page.getByLabel('Line name', { exact: true }).fill('');
  await dialog(page).getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Enter the line name.')).toBeVisible();
  await expect(page.getByLabel('Line name', { exact: true })).toBeFocused();

  // Escape with unsaved changes asks first; keeping the edits leaves the dialog open.
  await page.keyboard.press('Escape');
  const confirm = page.getByRole('dialog', { name: 'Discard your changes?' });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await confirm.getByRole('button', { name: 'Confirm' }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(edit(page)).toBeFocused();
});

test('Tab stays inside the edit dialog', async ({ page }, testInfo) => {
  await actAs(page, 'Bob');
  const id = await createLine(page, unique(testInfo, 'et'));
  await page.goto(`/lines/${id}`);
  await edit(page).click();
  for (let step = 0; step < 40; step += 1) {
    await page.keyboard.press('Tab');
    const inside = await page.evaluate(
      () => document.activeElement?.closest('[role="dialog"]') !== null,
    );
    expect(inside).toBe(true);
  }
});

test('AC2: a second tab cannot silently overwrite; it sees the BR-12 message and can reload', async ({
  browser,
  page,
}, testInfo) => {
  await actAs(page, 'Bob');
  const id = await createLine(page, unique(testInfo, 'ec'));
  await page.goto(`/lines/${id}`);
  await edit(page).click();
  await page.getByLabel('Gene', { exact: true }).fill('from tab one');

  // The "second tab": another browser context edits the same line first (as Carol).
  const other = await browser.newContext({ baseURL: 'http://localhost:8788' });
  const otherPage = await other.newPage();
  await actAs(otherPage, 'Carol');
  const saved = await otherPage.request.patch(`/api/lines/${id}`, {
    data: { expectedVersion: 1, gene: 'from tab two' },
  });
  expect(saved.ok()).toBe(true);
  await other.close();

  await dialog(page).getByRole('button', { name: 'Save' }).click();
  const alert = dialog(page).getByRole('alert').filter({ hasText: 'was changed by Carol' });
  await expect(alert).toContainText('reload to see the changes');
  await expect(dialog(page)).toBeVisible();
  await page.getByRole('button', { name: 'Reload' }).click();
  await expect(page.locator('.detail-title')).toContainText('from tab two');
  await expect(page.locator('#history .history-item').first()).toContainText('Carol');
});

test('a rename to another line’s name is refused inline', async ({ page }, testInfo) => {
  await actAs(page, 'Bob');
  const id = await createLine(page, unique(testInfo, 'er'));
  await page.goto(`/lines/${id}`);
  await edit(page).click();
  await page.getByLabel('Line name', { exact: true }).fill('DEMO_C3');
  await dialog(page).getByRole('button', { name: 'Save' }).click();
  await expect(dialog(page).getByText(/A line named "demo_c3" already exists/)).toBeVisible();
  await expect(page.getByLabel('Line name', { exact: true })).toBeFocused();
});

test('phenotypes and More attributes can be edited', async ({ page }, testInfo) => {
  await actAs(page, 'Bob');
  const id = await createLine(page, unique(testInfo, 'ea'));
  await page.goto(`/lines/${id}`);
  await edit(page).click();
  const phenotypes = page.getByLabel('Phenotype(s)', { exact: true });
  await phenotypes.fill('p2');
  await phenotypes.press('Enter');
  await page.getByRole('button', { name: 'Remove phenotype p1' }).click();
  await page.getByLabel('Value', { exact: true }).fill('other lab');
  await dialog(page).getByRole('button', { name: 'Save' }).click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.locator('#summary')).toContainText('p2');
  await expect(page.locator('#summary')).not.toContainText('p1');
  await expect(page.locator('#summary')).toContainText('Source: other lab');
});

test('a Guest cannot open the line editor', async ({ page }, testInfo) => {
  await actAs(page, 'Bob');
  const id = await createLine(page, unique(testInfo, 'eg'));
  await actAs(page, 'Guest');
  await page.goto(`/lines/${id}`);
  await expect(edit(page)).toHaveCount(0);
});

test('AC3: Admin restores an earlier version; it becomes a new version and nothing is deleted', async ({
  page,
}, testInfo) => {
  await actAs(page, 'Bob');
  const id = await createLine(page, unique(testInfo, 'rs'));
  await page.request.patch(`/api/lines/${id}`, { data: { expectedVersion: 1, gene: 'g2' } });
  await page.request.patch(`/api/lines/${id}`, { data: { expectedVersion: 2, gene: 'g3' } });

  // A Member does not see Restore.
  await page.goto(`/lines/${id}`);
  await expect(page.getByRole('button', { name: /Restore this version/ })).toHaveCount(0);

  await actAs(page, 'Admin');
  await page.goto(`/lines/${id}`);
  const restoreButtons = page.getByRole('button', { name: /Restore this version/ });
  // Not offered on the newest version.
  await expect(restoreButtons).toHaveCount(2);
  await restoreButtons.last().click();

  const confirm = page.getByRole('dialog', { name: 'Restore version 1?' });
  await expect(confirm).toBeVisible();
  await expect(confirm.getByRole('row', { name: 'Gene g3 zg' })).toBeVisible();
  await confirm.getByRole('button', { name: 'Restore' }).click();

  await expect(
    page.getByRole('status').filter({ hasText: 'Restored the content of version 1' }),
  ).toBeVisible();
  const items = page.locator('#history .history-item');
  await expect(items).toHaveCount(4);
  await expect(items.first()).toContainText('Lab Admin');
  await expect(items.first()).toContainText('Restored the content of version 1.');
  await expect(items.nth(3)).toContainText('Line created');
});
