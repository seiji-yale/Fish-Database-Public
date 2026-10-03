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
    data: { name, dob: '2026-01-05', protocols: [{ type: 'tails', label: 'Tails' }] },
  });
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { id: string }).id;
}

const dialog = (page: Page) => page.getByRole('dialog');
const toast = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });
const cryo = (page: Page) => page.locator('#cryo');

/** Row actions sit behind the "⋯" menu of the first visible record. */
async function rowAction(page: Page, name: string) {
  await cryo(page).locator('.row-menu summary:visible').first().click();
  await cryo(page)
    .locator('.row-menu__items:visible')
    .getByRole('button', { name, exact: true })
    .click();
}

test('add a record with the suggested ID, edit it, remove it; the header follows', async ({
  page,
}, testInfo) => {
  await actAs(page, 'Bob');
  const id = await createLine(page, unique(testInfo, 'cy'));
  await page.goto(`/lines/${id}`);
  await expect(cryo(page)).toContainText('Cryopreserved: No');

  await cryo(page).getByRole('button', { name: '+ Add record' }).click();
  await expect(dialog(page).getByTestId('cryo-next-free')).toContainText(/Next free ID: C\d{4}/);
  // The first ID is prefilled with the suggestion; the last ID makes an 8-straw range.
  const start = await dialog(page).getByLabel('First cryo ID').inputValue();
  expect(start).toMatch(/^C\d{4}$/);
  const last = `C${String(Number(start.slice(1)) + 7).padStart(4, '0')}`;
  await dialog(page).getByLabel('Place', { exact: true }).selectOption('Demo freezer shelf');
  await dialog(page).getByLabel('Box name').fill('Demo cryo box-Bob');
  await dialog(page).getByLabel('Last cryo ID').fill(last);
  await expect(dialog(page).getByTestId('cryo-derived-count')).toContainText('Count: 8');
  await dialog(page).getByRole('button', { name: 'Add record' }).click();
  await expect(toast(page, 'Cryopreservation record added (version 2)')).toBeVisible();
  await expect(cryo(page)).toContainText('Cryopreserved: Yes (1 record, 8 straws)');
  await expect(page.locator('#history .history-item').first()).toContainText(
    `Added cryo record ${start}–${last} (8) at Demo freezer shelf.`,
  );

  // Edit: shorten the range to 4 straws.
  await rowAction(page, 'Edit');
  const shorter = `C${String(Number(start.slice(1)) + 3).padStart(4, '0')}`;
  await dialog(page).getByLabel('Last cryo ID').fill(shorter);
  await expect(dialog(page).getByTestId('cryo-derived-count')).toContainText('Count: 4');
  await dialog(page).getByRole('button', { name: 'Save' }).click();
  await expect(toast(page, 'Cryopreservation record updated (version 3)')).toBeVisible();
  await expect(cryo(page)).toContainText('Cryopreserved: Yes (1 record, 4 straws)');

  // Remove asks for confirmation; the header goes back to No.
  await rowAction(page, 'Remove');
  await expect(dialog(page)).toContainText(
    'The line stays cryopreserved while another record remains.',
  );
  await dialog(page).getByRole('button', { name: 'Remove record' }).click();
  await expect(toast(page, 'Cryopreservation record removed (version 4)')).toBeVisible();
  await expect(cryo(page)).toContainText('Cryopreserved: No');
});

test('inline errors for a backwards range and a half range; "Other…" takes a free-text place', async ({
  page,
}, testInfo) => {
  await actAs(page, 'Bob');
  const id = await createLine(page, unique(testInfo, 'ce'));
  await page.goto(`/lines/${id}`);
  await cryo(page).getByRole('button', { name: '+ Add record' }).click();
  await dialog(page).getByLabel('First cryo ID').fill('C0700');
  await dialog(page).getByLabel('Last cryo ID').fill('C0600');
  await dialog(page).getByRole('button', { name: 'Add record' }).click();
  await expect(dialog(page)).toContainText('The last ID must not be smaller than the first ID.');
  await expect(dialog(page).getByLabel('Last cryo ID')).toBeFocused();

  await dialog(page).getByLabel('First cryo ID').fill('');
  await dialog(page).getByLabel('Last cryo ID').fill('');
  await dialog(page).getByLabel('Place', { exact: true }).selectOption('Other…');
  await dialog(page).getByLabel('Place (other)').fill('Freezer 9');
  await dialog(page).getByLabel('Count').fill('12');
  await dialog(page).getByRole('button', { name: 'Add record' }).click();
  await expect(toast(page, 'Cryopreservation record added')).toBeVisible();
  await expect(cryo(page)).toContainText('Freezer 9');
  await expect(cryo(page)).toContainText('Cryopreserved: Yes (1 record, 12 straws)');

  // The new place was saved: it is in the list the next time.
  await cryo(page).getByRole('button', { name: '+ Add record' }).click();
  await expect(
    dialog(page).getByLabel('Place', { exact: true }).locator('option', { hasText: 'Freezer 9' }),
  ).toHaveCount(1);
});

