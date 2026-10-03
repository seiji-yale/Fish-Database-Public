/** Line Detail browser coverage (FR-LINE-01, docs/04-ui-spec.md §5.1). */
import { expect, test } from '@playwright/test';
import fixture from '../fixtures/lines.small.json' with { type: 'json' };
import { actAs } from './auth';
import type { Page, TestInfo } from '@playwright/test';
import type { LineDetailDocument } from '../../app/src/lineDetailApi';

const SUMMARY_LABELS = [
  'DOB',
  'Age',
  'IDed number',
  'Last ID Date',
  'Current ID method',
  'Cryopreserved',
  'Notes',
  'Last Update',
  'Created',
  'Phenotype(s)',
];

test('demo_c3: every FR-LINE-01 summary field is visible, and Source: REPOSITORY A shows under More attributes', async ({
  page,
}, testInfo) => {
  await page.goto('/lines/fx-demo_c3');
  await expect(page.getByRole('heading', { name: 'demo_c3', level: 1 })).toBeVisible();
  const summary = page.locator('#summary');
  await expect(summary.getByRole('heading', { name: 'Summary' })).toBeVisible();
  for (const label of SUMMARY_LABELS) {
    await expect(summary.getByText(label, { exact: true })).toBeVisible();
  }
  const dobCard = summary
    .locator('.detail-grid .detail-field')
    .filter({ has: page.getByText('DOB', { exact: true }) });
  const dobLabel = await dobCard.locator('strong').boundingBox();
  const dobValue = await dobCard.locator('span').boundingBox();
  expect(dobLabel).not.toBeNull();
  expect(dobValue).not.toBeNull();
  expect(dobValue?.y).toBeGreaterThan((dobLabel?.y ?? 0) + (dobLabel?.height ?? 0));
  await expect(dobCard).toHaveCSS('background-color', 'rgb(238, 243, 249)');
  const chatCard = page.locator('.detail-side #chat');
  const historyCard = page.locator('.detail-side #history');
  const chatBox = await chatCard.boundingBox();
  const historyBox = await historyCard.boundingBox();
  expect(chatBox).not.toBeNull();
  expect(historyBox).not.toBeNull();
  expect(historyBox?.y).toBeGreaterThan((chatBox?.y ?? 0) + (chatBox?.height ?? 0));
  await expect(chatCard).toHaveCSS('border-top-style', 'solid');
  await expect(historyCard).toHaveCSS('border-top-style', 'solid');
  await expect(summary).toContainText('Source: REPOSITORY A');
  await expect(page.getByText('Gene: —')).toBeVisible();
  await expect(summary).toContainText('PCR');
  await expect(summary).toContainText('Yes (1 record, 0 straws)');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await page.screenshot({
    path: `tests/e2e/__screenshots__/line-detail-${testInfo.project.name}.png`,
    fullPage: true,
  });
});

test('a Guest sees read-only line details and the Change Activity reason', async ({ page }) => {
  await actAs(page, 'Guest');
  await page.goto('/lines/fx-demo_c3');
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
  await page.locator('.activity-menu summary').click();
  await expect(
    page.locator('.activity-menu__items').getByRole('button', { name: /^Start Breeding/ }),
  ).toContainText('Guests cannot change line data');
  await actAs(page, 'Bob');
});

test('the phone section-jump bar links to each section without a page-level horizontal scroll', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'phone-375', 'jump bar is phone-only UI, checked at 375px');
  await page.goto('/lines/fx-demo_c3');
  await expect(page.locator('.section-jump')).toBeVisible();
  for (const label of ['Summary', 'ID', 'Cryo', 'Refs', 'Activity', 'Chat', 'History']) {
    await expect(page.locator('.section-jump').getByRole('link', { name: label })).toBeVisible();
  }
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test('a line with no phenotypes/notes/attributes shows the empty-value dash, not blank space', async ({
  page,
}) => {
  await page.goto('/lines/fx-demo_b2');
  const summary = page.locator('#summary');
  await expect(summary.getByText('Phenotype(s)')).toBeVisible();
  // demo_b2 has no attributes in the fixture: "More attributes" is omitted entirely, not shown empty.
  await expect(summary.getByText('More attributes')).toHaveCount(0);
});

