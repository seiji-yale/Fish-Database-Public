import { expect, test } from '@playwright/test';
import { actAs } from './auth';
import type { Page, TestInfo } from '@playwright/test';

/**
 * Names are unique per viewport project (the three projects share one local database) and short:
 * the Line List's name column does not wrap, and a long name would widen the table past the
 * window in the read-only list specs' layout checks.
 */
function unique(testInfo: TestInfo, suffix: string): string {
  const viewport = testInfo.project.name.replace('-writes', '').replace(/^(\w)\w*-/, '$1');
  return `${viewport}-${suffix}`;
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

async function fillPcrLine(page: Page, name: string) {
  await page.getByLabel('Line name', { exact: true }).fill(name);
  await page.getByLabel('Gene', { exact: true }).fill('zg');
  await page.getByLabel('Date of birth', { exact: true }).fill('2026-01-05');
  await page.getByRole('radio', { name: 'PCR', exact: true }).check();
  await page.getByLabel('Forward primer name', { exact: true }).fill('Fe');
  await page.getByLabel('Reverse primer name', { exact: true }).fill('Re');
}

test('AC1/AC2: create a PCR line without horizontal scroll, land on its detail with version 1', async ({
  page,
}, testInfo) => {
  const name = unique(testInfo, 'pcr');
  await actAs(page, 'Bob');
  await page.goto('/lines/new');
  await expect(page.getByRole('heading', { name: 'New Line', level: 1 })).toBeVisible();
  await noHorizontalScroll(page);

  await fillPcrLine(page, name);
  // BR-9 defaults are pre-filled and editable.
  await expect(page.getByLabel('Annealing temperature (°C)', { exact: true })).toHaveValue('60');
  await expect(page.getByLabel('Cycles', { exact: true })).toHaveValue('35');
  await noHorizontalScroll(page);

  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/\/lines\/[^/]+$/);
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
  await expect(
    page.getByRole('status').filter({ hasText: `Line ${name} was created` }),
  ).toBeVisible();
  await expect(
    page.locator('.history-item').filter({ hasText: 'Line created' }).first(),
  ).toContainText('Line created.');

  // The new line is in the Line List (Active) and in Recent Activity on the Dashboard.
  await page.goto(`/lines?q=${encodeURIComponent(name)}`);
  await expect(page.getByText(name).filter({ visible: true }).first()).toBeVisible();
  await page.goto('/');
  await expect(
    page.locator('.activity-list').getByText(name).filter({ visible: true }).first(),
  ).toBeVisible();
});

test('inline validation: messages appear next to the fields and focus moves to the first problem', async ({
  page,
}) => {
  await actAs(page, 'Bob');
  await page.goto('/lines/new');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Enter the line name.')).toBeVisible();
  await expect(page.getByText('Enter the date of birth (YYYY-MM-DD).')).toBeVisible();
  await expect(
    page.getByRole('alert').filter({ hasText: '2 fields need attention' }),
  ).toBeVisible();
  await expect(page.getByLabel('Line name', { exact: true })).toBeFocused();
  await expect(page.getByLabel('Line name', { exact: true })).toHaveAttribute(
    'aria-invalid',
    'true',
  );

  await page.getByLabel('Line name', { exact: true }).fill('future-dob');
  await page.getByLabel('Date of birth', { exact: true }).fill('2999-01-01');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('The date of birth cannot be in the future.')).toBeVisible();
  await expect(page.getByLabel('Date of birth', { exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Today' }).click();
  await expect(page.getByLabel('Date of birth', { exact: true })).not.toHaveValue('2999-01-01');
});

test('AC3: a duplicate name (any case) is refused with a clear message and a link to the existing line', async ({
  page,
}) => {
  await actAs(page, 'Bob');
  await page.goto('/lines/new');
  await page.getByLabel('Line name', { exact: true }).fill('DEMO_C3');
  await page.getByLabel('Date of birth', { exact: true }).fill('2026-01-05');
  await page.getByLabel('Gene', { exact: true }).click(); // blur runs the uniqueness check
  await expect(page.getByText(/A line named "demo_c3" already exists/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open the existing line' })).toHaveAttribute(
    'href',
    /\/lines\/.+/,
  );
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/\/lines\/new$/);
  await expect(page.getByLabel('Line name', { exact: true })).toBeFocused();
});

test('phenotype chips are keyboard accessible: Enter adds, Backspace removes, Remove buttons work', async ({
  page,
}) => {
  await page.goto('/lines/new');
  const input = page.getByLabel('Phenotype(s)', { exact: true });
  await input.fill('curly tail');
  await input.press('Enter');
  await input.fill('small eye');
  await input.press('Enter');
  const chips = page.getByRole('list', { name: 'Added phenotypes' }).getByRole('listitem');
  await expect(chips).toHaveCount(2);
  await input.press('Backspace');
  await expect(chips).toHaveCount(1);
  await page.getByRole('button', { name: 'Remove phenotype curly tail' }).click();
  await expect(chips).toHaveCount(0);
  // Enter in the chip box never submits the form.
  await expect(page).toHaveURL(/\/lines\/new$/);
});

test('a Guest is told they cannot change line data', async ({ page }, testInfo) => {
  await actAs(page, 'Guest');
  await page.goto('/lines/new');
  await fillPcrLine(page, unique(testInfo, 'guest'));
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'Guests can read but cannot change anything' }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/lines\/new$/);
});

