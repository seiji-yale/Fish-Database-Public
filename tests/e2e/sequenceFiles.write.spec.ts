import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { actAs } from './auth';
import type { Page, TestInfo } from '@playwright/test';

/** T-038: .ab1 / .fasta / .seq files on ID protocols and references. */
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
const FILES = ['trace.ab1', 'read.fasta', 'read.seq'] as const;
const path = (name: string) => `tests/fixtures/${name}`;

async function downloaded(page: Page, link: ReturnType<Page['locator']>): Promise<Buffer> {
  const [download] = await Promise.all([page.waitForEvent('download'), link.click()]);
  const saved = await download.path();
  return readFileSync(saved);
}

async function noSideScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test('AC1: upload .ab1, .fasta and .seq to an ID protocol; each lists and downloads byte-identical; remove hides it', async ({
  page,
}, testInfo) => {
  await actAs(page, 'Bob');
  const id = await createLine(page, unique(testInfo, 'sq'));
  await page.goto(`/lines/${id}`);
  const area = page.locator('#protocols .sequence-files:visible').first();
  for (const [index, name] of FILES.entries()) {
    await page
      .locator('#protocols input[type="file"][aria-label^="Upload"][aria-label$="sequence file"]')
      .first()
      .setInputFiles(path(name));
    await expect(
      toast(page, `Sequence file uploaded (version ${String(index + 2)})`),
    ).toBeVisible();
    // The page reloads the line after an upload; the next one must use the new version.
    await expect(area.getByRole('link', { name: `Download ${name}` })).toBeVisible();
  }
  for (const name of FILES) {
    const link = area.getByRole('link', { name: `Download ${name}` });
    await expect(link).toBeVisible();
    expect(await downloaded(page, link)).toEqual(readFileSync(path(name)));
  }
  await expect(area).toContainText(/\(\d+ B\)/);
  await expect(page.locator('#history .history-item').first()).toContainText(
    'Uploaded sequence result for PCR.',
  );
  // Sequence files are not images: no thumbnail for them.
  await expect(page.locator('#protocols .thumb-button')).toHaveCount(0);
  await noSideScroll(page);

  await area.getByRole('button', { name: 'Remove trace.ab1' }).click();
  await expect(toast(page, 'Image removed')).toBeVisible();
  await expect(area.getByRole('link', { name: 'Download trace.ab1' })).toHaveCount(0);
  await expect(area.getByRole('link', { name: 'Download read.seq' })).toBeVisible();
  await page.reload();
  await expect(page.locator('#history .history-item').first()).toContainText(
    'Removed sequence result trace.ab1.',
  );
});

test('AC2: the same three types upload to a reference and download from the Line Detail page', async ({
  page,
}, testInfo) => {
  await actAs(page, 'Bob');
  const id = await createLine(page, unique(testInfo, 'sr'));
  await page.goto(`/lines/${id}`);
  for (const [index, name] of FILES.entries()) {
    await page.locator('#refs').getByRole('button', { name: '+ Add reference' }).click();
    await dialog(page).getByLabel('Title', { exact: true }).fill(`Seq ${name}`);
    await dialog(page).getByLabel('Choose file').setInputFiles(path(name));
    await dialog(page).getByRole('button', { name: 'Add reference' }).click();
    await expect(toast(page, `Reference added (version ${String(index + 2)})`)).toBeVisible();
  }
  for (const name of FILES) {
    const item = page.locator('#refs .reference-item').filter({ hasText: `Seq ${name}` });
    const response = await page.request.get(
      (await item.getByRole('link', { name: /Download/ }).getAttribute('href')) ?? '',
    );
    expect(response.headers()['content-disposition']).toBe('attachment');
    expect(Buffer.from(await response.body())).toEqual(readFileSync(path(name)));
  }
  await noSideScroll(page);
});