test('Guests see no cryo controls; the menu opens the add form for members', async ({
  page,
}, testInfo) => {
  await actAs(page, 'Bob');
  const id = await createLine(page, unique(testInfo, 'cm'));
  await page.goto(`/lines/${id}`);
  await page.locator('.activity-menu summary').click();
  await page
    .locator('.activity-menu__items')
    .getByRole('button', { name: /^Update Cryopreservation Info/ })
    .click();
  await expect(dialog(page)).toContainText('Add cryopreservation record');
  await dialog(page).getByRole('button', { name: 'Cancel' }).click();

  await actAs(page, 'Guest');
  await page.reload();
  await expect(cryo(page).getByRole('button', { name: '+ Add record' })).toHaveCount(0);
});

test('use vials: they leave the list, are listed as used, and their IDs cannot be used again', async ({
  page,
}, testInfo) => {
  await actAs(page, 'Bob');
  const id = await createLine(page, unique(testInfo, 'cu'));
  // A block of IDs of its own per viewport: used IDs are gone for good, so runs must not overlap.
  const base = testInfo.project.name.startsWith('phone')
    ? 9100
    : testInfo.project.name.startsWith('tablet')
      ? 9200
      : 9300;
  const first = `C${String(base).padStart(4, '0')}`;
  const last = `C${String(base + 7).padStart(4, '0')}`;
  const second = `C${String(base + 1).padStart(4, '0')}`;
  const third = `C${String(base + 2).padStart(4, '0')}`;
  await page.goto(`/lines/${id}`);

  await cryo(page).getByRole('button', { name: '+ Add record' }).click();
  await dialog(page).getByLabel('First cryo ID').fill(first);
  await dialog(page).getByLabel('Last cryo ID').fill(last);
  await dialog(page).getByRole('button', { name: 'Add record' }).click();
  await expect(cryo(page)).toContainText('Cryopreserved: Yes (1 record, 8 straws)');

  // "+ Add record" also records use: choose "Use vials".
  await cryo(page).getByRole('button', { name: '+ Add record' }).click();
  await dialog(page).getByText('Use vials', { exact: true }).click();
  await expect(dialog(page).getByTestId('cryo-available')).toContainText(`${first}–${last}`);
  // The hint's example is made of vials that can really be used (T-028 follow-up).
  await expect(dialog(page)).toContainText(`A range works too: ${first}-${third}.`);
  await dialog(page).getByLabel('Used vial IDs').fill(`${first}, ${second}-${third}`);
  await dialog(page).getByLabel('Purpose / note (optional)').fill('thaw for crossing');
  await dialog(page).getByRole('button', { name: 'Record use' }).click();
  await expect(toast(page, 'Vial use recorded (version 3)')).toBeVisible();
  await expect(cryo(page)).toContainText('Cryopreserved: Yes (1 record, 5 straws)');
  await expect(cryo(page)).toContainText('3 used');
  await cryo(page).getByText('Used vials (3)').click();
  await expect(cryo(page).locator('.cryo-used')).toContainText(first);
  await expect(cryo(page).locator('.cryo-used')).toContainText('thaw for crossing');
  await expect(page.locator('#history .history-item').first()).toContainText('Used cryo vials');

  // The use form lists only the vials that are left; a used ID cannot be used or registered again.
  await rowAction(page, 'Use vials');
  const fourth = `C${String(base + 3).padStart(4, '0')}`;
  await expect(dialog(page).getByTestId('cryo-available')).toHaveText(
    `Vials on this line: ${fourth}–${last}`,
  );
  await expect(dialog(page)).toContainText(
    `A range works too: ${fourth}-C${String(base + 5).padStart(4, '0')}.`,
  );
  await dialog(page).getByLabel('Used vial IDs').fill(first);
  await dialog(page).getByRole('button', { name: 'Record use' }).click();
  await expect(dialog(page)).toContainText(`${first} was already used and cannot be used again.`);
  await dialog(page).getByRole('button', { name: 'Cancel' }).click();
  await cryo(page).getByRole('button', { name: '+ Add record' }).click();
  await dialog(page).getByLabel('First cryo ID').fill(first);
  await dialog(page).getByLabel('Last cryo ID').fill(third);
  await dialog(page).getByRole('button', { name: 'Add record' }).click();
  await expect(dialog(page)).toContainText('was already used and cannot be registered again.');
});

