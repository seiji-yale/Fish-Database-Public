import { expect, test } from '@playwright/test';
import { actAs } from './auth';
import type { Page, TestInfo } from '@playwright/test';

/** Short, per-viewport names (see newLine.write.spec.ts for why). */
function unique(testInfo: TestInfo, suffix: string): string {
  const viewport = testInfo.project.name.replace('-writes', '').replace(/^(\w)\w*-/, '$1');
  return `${viewport}-${suffix}`;
}

async function createLine(page: Page, name: string): Promise<string> {
  const response = await page.request.post('/api/lines', {
    data: { name, gene: 'zg', dob: '2026-01-05', phenotypes: [], attributes: [] },
  });
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { id: string }).id;
}

const menu = (page: Page) => page.locator('.activity-menu summary');
const item = (page: Page, name: RegExp) =>
  page.locator('.activity-menu__items').getByRole('button', { name });
const toast = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });

async function choose(page: Page, name: RegExp) {
  await menu(page).click();
  await item(page, name).click();
}

test('AC1/AC2: full cycle Start Breeding → +6 same generation → new generation → Close → Reopen', async ({
  page,
}, testInfo) => {
  await actAs(page, 'Bob');
  const name = unique(testInfo, 'ca');
  const id = await createLine(page, name);
  await page.goto(`/lines/${id}`);

  // Start Breeding: the cross date starts as today and has focus.
  await choose(page, /^Start Breeding/);
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(`Start breeding: ${name}`);
  await expect(page.getByLabel('Cross date')).toBeFocused();
  await dialog.getByRole('button', { name: 'Start' }).click();
  await expect(toast(page, 'Breeding started (version 2)')).toBeVisible();
  await expect(page.locator('.detail-title .status-badge')).toContainText('Breeding');
  await expect(page.locator('#activity')).toContainText('Breeding started');

  // Same generation: the person must choose; the preview shows the new total.
  await choose(page, /^Update Genotyping Record/);
  await page.getByLabel('Positive number').fill('6');
  await dialog.getByRole('button', { name: 'Save record' }).click();
  await expect(
    dialog.getByText('Choose whether this is the current generation or a new one.'),
  ).toBeVisible();
  await dialog.getByLabel('Add to the current generation').check();
  await expect(dialog.getByTestId('genotyping-preview')).toContainText(
    'IDed number will become 6 (+6)',
  );
  await dialog.getByRole('button', { name: 'Save record' }).click();
  await expect(toast(page, 'Genotyping record saved (version 3)')).toBeVisible();
  await expect(page.locator('#summary')).toContainText('IDed number');
  await expect(page.locator('#activity')).toContainText('+6 positive');

  // New generation: the new DOB defaults to the cross date; the preview follows BR-2.
  await choose(page, /^Update Genotyping Record/);
  await page.getByLabel('Positive number').fill('8');
  await dialog.getByLabel('This is a new generation').check();
  await expect(dialog.getByLabel('New DOB')).not.toHaveValue('');
  await expect(dialog.getByTestId('genotyping-preview')).toHaveText(
    'IDed number will reset to 8; generation 1 → 2; status → Current.',
  );
  await dialog.getByRole('button', { name: 'Save record' }).click();
  await expect(toast(page, 'Genotyping record saved (version 4)')).toBeVisible();
  await expect(page.locator('.detail-title .status-badge')).toContainText('Current');
  await expect(page.locator('#activity h3').first()).toContainText('Generation 2');
  await expect(page.locator('#activity h3').nth(1)).toContainText('Generation 1');

  // Close asks for confirmation; Reopen brings the line back.
  await choose(page, /^Close This Line/);
  await expect(dialog).toContainText(`${name} will move to Closed lines.`);
  await dialog.getByLabel('Reason (optional)').fill('test line');
  await dialog.getByRole('button', { name: 'Close line' }).click();
  await expect(page.locator('.detail-title .status-badge')).toContainText('Closed');
  await choose(page, /^Reopen This Line/);
  await dialog.getByRole('button', { name: 'Reopen line' }).click();
  await expect(page.locator('.detail-title .status-badge')).toContainText('Current');

  // History: created + five activities.
  await expect(page.locator('#history .history-item')).toHaveCount(6);
  await expect(page.locator('#history .history-item').first()).toContainText('Line reopened.');
});

test('AC3: items that do not apply are disabled and say why', async ({ page }, testInfo) => {
  await actAs(page, 'Bob');
  const id = await createLine(page, unique(testInfo, 'cd'));
  await page.goto(`/lines/${id}`);
  await menu(page).click();
  const reopen = item(page, /^Reopen This Line/);
  await expect(reopen).toHaveAttribute('aria-disabled', 'true');
  await expect(reopen).toContainText('Only a closed line can be reopened.');
  await reopen.click({ force: true });
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await actAs(page, 'Guest');
  await page.reload();
  await menu(page).click();
  await expect(item(page, /^Start Breeding/)).toContainText('Guests cannot change line data');
});

test('the OQ-31 date messages appear inline on the genotyping form', async ({ page }, testInfo) => {
  await actAs(page, 'Bob');
  const id = await createLine(page, unique(testInfo, 'cq'));
  await page.goto(`/lines/${id}`);
  await choose(page, /^Update Genotyping Record/);
  const dialog = page.getByRole('dialog');
  await page.getByLabel('Positive number').fill('3');
  await dialog.getByLabel('This is a new generation').check();
  await dialog.getByLabel('New DOB').fill('2026-01-01');
  await dialog.getByRole('button', { name: 'Save record' }).click();
  await expect(
    dialog.getByText("New DOB must be later than the current generation's DOB."),
  ).toBeVisible();
  await expect(dialog.getByLabel('New DOB')).toBeFocused();
});

test('Dashboard deep links open the dialog directly and explain when they cannot', async ({
  page,
}, testInfo) => {
  await actAs(page, 'Bob');
  const id = await createLine(page, unique(testInfo, 'cl'));
  await page.goto(`/lines/${id}?action=start-breeding`);
  await expect(page.getByRole('dialog')).toContainText('Start breeding');
  await expect(page).toHaveURL(new RegExp(`/lines/${id}$`));
  await page.getByRole('dialog').getByRole('button', { name: 'Start' }).click();
  await expect(toast(page, 'Breeding started (version 2)')).toBeVisible();

  // The line is breeding now: the same link only explains why nothing opens.
  await page.goto(`/lines/${id}?action=start-breeding`);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(toast(page, 'This line is already breeding.')).toBeVisible();

  await page.goto(`/lines/${id}?action=update-genotyping`);
  await expect(page.getByRole('dialog')).toContainText('Update genotyping record');
});
