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
    data: {
      name,
      dob: '2026-01-05',
      protocols: [{ type: 'pcr', label: 'PCR', fields: { primer_f_name: 'F1' } }],
    },
  });
  expect(response.ok()).toBe(true);
  return ((await response.json()) as { id: string }).id;
}

const dialog = (page: Page) => page.getByRole('dialog');
const toast = (page: Page, text: string) => page.getByRole('status').filter({ hasText: text });
const GEL = 'tests/fixtures/gel.png';
const GEL2 = 'tests/fixtures/gel2.png';

async function loadedThumbs(page: Page, scope: string) {
  return page
    .locator(`${scope} .thumb-button img:visible`)
    .evaluateAll(
      (images) => images.filter((image) => (image as HTMLImageElement).naturalWidth > 0).length,
    );
}

test('AC1: a gel image attached to a genotyping record shows on the protocol card and in the timeline; a second one makes the first "previous"', async ({
  page,
}, testInfo) => {
  await actAs(page, 'Bob');
  const id = await createLine(page, unique(testInfo, 'up'));
  await page.goto(`/lines/${id}`);

  for (const [index, file] of [GEL, GEL2].entries()) {
    await page.locator('.activity-menu summary').click();
    await page
      .locator('.activity-menu__items')
      .getByRole('button', { name: /^Update Genotyping Record/ })
      .click();
    await page.getByLabel('Positive number').fill('3');
    await dialog(page).getByLabel('Add to the current generation').check();
    await dialog(page).getByLabel('Upload image').setInputFiles(file);
    await expect(dialog(page)).toContainText('Selected:');
    await dialog(page).getByRole('button', { name: 'Save record' }).click();
    await expect(
      toast(page, `Genotyping record saved (version ${String(index + 2)})`),
    ).toBeVisible();
  }

  // Protocol card: the newest is the latest, the first one is under "Other images".
  await expect.poll(() => loadedThumbs(page, '#protocols')).toBeGreaterThan(0);
  await expect(
    page.locator('#protocols summary').filter({ hasText: 'Other images (1)' }).first(),
  ).toBeAttached();
  // Timeline: each record carries its gel image.
  await expect.poll(() => loadedThumbs(page, '#activity')).toBeGreaterThan(0);
});

test('upload an image from the protocol card, open it in the lightbox with zoom, then remove it', async ({
  page,
}, testInfo) => {
  await actAs(page, 'Bob');
  const id = await createLine(page, unique(testInfo, 'ul'));
  await page.goto(`/lines/${id}`);
  await page
    .locator('#protocols input[type="file"][aria-label="Upload image"]')
    .first()
    .setInputFiles(GEL);
  await expect(toast(page, 'Image uploaded (version 2)')).toBeVisible();
  await expect(page.locator('#history .history-item').first()).toContainText(
    'Uploaded gel image for PCR.',
  );
  await expect.poll(() => loadedThumbs(page, '#protocols')).toBeGreaterThan(0);
  // The remove × sits in the top-right corner of its picture, for the latest image as for the others.
  const corner = await page
    .locator('#protocols .thumb-wrap:visible')
    .first()
    .evaluate((wrap) => {
      const picture = wrap.querySelector('img')?.getBoundingClientRect();
      const cross = wrap.querySelector('.thumb-remove')?.getBoundingClientRect();
      return picture === undefined || cross === undefined
        ? null
        : { right: picture.right - cross.right, top: cross.top - picture.top };
    });
  expect(corner).not.toBeNull();
  expect(corner?.right).toBeLessThan(12);
  expect(corner?.top).toBeLessThan(12);
  // Under the latest image the button now says "Upload another image" (and is easy to spot).
  await expect(
    page
      .locator('#protocols .image-upload')
      .getByRole('button', { name: 'Upload another image' })
      .first(),
  ).toBeAttached();

  await page.locator('#protocols .thumb-button:visible').first().click();
  const box = page.getByRole('dialog');
  await expect(box.locator('img')).toBeVisible();
  await box.getByRole('button', { name: 'Zoom in' }).click();
  await expect(box.locator('img')).toHaveCSS('max-width', 'none');
  await box.getByRole('button', { name: 'Fit to screen' }).click();
  await page.keyboard.press('Escape');
  await expect(box).toHaveCount(0);

  await page
    .locator('#protocols')
    .getByRole('button', { name: /^Remove image/ })
    .first()
    .click();
  await expect(toast(page, 'Image removed (version 3)')).toBeVisible();
  await expect(page.locator('#protocols')).toContainText('No image yet.');
});