test('AC3: a renamed text file, a renamed binary and a 16 MB file are refused with a clear message', async ({
  page,
}, testInfo) => {
  await actAs(page, 'Bob');
  const id = await createLine(page, unique(testInfo, 'sx'));
  await page.goto(`/lines/${id}`);
  const input = page
    .locator('#protocols input[type="file"][aria-label^="Upload"][aria-label$="sequence file"]')
    .first();
  const mismatch = 'The file content does not match its type';
  const cases = [
    { name: 'x.ab1', buffer: Buffer.from('>not a trace\nACGT\n'), message: mismatch },
    { name: 'x.fasta', buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]), message: mismatch },
    { name: 'big.ab1', buffer: Buffer.alloc(16 * 1024 * 1024, 1), message: 'larger than 15 MB' },
    {
      name: 'gel.png',
      buffer: readFileSync('tests/fixtures/gel.png'),
      message: 'Choose a sequence file',
    },
  ];
  for (const { name, buffer, message } of cases) {
    await input.setInputFiles({ name, mimeType: '', buffer });
    await expect(toast(page, message)).toBeVisible();
    await page
      .getByRole('button', { name: 'Dismiss' })
      .first()
      .click()
      .catch(() => undefined);
  }
  await page.reload();
  await expect(page.locator('#protocols .sequence-files a')).toHaveCount(0);
});

test('several files at once: sequence files on a protocol, one reference per file, the file name as title', async ({
  page,
}, testInfo) => {
  await actAs(page, 'Bob');
  const id = await createLine(page, unique(testInfo, 'sm'));
  await page.goto(`/lines/${id}`);

  // Protocol: three sequence files in one choice; a PNG in the same choice is refused by name.
  const area = page.locator('#protocols .sequence-files:visible').first();
  await page
    .locator('#protocols input[type="file"][aria-label^="Upload"][aria-label$="sequence file"]')
    .first()
    .setInputFiles([...FILES.map(path), 'tests/fixtures/gel.png']);
  await expect(toast(page, '3 files uploaded (version 4)')).toBeVisible();
  await expect(toast(page, 'gel.png: Choose a sequence file')).toBeVisible();
  for (const name of FILES)
    await expect(area.getByRole('link', { name: `Download ${name}` })).toBeVisible();

  // Reference: one file fills the title with the file name, the list shows it under the title.
  await page.locator('#refs').getByRole('button', { name: '+ Add reference' }).click();
  await dialog(page).getByLabel('Choose file').setInputFiles(path('trace.ab1'));
  await expect(dialog(page).getByLabel('Title', { exact: true })).toHaveValue('trace.ab1');
  await dialog(page).getByLabel('Title', { exact: true }).fill('Sanger run 1');
  await dialog(page).getByRole('button', { name: 'Add reference' }).click();
  await expect(toast(page, 'Reference added (version 5)')).toBeVisible();
  const titled = page.locator('#refs .reference-item').filter({ hasText: 'Sanger run 1' });
  await expect(titled).toContainText('trace.ab1');
  await expect(titled.getByRole('link', { name: /^Download/ })).toBeVisible();

  // Reference: several files make one reference each.
  await page.locator('#refs').getByRole('button', { name: '+ Add reference' }).click();
  await dialog(page).getByLabel('Choose file').setInputFiles(FILES.map(path));
  await expect(dialog(page)).toContainText('Each of the 3 files becomes its own reference');
  await dialog(page).getByRole('button', { name: 'Add reference' }).click();
  await expect(toast(page, '3 references added (version 8)')).toBeVisible();
  for (const name of FILES)
    await expect(
      page.locator('#refs .reference-item').filter({ hasText: name }).first(),
    ).toBeVisible();
  await noSideScroll(page);

  // A link reference still says Open.
  await page.locator('#refs').getByRole('button', { name: '+ Add reference' }).click();
  await dialog(page).getByLabel('Title', { exact: true }).fill('ZFIN page');
  await dialog(page).getByLabel('Link (https://…)').fill('https://zfin.org');
  await dialog(page).getByRole('button', { name: 'Add reference' }).click();
  await expect(
    page
      .locator('#refs .reference-item')
      .filter({ hasText: 'ZFIN page' })
      .getByRole('link', { name: /^Open/ }),
  ).toBeVisible();
});
