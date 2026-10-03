import { describe, expect, it } from 'vitest';
import fixture from '../tests/fixtures/lines.small.json';
import { loadFixture } from './db/fixtures';
import { softDeleteCryoRecord } from './db/queries/cryoRecords';
import { softDeleteLinePhenotype } from './db/queries/linePhenotypes';
import { softDeleteLineReference } from './db/queries/lineReferences';
import { createMigratedDb } from './db/testing/testDb';
import { guestFetch } from './testBrowser';
import type { Bindings } from './middleware/session';

async function setup() {
  const db = createMigratedDb();
  await loadFixture(db, fixture);
  const bindings = { DB: db, SESSION_SIGNING_KEY: 'test-signing-key' } satisfies Bindings;
  const get = await guestFetch(bindings);
  return { get, db };
}

interface LineListItemBody {
  id: string;
  name: string;
  status: string;
  idMethod: string;
  idedNumber: number;
  isCryopreserved: boolean;
  cryoSummary: string;
  references: { id: string; title: string }[];
}

interface LineListBody {
  view: string;
  total: number;
  items: LineListItemBody[];
}

describe('GET /api/lines (T-008, FR-LIST-01…03)', () => {
  it('defaults to the Active view: Current or Breeding, not Closed', async () => {
    const { get } = await setup();
    const response = await get('/api/lines');
    expect(response.status).toBe(200);
    const body = await response.json<LineListBody>();
    expect(body.view).toBe('active');
    expect(body.total).toBe(4);
    expect(body.items.map((item) => item.name).sort()).toEqual(
      ['demo_b2', 'demo_a1', 'demo_c3', 'demo_d4'].sort(),
    );
  });

  it('All adds Closed lines; Closed shows only Closed lines', async () => {
    const { get } = await setup();
    const all = await (await get('/api/lines?view=all')).json<LineListBody>();
    expect(all.total).toBe(5);
    const closed = await (await get('/api/lines?view=closed')).json<LineListBody>();
    expect(closed.total).toBe(1);
    expect(closed.items[0]?.name).toBe('DEMO_E5');
  });

  it('assembles the ID Method from the current protocol label (BR-10: no legacy vocabulary)', async () => {
    const { get } = await setup();
    const body = await (await get('/api/lines?view=all')).json<LineListBody>();
    const byName = Object.fromEntries(body.items.map((item) => [item.name, item]));
    expect(byName['demo_c3']?.idMethod).toBe('PCR');
    expect(byName['DEMO_E5']?.idMethod).toBe('PCR + Sequence');
    expect(byName['demo_b2']?.idMethod).toBe('Fluorescence');
    expect(byName['demo_d4']?.idMethod).toBe('Tails');
    const text = JSON.stringify(body);
    expect(text).not.toMatch(/\bGel\b/);
    expect(text).not.toMatch(/\bNONE\b/);
  });

  it('BR-6: cryopreserved is Yes for a record with unknown details, No with none', async () => {
    const { get } = await setup();
    const body = await (await get('/api/lines?view=all')).json<LineListBody>();
    const byName = Object.fromEntries(body.items.map((item) => [item.name, item]));
    expect(byName['demo_c3']).toMatchObject({
      isCryopreserved: true,
      cryoSummary: 'Details unknown',
    });
    expect(byName['demo_b2']).toMatchObject({ isCryopreserved: false, cryoSummary: '' });
  });

  it('excludes soft-deleted phenotypes, references and cryo records from every list row', async () => {
    const { get, db } = await setup();
    // Fixture-derived ids (worker/db/fixtures.ts: `${lineId}-<child>-<n>`).
    expect(
      await softDeleteLinePhenotype(db, 'fx-demo_d4-phenotype-1', '2026-09-29T00:00:00Z'),
    ).toBe(true);
    expect(
      await softDeleteLineReference(db, 'fx-demo_c3-reference-1', '2026-09-29T00:00:00Z'),
    ).toBe(true);
    expect(await softDeleteCryoRecord(db, 'fx-demo_c3-cryo-1', '2026-09-29T00:00:00Z')).toBe(true);
    const body = await (await get('/api/lines?view=all')).json<LineListBody>();
    const byName = Object.fromEntries(body.items.map((item) => [item.name, item]));
    expect(JSON.stringify(byName['demo_d4'])).not.toContain('Short Fins');
    expect(byName['demo_c3']?.references).toEqual([]);
    expect(byName['demo_c3']).toMatchObject({ isCryopreserved: false, cryoSummary: '' });
  });

  it('FR-GLB-05: search matches gene and phenotype', async () => {
    const { get } = await setup();
    const byGene = await (await get('/api/lines?view=all&q=demogene5')).json<LineListBody>();
    expect(byGene.items.map((item) => item.name)).toEqual(['demo_a1']);
    const byPhenotype = await (
      await get(`/api/lines?view=all&q=${encodeURIComponent('Short Fins')}`)
    ).json<LineListBody>();
    expect(byPhenotype.items.map((item) => item.name)).toEqual(['demo_d4']);
  });

  it('sorts by a requested column in the requested direction', async () => {
    const { get } = await setup();
    const expected = fixture.lines
      .filter((line) => line.status !== 'Closed')
      .map((line) => line.ided_number)
      .sort((left, right) => left - right);
    const desc = await (await get('/api/lines?sort=idedNumber&dir=desc')).json<LineListBody>();
    expect(desc.items.map((item) => item.idedNumber)).toEqual([...expected].reverse());
    const asc = await (await get('/api/lines?sort=idedNumber&dir=asc')).json<LineListBody>();
    expect(asc.items.map((item) => item.idedNumber)).toEqual(expected);
  });

  it('defaults to Status then Line name when no sort is given', async () => {
    const { get } = await setup();
    const body = await (await get('/api/lines')).json<LineListBody>();
    expect(body.items.map((item) => item.name)).toEqual([
      'demo_a1',
      'demo_b2',
      'demo_c3',
      'demo_d4',
    ]);
  });

  it('rejects an invalid view', async () => {
    const { get } = await setup();
    const response = await get('/api/lines?view=bogus');
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'INVALID_INPUT' } });
  });

  it('FR-LIST-03: filters to one ID Method', async () => {
    const { get } = await setup();
    const body = await (
      await get('/api/lines?view=all&idMethod=fluorescence')
    ).json<LineListBody>();
    expect(body.items.map((item) => item.name)).toEqual(['demo_b2']);
  });

  it('FR-LIST-03: filters by Cryopreserved', async () => {
    const { get } = await setup();
    const yes = await (await get('/api/lines?view=all&cryo=yes')).json<LineListBody>();
    expect(yes.items.map((item) => item.name).sort()).toEqual(
      ['DEMO_E5', 'demo_c3', 'demo_d4'].sort(),
    );
    const no = await (await get('/api/lines?view=all&cryo=no')).json<LineListBody>();
    expect(no.items.map((item) => item.name).sort()).toEqual(['demo_b2', 'demo_a1'].sort());
  });

  it('FR-LIST-03: combines a filter with search', async () => {
    const { get } = await setup();
    const body = await (await get('/api/lines?view=all&cryo=yes&q=demo_d4')).json<LineListBody>();
    expect(body.items.map((item) => item.name)).toEqual(['demo_d4']);
  });
});

