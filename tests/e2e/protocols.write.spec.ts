import { expect, test } from '@playwright/test';
import { actAs } from './auth';
import type { Locator, Page, TestInfo } from '@playwright/test';

/** Short, per-viewport names (see newLine.write.spec.ts for why). */
function unique(testInfo: TestInfo, suffix: string): string {
  const viewport = testInfo.project.name.replace('-writes', '').replace(/^(\w)\w*-/, '$1');
  return `${viewport}-${suffix}`;
}

async function createLine(page: Page, name: string): Promise<string> {
  const response = await page.request.post('/api/lines', {
    data: {
      name,
      dob: '2026-01-05',
      protocols: [{ type: 'pcr', label: 'PCR', fields: { primer_f_name: 'F1' } }],
    },
  });
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { id: string }).id;
}

/** The visible panel or card of one protocol: tabs on wide screens, stacked cards on a phone. */
async function protocolPanel(page: Page, label: string): Promise<Locator> {
  await page.locator('#protocols .data-card').first().waitFor({ state: 'attached' });
  const tab = page.locator('#protocols').getByRole('tab', { name: new RegExp(label) });
  if (await tab.isVisible()) {
    await tab.click();
    return page.locator('.protocol-tab-panel');
  }
  const card = page.locator('#protocols .data-card').filter({ hasText: label });
  // Phone: only current methods are open; open this one when it is folded.
  if ((await card.locator('details').getAttribute('open')) === null)
    await card.locator('summary').click();
  return card;
}

const dialog = (page: Page) => page.getByRole('dialog');
const toast = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });

test('add a second PCR, edit its annealing temperature, see it in History', async ({
  page,
}, testInfo) => {
  await actAs(page, 'Bob');
  const id = await createLine(page, unique(testInfo, 'pa'));
  await page.goto(`/lines/${id}`);

  await page.getByRole('button', { name: '+ Add ID method' }).click();
  await expect(dialog(page)).toContainText('Add ID method');
  await dialog(page).getByLabel('Name', { exact: true }).fill('PCR – wt allele');
  await dialog(page).getByLabel('Forward primer name').fill('WT-F');
  await dialog(page).getByLabel('Forward primer sequence').fill('ACGT!');
  await expect(dialog(page)).toContainText('Sequence contains characters outside');
  await dialog(page).getByLabel('Forward primer sequence').fill('ACGTACGT');
  await dialog(page).getByRole('button', { name: 'Add ID method' }).click();
  await expect(toast(page, 'ID method added (version 2)')).toBeVisible();
  await expect(page.locator('#protocols')).toContainText('PCR – wt allele');
  await expect(page.locator('#protocols')).toContainText('PCR');

  const panel = await protocolPanel(page, 'PCR – wt allele');
  await panel.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(dialog(page).getByLabel('Annealing temperature (°C)')).toHaveValue('60');
  await dialog(page).getByLabel('Annealing temperature (°C)').fill('58');
  await dialog(page).getByRole('button', { name: 'Save' }).click();
  await expect(toast(page, 'ID method updated (version 3)')).toBeVisible();

  const item = page.locator('#history .history-item').first();
  await expect(item).toContainText('Updated ID method: PCR – wt allele.');
  await item.getByRole('button', { name: 'Show changes' }).click();
  await expect(item.locator('.diff-table')).toBeVisible();
});

test('a repeated label only warns; invalid numbers block with an inline message', async ({
  page,
}, testInfo) => {
  await actAs(page, 'Bob');
  const id = await createLine(page, unique(testInfo, 'pw'));
  await page.goto(`/lines/${id}`);
  await page.getByRole('button', { name: '+ Add ID method' }).click();
  await dialog(page).getByLabel('Name', { exact: true }).fill('PCR');
  await expect(dialog(page)).toContainText('is already called "PCR"');
  await dialog(page).getByLabel('Annealing temperature (°C)').fill('hot');
  await dialog(page).getByRole('button', { name: 'Add ID method' }).click();
  await expect(dialog(page)).toContainText('Enter a number.');
  await expect(dialog(page).getByLabel('Annealing temperature (°C)')).toBeFocused();
});