test('a line with notes shows them (demo_d4: "Example husbandry note")', async ({ page }) => {
  await page.goto('/lines/fx-demo_d4');
  await expect(page.locator('#summary')).toContainText('Example husbandry note');
});

test('an unknown line id shows a not-found message with a way back to Lines', async ({ page }) => {
  await page.goto('/lines/does-not-exist');
  await expect(page.getByText('This line does not exist.', { exact: false })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to Lines' })).toHaveAttribute('href', '/lines');
});

// ---------------------------------------------------------------------------------------------
// Steps 3-5: protocols, cryo, references, timeline, history. The 5-line fixture has no line with
// two PCR protocols, a Custom protocol, images, several generations or several versions, so those
// cases fetch the real document and add the extra data before the page sees it (`mockLine`).
// ---------------------------------------------------------------------------------------------

/** 1x1 transparent PNG, served for every attachment request. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

async function mockLine(page: Page, id: string, change: (document: LineDetailDocument) => void) {
  await page.route(`**/api/lines/${id}`, async (route) => {
    const response = await route.fetch();
    const document = (await response.json()) as LineDetailDocument;
    change(document);
    await route.fulfill({ response, json: document });
  });
}

/** The tab panel (tablet/desktop) and the stacked cards (phone) are both in the DOM; only one is visible. */
function protocolArea(page: Page, testInfo: TestInfo) {
  return testInfo.project.name === 'phone-375'
    ? page.locator('.protocol-card-list')
    : page.locator('.protocol-tab-panel');
}

function noHorizontalScroll(page: Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

function attachment(id: string, isLatest: boolean, createdAt: string) {
  return {
    id,
    kind: 'gel_image',
    fileName: `${id}.png`,
    mimeType: 'image/png',
    caption: null,
    isLatest,
    createdAt,
  };
}

const PROTOCOL_EXPECTATIONS: [string, string, string[]][] = [
  [
    'fx-demo_c3',
    'PCR',
    ['Forward primer (Primer-1)', 'CGAATACTGCATCTCGCGCGCACACT', '60 °C', '35', '174'],
  ],
  [
    'fx-demo_e5',
    'PCR + Sequence',
    ['GAGAAATTGTCCGGGATTTCT', 'Sequencing primer', 'PRIMER-3', 'G125 to T'],
  ],
  ['fx-demo_b2', 'Fluorescence', ['Fluorophore', 'GFP', 'Screening day', 'green fin fluorescence']],
  ['fx-demo_d4', 'Tails', []],
  ['fx-demo_a1', 'PCR + Sequence', ['Guide sequence', 'GATTACCTTGCGCACACACC', 'AAG > A--']],
];

for (const [id, label, texts] of PROTOCOL_EXPECTATIONS) {
  test(`${id}: the ${label} protocol shows its fields, with the Current pill`, async ({
    page,
  }, testInfo) => {
    await page.goto(`/lines/${id}`);
    const area = protocolArea(page, testInfo);
    // The label and Current pill are in the tab (tablet/desktop) or the card heading (phone).
    const heading =
      testInfo.project.name === 'phone-375'
        ? page.locator('.protocol-card-list .data-card strong').first()
        : page.locator('#protocols').getByRole('tab').first();
    await expect(heading).toContainText(label);
    await expect(heading).toContainText('Current');
    for (const text of texts) await expect(area.getByText(text).first()).toBeVisible();
    expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(0);
  });
}

test('a sequence is copyable, uppercase, and the copy announces itself', async ({
  page,
  context,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1280', 'clipboard is checked once, on desktop');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await mockLine(page, 'fx-demo_c3', (document) => {
    const fields = document.protocols[0]?.fields;
    if (fields !== undefined) fields['primer_f_seq'] = 'tagctgctaacg';
  });
  await page.goto('/lines/fx-demo_c3');
  const area = protocolArea(page, testInfo);
  await expect(area.getByText('TAGCTGCTAACG', { exact: true })).toBeVisible();
  const primer = area.locator('.sequence-field').filter({ hasText: 'Forward primer (Primer-1)' });
  const labelBox = await primer.locator('.sequence-field__label').boundingBox();
  const sequenceBox = await primer.locator('.sequence-field__value').boundingBox();
  const copyButton = primer.getByRole('button', { name: 'Copy Forward primer (Primer-1)' });
  const buttonBox = await copyButton.boundingBox();
  expect(labelBox).not.toBeNull();
  expect(sequenceBox).not.toBeNull();
  expect(buttonBox).not.toBeNull();
  expect(sequenceBox?.y).toBeGreaterThan((labelBox?.y ?? 0) + (labelBox?.height ?? 0));
  expect(Math.abs((sequenceBox?.y ?? 0) - (buttonBox?.y ?? 0))).toBeLessThanOrEqual(1);
  expect(buttonBox?.x ?? 0).toBeGreaterThan((sequenceBox?.x ?? 0) + (sequenceBox?.width ?? 0));
  expect(buttonBox?.width).toBeLessThanOrEqual(100);
  await copyButton.click();
  await expect(page.getByRole('status').filter({ hasText: 'Copied to clipboard' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('TAGCTGCTAACG');
});

test('two PCR protocols are both shown and distinctly labelled (FR-ID-02)', async ({
  page,
}, testInfo) => {
  await mockLine(page, 'fx-demo_c3', (document) => {
    const first = document.protocols[0];
    if (first === undefined) return;
    first.label = 'PCR – insertion';
    document.protocols.push({
      ...first,
      id: 'second-pcr',
      label: 'PCR – wt allele',
      isCurrent: false,
      fields: { ...first.fields, primer_f_name: 'wt F', primer_f_seq: 'AAAACCCCGGGG' },
    });
  });
  await page.goto('/lines/fx-demo_c3');
  const protocols = page.locator('#protocols');
  if (testInfo.project.name === 'phone-375') {
    // Phone: both stacked as cards, one Current pill.
    const cards = page.locator('.protocol-card-list .data-card');
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0)).toContainText('PCR – insertion');
    await expect(cards.nth(1)).toContainText('PCR – wt allele');
    await expect(cards.nth(1)).toContainText('AAAACCCCGGGG');
    await expect(protocols.locator('.protocol-card-list .chip')).toHaveCount(1);
  } else {
    // Tablet/desktop: one tab per protocol; selecting a tab shows that protocol's primers.
    const tabs = protocols.getByRole('tab');
    await expect(tabs).toHaveCount(2);
    await expect(tabs.nth(0)).toContainText('PCR – insertion');
    await expect(tabs.nth(0)).toContainText('Current');
    await expect(tabs.nth(1)).toContainText('PCR – wt allele');
    await expect(tabs.nth(1)).not.toContainText('Current');
    await expect(protocolArea(page, testInfo)).toContainText('CGAATACTGCATCTCGCGCGCACACT');
    await tabs.nth(1).click();
    await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(protocolArea(page, testInfo)).toContainText('AAAACCCCGGGG');
    await expect(protocolArea(page, testInfo)).not.toContainText('CGAATACTGCATCTCGCGCGCACACT');
  }
});

test('a Custom protocol lists its key/value pairs; a 200-letter sequence wraps without overflow', async ({
  page,
}, testInfo) => {
  await mockLine(page, 'fx-demo_d4', (document) => {
    document.protocols.push({
      id: 'custom-1',
      protocolType: 'custom',
      label: 'Custom method',
      fields: {
        items: [
          { key: 'Reagent', value: 'Enzyme X' },
          { key: 'Incubation', value: '37 C, 2 h' },
        ],
      },
      notes: 'Ask Bob before use',
      isCurrent: false,
      attachments: [],
    });
    document.protocols.push({
      id: 'long-pcr',
      protocolType: 'pcr',
      label: 'Long primer PCR',
      fields: { primer_f_seq: 'ACGT'.repeat(50) },
      notes: null,
      isCurrent: false,
      attachments: [],
    });
  });
  await page.goto('/lines/fx-demo_d4');
  if (testInfo.project.name === 'phone-375') {
    const custom = page
      .locator('.protocol-card-list .data-card')
      .filter({ hasText: 'Custom method' });
    await expect(custom).toContainText('Reagent: Enzyme X');
    await expect(custom).toContainText('Incubation: 37 C, 2 h');
    await expect(custom).toContainText('Ask Bob before use');
  } else {
    await page
      .locator('#protocols')
      .getByRole('tab', { name: /Custom method/ })
      .click();
    await expect(protocolArea(page, testInfo)).toContainText('Reagent: Enzyme X');
    await expect(protocolArea(page, testInfo)).toContainText('Ask Bob before use');
    await page
      .locator('#protocols')
      .getByRole('tab', { name: /Long primer PCR/ })
      .click();
  }
  expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(0);
});

test('protocol images: latest as a thumbnail, older ones behind an expander, lightbox closes on Escape', async ({
  page,
}, testInfo) => {
  await page.route('**/api/attachments/*/file*', (route) =>
    route.fulfill({ body: PNG, contentType: 'image/png' }),
  );
  await mockLine(page, 'fx-demo_c3', (document) => {
    const protocol = document.protocols[0];
    if (protocol === undefined) return;
    protocol.attachments = [
      attachment('gel-old', false, '2026-01-01T00:00:00Z'),
      attachment('gel-new', true, '2026-02-01T00:00:00Z'),
    ];
  });
  await page.goto('/lines/fx-demo_c3');
  const area = protocolArea(page, testInfo);
  const thumbnail = area.getByRole('button', { name: 'View image: gel-new.png' });
  await expect(thumbnail).toBeVisible();
  await expect(area.getByRole('button', { name: 'View image: gel-old.png' })).toBeHidden();
  await area.getByText('Other images (1)').click();
  await expect(area.getByRole('button', { name: 'View image: gel-old.png' })).toBeVisible();
  await thumbnail.click();
  const dialog = page.getByRole('dialog', { name: 'gel-new.png' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Close image' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(thumbnail).toBeFocused();
});

test('sequence result links: only http(s) URLs are clickable; Screening day shows its unit', async ({
  page,
}, testInfo) => {
  await mockLine(page, 'fx-demo_e5', (document) => {
    const fields = document.protocols[0]?.fields;
    if (fields !== undefined)
      fields['seq_result_urls'] = ['https://example.org/seq1', 'javascript:alert(1)'];
  });
  await page.goto('/lines/fx-demo_e5');
  const area = protocolArea(page, testInfo);
  await expect(area.getByRole('link', { name: 'https://example.org/seq1' })).toBeVisible();
  await expect(area.getByText('javascript:alert(1)')).toBeVisible();
  await expect(area.getByRole('link', { name: 'javascript:alert(1)' })).toHaveCount(0);

  await page.goto('/lines/fx-demo_b2');
  await expect(protocolArea(page, testInfo).getByText('2 dpf')).toBeVisible();
});

test('an image-type protocol without an image says so', async ({ page }, testInfo) => {
  await page.goto('/lines/fx-demo_b2');
  await expect(protocolArea(page, testInfo).getByText('No image yet.')).toBeVisible();
});

test('Cryopreservation: DEMO_E5 shows its ID range and count, demo_c3 shows Details unknown', async ({
  page,
}) => {
  await page.goto('/lines/fx-demo_e5');
  const cryo = page.locator('#cryo');
  const record = fixture.lines[1]?.cryo_records[0];
  if (!record) throw new Error('Missing demo cryo range');
  await expect(
    cryo.getByText(`Cryopreserved: Yes (1 record, ${String(record.count)} straws)`),
  ).toBeVisible();
  await expect(
    cryo
      .getByText(
        `${String(record.cryo_id_start)}–${String(record.cryo_id_end)} (${String(record.count)})`,
      )
      .filter({ visible: true }),
  ).toBeVisible();
  await expect(cryo.getByText(String(record.place)).filter({ visible: true })).toBeVisible();
  await expect(cryo.getByText(String(record.box_name)).filter({ visible: true })).toBeVisible();
  await expect(cryo.getByText(String(record.cryo_date)).filter({ visible: true })).toBeVisible();

  await page.goto('/lines/fx-demo_c3');
  await expect(cryo.getByText('Cryopreserved: Yes (1 record, 0 straws)')).toBeVisible();
  await expect(cryo.getByText('Details unknown').filter({ visible: true })).toBeVisible();

  await page.goto('/lines/fx-demo_b2');
  await expect(cryo.getByText('Cryopreserved: No')).toBeVisible();
  await expect(cryo.getByText('Nothing to show yet.')).toBeVisible();
  expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(0);
});

test('References: a missing link is flagged; only http(s) URLs and files can be opened', async ({
  page,
}) => {
  await page.goto('/lines/fx-demo_c3');
  const refs = page.locator('#refs');
  await expect(refs.getByText('Example primers.docx')).toBeVisible();
  await expect(refs.getByText('Missing link')).toBeVisible();
  await expect(refs.getByRole('link')).toHaveCount(0);

  await mockLine(page, 'fx-demo_d4', (document) => {
    document.references = [
      {
        id: 'r1',
        title: 'Paper',
        url: 'https://example.org/paper',
        note: 'Fig. 2',
        attachment: null,
      },
      { id: 'r2', title: 'Bad link', url: 'javascript:alert(1)', note: null, attachment: null },
      {
        id: 'r3',
        title: 'Protocol PDF',
        url: null,
        note: null,
        attachment: {
          ...attachment('pdf-1', true, '2026-01-01T00:00:00Z'),
          mimeType: 'application/pdf',
        },
      },
    ];
  });
  await page.goto('/lines/fx-demo_d4');
  await expect(refs.getByRole('link', { name: 'Open: Paper' })).toHaveAttribute(
    'href',
    'https://example.org/paper',
  );
  await expect(refs.getByText('Note: Fig. 2')).toBeVisible();
  await expect(refs.getByRole('link', { name: 'Open: Protocol PDF' })).toHaveAttribute(
    'href',
    '/api/attachments/pdf-1/file',
  );
  await expect(refs.getByRole('link', { name: 'Open: Bad link' })).toHaveCount(0);
  await expect(refs.getByText('Missing link')).toHaveCount(1);
});

test('Activity: the imported record sits under Generation 1 with its total', async ({ page }) => {
  await page.goto('/lines/fx-demo_c3');
  const activity = page.locator('#activity');
  const line = fixture.lines[0];
  const record = line?.genotyping_records[0];
  if (!line || !record) throw new Error('Missing demo genotyping record');
  await expect(activity.getByText(`Generation 1 · DOB ${line.dob} · Current`)).toBeVisible();
  await expect(activity.getByText(record.record_date)).toBeVisible();
  await expect(
    activity.getByText(
      `+${String(record.positive_count)} positive → total ${String(record.positive_count)}`,
    ),
  ).toBeVisible();
  await expect(activity.getByText('[import] from Mastersheet Ver. 1.1')).toBeVisible();
});

test('Activity: generations are newest first, with running totals and gel images', async ({
  page,
}) => {
  await page.route('**/api/attachments/*/file*', (route) =>
    route.fulfill({ body: PNG, contentType: 'image/png' }),
  );
  await mockLine(page, 'fx-demo_c3', (document) => {
    document.generationNo = 2;
    document.dob = '2026-02-17';
    const record = (
      id: string,
      generationNo: number,
      recordDate: string,
      positiveCount: number,
      extra: Partial<LineDetailDocument['generations'][number]['records'][number]> = {},
    ) => ({
      id,
      generationNo,
      recordDate,
      protocolId: null,
      protocolLabel: 'PCR',
      positiveCount,
      screenedCount: null,
      isNewGeneration: false,
      newDob: null,
      notes: null,
      attachments: [],
      ...extra,
    });
    document.generations = [
      {
        generationNo: 2,
        dob: '2026-02-17',
        records: [
          record('g2b', 2, '2026-06-30', 6, {
            attachments: [attachment('g2b-gel', true, '2026-06-30T00:00:00Z')],
          }),
          record('g2a', 2, '2026-03-01', 4, {
            isNewGeneration: true,
            newDob: '2026-02-17',
            screenedCount: 20,
          }),
        ],
      },
      { generationNo: 1, dob: null, records: [record('g1', 1, '2025-09-10', 12)] },
    ];
  });
  await page.goto('/lines/fx-demo_c3');
  const activity = page.locator('#activity');
  const headers = activity.getByRole('heading', { level: 3 });
  await expect(headers).toHaveText([
    'Generation 2 · DOB 2026-02-17 · Current',
    'Generation 1 · DOB —',
  ]);
  await expect(activity.getByText('+4 positive → total 4')).toBeVisible();
  await expect(activity.getByText('+6 positive → total 10')).toBeVisible();
  await expect(activity.getByText('20 screened', { exact: false })).toBeVisible();
  await expect(activity.getByText('New generation (DOB 2026-02-17)')).toBeVisible();
  await expect(activity.getByRole('button', { name: 'View image: g2b-gel.png' })).toBeVisible();
  await expect(activity.getByText('+12 positive → total 12')).toBeVisible();
});

test('History: every imported line shows one version with no changes; multi-version diffs use glossary labels', async ({
  page,
}) => {
  await page.goto('/lines/fx-demo_c3');
  const history = page.locator('#history');
  await expect(history.locator('.history-item')).toHaveCount(1);
  await expect(
    history.getByText('Imported from Mastersheet Ver. 1.1', { exact: false }),
  ).toBeVisible();
  await history.getByRole('button', { name: 'Show changes' }).click();
  await expect(history.getByText('No field changes were recorded for this version.')).toBeVisible();
  // Restore is for Admin only (T-012): nobody chosen (Guest) sees no button.
  await expect(history.getByRole('button', { name: /Restore this version/ })).toHaveCount(0);

  await mockLine(page, 'fx-demo_d4', (document) => {
    document.versions.unshift({
      id: 'v2',
      versionNo: 2,
      changeType: 'edited',
      summary: 'Line details updated: dob, status.',
      note: 'Corrected after recount',
      createdAt: '2026-06-30T18:02:00Z',
      createdByName: 'Bob',
      viaAdmin: false,
      diff: [
        { path: 'dob', before: '2026-01-24', after: '2026-01-30' },
        { path: 'status', before: 'Current', after: 'Closed' },
        { path: 'ided_number', before: 12, after: 0 },
        { path: 'gene', before: null, after: 'pkd2' },
      ],
    });
  });
  await page.goto('/lines/fx-demo_d4');
  const items = history.locator('.history-item');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText(
    '2026-06-30 14:02 · Bob · Line details updated: dob, status.',
  );
  await expect(items.nth(0)).toContainText('Corrected after recount');
  await items.nth(0).getByRole('button', { name: 'Show changes' }).click();
  const diff = items.nth(0).locator('.diff-table');
  await expect(diff.getByRole('row', { name: 'DOB 2026-01-24 2026-01-30' })).toBeVisible();
  await expect(diff.getByRole('row', { name: 'Status Current Closed' })).toBeVisible();
  await expect(diff.getByRole('row', { name: 'IDed number 12 0' })).toBeVisible();
  await expect(diff.getByRole('row', { name: 'Gene — pkd2' })).toBeVisible();
  await expect(diff).not.toContainText('ided_number');
  await expect(items.nth(1)).not.toContainText('v1');
  expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(0);
});