describe('GET /api/lines.csv (T-008, FR-LIST-05)', () => {
  it('serves UTF-8 BOM CSV with the exact file name pattern', async () => {
    const { get } = await setup();
    const response = await get('/api/lines.csv?view=closed');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/csv');
    expect(response.headers.get('content-disposition')).toMatch(
      /^attachment; filename="fish-lines_closed_\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    // `Response#text()` decodes UTF-8 and silently drops a leading BOM (WHATWG TextDecoder), so
    // the BOM itself is checked on the raw bytes.
    const bytes = new Uint8Array(await response.clone().arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = await response.text();
    expect(text).toContain('DEMO_E5');
    expect(text).not.toMatch(/\bGel\b/);
  });

  it('exports the same row count as the equivalent JSON view', async () => {
    const { get } = await setup();
    const json = await (await get('/api/lines?view=all')).json<LineListBody>();
    const csvText = await (await get('/api/lines.csv?view=all')).text();
    const dataRows = csvText.trim().split('\r\n').length - 1;
    expect(dataRows).toBe(json.total);
  });

  it('T-008 Step 3 done-when: export respects the current filter, same row count as displayed', async () => {
    const { get } = await setup();
    const json = await (
      await get('/api/lines?view=all&idMethod=fluorescence')
    ).json<LineListBody>();
    expect(json.total).toBe(1);
    const csvText = await (await get('/api/lines.csv?view=all&idMethod=fluorescence')).text();
    const dataRows = csvText.trim().split('\r\n').length - 1;
    expect(dataRows).toBe(json.total);
    expect(csvText).toContain('demo_b2');
    expect(csvText).not.toContain('demo_c3');
  });
});