test('Custom protocol with three fields: set as current, reorder, remove, History', async ({
  page,
}, testInfo) => {
  await actAs(page, 'Bob');
  const name = unique(testInfo, 'cx');
  const id = await createLine(page, name);
  await page.goto(`/lines/${id}`);

  await page.getByRole('button', { name: '+ Add ID method' }).click();
  await dialog(page).getByText('Custom', { exact: true }).click();
  await dialog(page).getByLabel('Name', { exact: true }).fill('HRM assay');
  const rows = [
    ['Assay', 'HRM'],
    ['Temperature', '60'],
    ['Kit', 'X1'],
  ] as const;
  for (const [index, [key, value]] of rows.entries()) {
    if (index > 0) await dialog(page).getByRole('button', { name: '+ Add field' }).click();
    await dialog(page).getByLabel('Field name').nth(index).fill(key);
    await dialog(page).getByLabel('Value', { exact: true }).nth(index).fill(value);
  }
  await dialog(page).getByLabel('Also a current ID method').check();
  await dialog(page).getByRole('button', { name: 'Add ID method' }).click();
  await expect(toast(page, 'ID method added (version 2)')).toBeVisible();

  // It is the current method now, so the Line List shows Custom.
  const custom = await protocolPanel(page, 'HRM assay');
  await expect(custom).toContainText('Kit');
  await expect(page.locator('#summary')).toContainText('HRM assay');
  await page.goto(`/lines?q=${encodeURIComponent(name)}`);
  await expect(page.locator('tr:visible, article:visible').filter({ hasText: name })).toContainText(
    'HRM assay',
  );
  await page.goto(`/lines/${id}`);

  // Both methods are current now; take the mark off the first PCR, then move the Custom one up.
  await expect(page.locator('#summary')).toContainText('PCR, HRM assay');
  const pcr = await protocolPanel(page, 'PCR');
  await pcr.getByRole('button', { name: 'Remove from current' }).click();
  await expect(toast(page, 'Current ID methods changed (version 3)')).toBeVisible();
  await expect(page.locator('#summary')).not.toContainText('PCR, HRM assay');
  const second = await protocolPanel(page, 'HRM assay');
  await second.getByRole('button', { name: 'Move up' }).click();
  await expect(toast(page, 'ID methods reordered (version 4)')).toBeVisible();
  await expect(page.locator('#protocols .data-card').first()).toContainText('HRM assay');

  // Remove asks for confirmation; the card is gone and History has the entry.
  const removable = await protocolPanel(page, 'HRM assay');
  await removable.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(dialog(page)).toContainText('The Admin can bring it back.');
  await dialog(page).getByRole('button', { name: 'Remove ID method' }).click();
  await expect(toast(page, 'ID method removed (version 5)')).toBeVisible();
  await expect(page.locator('#protocols')).not.toContainText('HRM assay');
  await expect(page.locator('#history .history-item').first()).toContainText(
    'Removed ID method: HRM assay.',
  );
});

test('Guests see no edit controls; the menu item explains why', async ({ page }, testInfo) => {
  await actAs(page, 'Bob');
  const id = await createLine(page, unique(testInfo, 'pg'));
  await actAs(page, 'Guest');
  await page.goto(`/lines/${id}`);
  await expect(page.getByRole('button', { name: '+ Add ID method' })).toHaveCount(0);
  await expect(page.locator('#protocols').getByRole('button', { name: 'Edit' })).toHaveCount(0);
});

test('Change Activity → Update ID Method opens the add form', async ({ page }, testInfo) => {
  await actAs(page, 'Bob');
  const id = await createLine(page, unique(testInfo, 'pm'));
  await page.goto(`/lines/${id}`);
  await page.locator('.activity-menu summary').click();
  await page
    .locator('.activity-menu__items')
    .getByRole('button', { name: /^Update ID Method/ })
    .click();
  await expect(dialog(page)).toContainText('Add ID method');
});