test('AC3: an .exe and a file over 15 MB are refused with a helpful message; nothing is saved', async ({
  page,
}, testInfo) => {
  await actAs(page, 'Bob');
  const id = await createLine(page, unique(testInfo, 'ur'));
  await page.goto(`/lines/${id}`);
  const input = page.locator('#protocols input[type="file"][aria-label="Upload image"]').first();
  await input.setInputFiles('tests/fixtures/not-an-image.exe');
  await expect(toast(page, 'This file type is not accepted')).toBeVisible();
  await input.setInputFiles({
    name: 'huge.png',
    mimeType: 'image/png',
    buffer: Buffer.alloc(16 * 1024 * 1024),
  });
  await expect(toast(page, 'larger than 15 MB')).toBeVisible();
  await expect(page.locator('#history .history-item')).toHaveCount(1);
});

test('a HEIC photo is not uploaded from a browser that cannot open it (it would show as a broken image)', async ({
  page,
}, testInfo) => {
  await actAs(page, 'Bob');
  const id = await createLine(page, unique(testInfo, 'uh'));
  await page.goto(`/lines/${id}`);
  await page
    .locator('#protocols input[type="file"][aria-label="Upload image"]')
    .first()
    .setInputFiles({
      name: 'IMG_0001.HEIC',
      mimeType: 'image/heic',
      buffer: Buffer.from('\0\0\0\x18ftypheic\0\0\0\0heicmif1'),
    });
  await expect(toast(page, 'cannot open HEIC photos')).toBeVisible();
  await expect(page.locator('#history .history-item')).toHaveCount(1);
});

test('AC2: a PDF is attached as a reference and opens; links can be added, edited and removed', async ({
  page,
}, testInfo) => {
  await actAs(page, 'Bob');
  const id = await createLine(page, unique(testInfo, 'rf'));
  await page.goto(`/lines/${id}`);

  await page.locator('#refs').getByRole('button', { name: '+ Add reference' }).click();
  await dialog(page).getByLabel('Title', { exact: true }).fill('PCR protocol');
  await dialog(page).getByLabel('Choose file').setInputFiles('tests/fixtures/method.pdf');
  await dialog(page).getByRole('button', { name: 'Add reference' }).click();
  await expect(toast(page, 'Reference added (version 2)')).toBeVisible();
  const item = page.locator('#refs .reference-item').filter({ hasText: 'PCR protocol' });
  await expect(item.getByRole('link', { name: /Open/ })).toHaveAttribute(
    'href',
    /\/api\/attachments\/.+\/file/,
  );
  await expect(item.getByRole('link', { name: /Open/ })).toHaveAttribute('target', '_blank');

  // Needs a link or a file.
  await page.locator('#refs').getByRole('button', { name: '+ Add reference' }).click();
  await dialog(page).getByLabel('Title', { exact: true }).fill('ZFIN');
  await dialog(page).getByRole('button', { name: 'Add reference' }).click();
  await expect(dialog(page)).toContainText('Add a link or upload a file.');
  await dialog(page).getByLabel('Link (https://…)').fill('https://zfin.org/x');
  await dialog(page).getByRole('button', { name: 'Add reference' }).click();
  await expect(toast(page, 'Reference added (version 3)')).toBeVisible();

  // Edit and remove through the row menu.
  const zfin = page.locator('#refs .reference-item').filter({ hasText: 'ZFIN' });
  await zfin.locator('.row-menu summary').click();
  await page
    .locator('.row-menu__items:visible')
    .getByRole('button', { name: 'Edit', exact: true })
    .click();
  await dialog(page).getByLabel('Title', { exact: true }).fill('ZFIN page');
  await dialog(page).getByRole('button', { name: 'Save' }).click();
  await expect(toast(page, 'Reference updated (version 4)')).toBeVisible();
  await page
    .locator('#refs .reference-item')
    .filter({ hasText: 'ZFIN page' })
    .locator('.row-menu summary')
    .click();
  await page
    .locator('.row-menu__items:visible')
    .getByRole('button', { name: 'Remove', exact: true })
    .click();
  await dialog(page).getByRole('button', { name: 'Remove reference' }).click();
  await expect(toast(page, 'Reference removed (version 5)')).toBeVisible();
  await expect(page.locator('#refs')).not.toContainText('ZFIN page');
  await expect(page.locator('#history .history-item').first()).toContainText(
    'Removed reference: ZFIN page.',
  );
});

test('Guests see no upload or reference controls', async ({ page }, testInfo) => {
  await actAs(page, 'Bob');
  const id = await createLine(page, unique(testInfo, 'ug'));
  await actAs(page, 'Guest');
  await page.goto(`/lines/${id}`);
  await expect(page.locator('#protocols input[type="file"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '+ Add reference' })).toHaveCount(0);
});