test('T-028: undo a vial use after a warning; the vial returns, its ID is free again, Guests cannot', async ({
  page,
}, testInfo) => {
  await actAs(page, 'Bob');
  const id = await createLine(page, unique(testInfo, 'un'));
  const base = testInfo.project.name.startsWith('phone')
    ? 9400
    : testInfo.project.name.startsWith('tablet')
      ? 9500
      : 9600;
  const first = `C${String(base).padStart(4, '0')}`;
  const last = `C${String(base + 7).padStart(4, '0')}`;
  const second = `C${String(base + 1).padStart(4, '0')}`;
  await page.goto(`/lines/${id}`);
  await cryo(page).getByRole('button', { name: '+ Add record' }).click();
  await dialog(page).getByLabel('First cryo ID').fill(first);
  await dialog(page).getByLabel('Last cryo ID').fill(last);
  await dialog(page).getByRole('button', { name: 'Add record' }).click();
  await expect(cryo(page)).toContainText('Cryopreserved: Yes (1 record, 8 straws)');
  await cryo(page).getByRole('button', { name: '+ Add record' }).click();
  await dialog(page).getByText('Use vials', { exact: true }).click();
  await dialog(page).getByLabel('Used vial IDs').fill(`${first}, ${second}`);
  await dialog(page).getByRole('button', { name: 'Record use' }).click();
  await expect(cryo(page)).toContainText('Cryopreserved: Yes (1 record, 6 straws)');

  await cryo(page).getByText('Used vials (2)').click();
  await cryo(page)
    .getByRole('button', { name: `Undo the use of ${first}` })
    .click();
  // The warning says what will happen, and Cancel changes nothing.
  await expect(dialog(page)).toContainText('Undo this vial use?');
  await expect(dialog(page)).toContainText(`${first} will go back into`);
  await expect(dialog(page)).toContainText('History shows your name');
  await dialog(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(cryo(page)).toContainText('6 straws');

  await cryo(page)
    .getByRole('button', { name: `Undo the use of ${first}` })
    .click();
  await dialog(page).getByLabel('Why is it undone? (optional)').fill('typed the wrong ID');
  await dialog(page).getByRole('button', { name: 'Undo use' }).click();
  await expect(toast(page, 'Vial use undone')).toBeVisible();
  await expect(cryo(page)).toContainText('Cryopreserved: Yes (1 record, 7 straws)');
  await expect(cryo(page)).toContainText('1 used');
  await expect(page.locator('#history .history-item').first()).toContainText(
    `Undid a cryo vial use ${first}`,
  );
  await expect(page.locator('#history .history-item').first()).toContainText('Bob');

  // The undone ID is free again: it can be used once more.
  await rowAction(page, 'Use vials');
  await dialog(page).getByLabel('Used vial IDs').fill(first);
  await dialog(page).getByRole('button', { name: 'Record use' }).click();
  await expect(toast(page, 'Vial use recorded')).toBeVisible();

  // A Guest sees the used list but no Undo button.
  await actAs(page, 'Guest');
  await page.reload();
  await cryo(page)
    .getByText(/Used vials/)
    .click();
  await expect(cryo(page).getByRole('button', { name: /^Undo the use/ })).toHaveCount(0);
  await actAs(page, 'Bob');
});