test('Save and add another creates two lines in a row, keeping the ID method and attribute names', async ({
  page,
}, testInfo) => {
  const first = unique(testInfo, 'ag1');
  const second = unique(testInfo, 'ag2');
  await actAs(page, 'Bob');
  await page.goto('/lines/new');
  await fillPcrLine(page, first);
  await page.getByRole('button', { name: '+ Add attribute' }).click();
  await page.getByLabel('Attribute name', { exact: true }).fill('Source');
  await page.getByLabel('Value', { exact: true }).fill('lab');
  await page.getByRole('button', { name: 'Save and add another' }).click();

  const toast = page.getByRole('status').filter({ hasText: `Line ${first} was created` });
  await expect(toast).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open the new line' })).toHaveAttribute(
    'href',
    /\/lines\/.+/,
  );
  await expect(page.getByLabel('Line name', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Line name', { exact: true })).toBeFocused();
  await expect(page.getByRole('radio', { name: 'PCR', exact: true })).toBeChecked();
  await expect(page.getByLabel('Attribute name', { exact: true })).toHaveValue('Source');
  await expect(page.getByLabel('Value', { exact: true })).toHaveValue('');

  await page.getByLabel('Line name', { exact: true }).fill(second);
  await page.getByLabel('Date of birth', { exact: true }).fill('2026-02-01');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/\/lines\/[^/]+$/);
  await expect(page.getByRole('heading', { name: second, level: 1 })).toBeVisible();

  await page.goto(`/lines?q=${encodeURIComponent(unique(testInfo, 'ag'))}`);
  await expect(page.getByText(first).filter({ visible: true }).first()).toBeVisible();
  await expect(page.getByText(second).filter({ visible: true }).first()).toBeVisible();
});

test('Cancel with typed values asks before discarding', async ({ page }) => {
  await page.goto('/lines/new');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page).toHaveURL(/\/lines$/);

  await page.goto('/lines/new');
  await page.getByLabel('Line name', { exact: true }).fill('half typed');
  await page.getByRole('button', { name: 'Cancel' }).click();
  const dialog = page.getByRole('dialog', { name: 'Discard this new line?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page).toHaveURL(/\/lines\/new$/);
  await expect(page.getByLabel('Line name', { exact: true })).toHaveValue('half typed');
});

test('an Admin saves a line as themselves, with no "who is making this change" dialog (BR-5, ADR-0005)', async ({
  page,
}, testInfo) => {
  const name = unique(testInfo, 'admin');
  await actAs(page, 'Admin');
  await page.goto('/lines/new');
  await fillPcrLine(page, name);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page).toHaveURL(/\/lines\/[^/]+$/);
  await expect(page.locator('.history-item').first()).toContainText('Lab Admin');
});

test('text areas use the same font size as the other inputs (owner feedback)', async ({ page }) => {
  await page.goto('/lines/new');
  const size = (selector: string) =>
    page.locator(selector).evaluate((element) => getComputedStyle(element).fontSize);
  expect(await size('#nl-notes')).toBe(await size('#nl-name'));
  expect(parseFloat(await size('#nl-notes'))).toBeGreaterThanOrEqual(16);
});
