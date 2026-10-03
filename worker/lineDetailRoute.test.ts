import { describe, expect, it } from 'vitest';
import fixture from '../tests/fixtures/lines.small.json';
import { insertChatMessage } from './db/queries/chatMessages';
import { softDeleteCryoRecord } from './db/queries/cryoRecords';
import { loadFixture } from './db/fixtures';
import { softDeleteLinePhenotype } from './db/queries/linePhenotypes';
import { softDeleteLineReference } from './db/queries/lineReferences';
import { createMigratedDb } from './db/testing/testDb';
import { USER_ID } from './db/testing/builders';
import { guestFetch } from './testBrowser';
import type { Bindings } from './middleware/session';
import type { LineDetailDocument } from './lib/lineDetail';

async function setup() {
  const db = createMigratedDb();
  await loadFixture(db, fixture);
  const bindings = { DB: db, SESSION_SIGNING_KEY: 'test-signing-key' } satisfies Bindings;
  const get = await guestFetch(bindings);
  return { get };
}

describe('GET /api/lines/:id (T-009, FR-LINE-01, FR-ID-01/02, FR-CRYO-01/02, FR-REF-01)', () => {
  it('404s for an unknown id', async () => {
    const { get } = await setup();
    const response = await get('/api/lines/does-not-exist');
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: 'LINE_NOT_FOUND' } });
  });

  it('sets an ETag from the line version', async () => {
    const { get } = await setup();
    const response = await get('/api/lines/fx-demo_c3');
    expect(response.headers.get('etag')).toBe('1');
  });

  it('demo_c3: PCR protocol, one cryo record with unknown details, one reference, imported version', async () => {
    const { get } = await setup();
    const response = await get('/api/lines/fx-demo_c3');
    expect(response.status).toBe(200);
    const doc = await response.json<LineDetailDocument>();
    expect(doc.name).toBe('demo_c3');
    expect(doc.protocols).toHaveLength(1);
    expect(doc.protocols[0]).toMatchObject({ protocolType: 'pcr', label: 'PCR', isCurrent: true });
    expect(doc.protocols[0]?.fields).toMatchObject({ annealing_c: 60, cycles: 35 });
    expect(doc.cryoRecords).toHaveLength(1);
    expect(doc.cryoRecords[0]).toMatchObject({ detailsUnknown: true });
    expect(doc.isCryopreserved).toBe(true);
    expect(doc.references).toHaveLength(1);
    expect(doc.references[0]).toMatchObject({ title: 'Example primers.docx' });
    expect(doc.versions).toHaveLength(1);
    expect(doc.versions[0]).toMatchObject({ changeType: 'imported', versionNo: 1 });
  });

  it('DEMO_E5: PCR + Sequence protocol, cryo with a known ID range, Closed status', async () => {
    const { get } = await setup();
    const doc = await (await get('/api/lines/fx-demo_e5')).json<LineDetailDocument>();
    expect(doc.status).toBe('Closed');
    expect(doc.protocols[0]).toMatchObject({
      protocolType: 'pcr_sequence',
      label: 'PCR + Sequence',
    });
    expect(doc.protocols[0]?.fields).toMatchObject({ seq_primer: 'PRIMER-3' });
    expect(doc.cryoRecords[0]).toMatchObject({
      detailsUnknown: false,
      cryoIdStart: 'C0605',
      cryoIdEnd: 'C0610',
      count: fixture.lines[1]?.cryo_records[0]?.count,
    });
  });

  it('demo_b2: Fluorescence protocol, no cryo records', async () => {
    const { get } = await setup();
    const doc = await (await get('/api/lines/fx-demo_b2')).json<LineDetailDocument>();
    expect(doc.protocols[0]).toMatchObject({ protocolType: 'fluorescence', label: 'Fluorescence' });
    expect(doc.protocols[0]?.fields).toMatchObject({ fluorophore: 'GFP' });
    expect(doc.cryoRecords).toHaveLength(0);
    expect(doc.isCryopreserved).toBe(false);
  });

  it('demo_d4: Tails protocol and free-text notes', async () => {
    const { get } = await setup();
    const doc = await (await get('/api/lines/fx-demo_d4')).json<LineDetailDocument>();
    expect(doc.protocols[0]).toMatchObject({ protocolType: 'tails', label: 'Tails' });
    expect(doc.notes).toBe('Example husbandry note');
  });

  it('demo_a1: PCR + Sequence with a guide sequence and mutation, gene set', async () => {
    const { get } = await setup();
    const doc = await (await get('/api/lines/fx-demo_a1')).json<LineDetailDocument>();
    expect(doc.gene).toBe('demogene5');
    expect(doc.protocols[0]?.fields).toMatchObject({
      guide_seq: 'GATTACCTTGCGCACACACC',
      expected_mutation: 'AAG > A--',
    });
    expect(doc.notes).toBe('[import] allele note: 3 bp insertion');
  });

  it('excludes a soft-deleted phenotype', async () => {
    // demo_d4 has a phenotype ("Short Fins") in the fixture; soft-delete it via the same mechanism
    // the app uses, then confirm the detail document no longer lists it.
    const db = createMigratedDb();
    await loadFixture(db, fixture);
    await softDeleteLinePhenotype(db, 'fx-demo_d4-phenotype-1', '2026-09-29T00:00:00Z');
    const bindings = { DB: db, SESSION_SIGNING_KEY: 'test-signing-key' } satisfies Bindings;
    const response = await (await guestFetch(bindings))('/api/lines/fx-demo_d4');
    const doc = await response.json<LineDetailDocument>();
    expect(doc.phenotypes).toEqual([]);
  });

  it('excludes a soft-deleted reference and cryo record', async () => {
    // demo_c3 has one reference and one cryo record in the fixture (fixture-derived ids, see
    // worker/db/fixtures.ts: `${lineId}-<child>-<n>`).
    const db = createMigratedDb();
    await loadFixture(db, fixture);
    await softDeleteLineReference(db, 'fx-demo_c3-reference-1', '2026-09-29T00:00:00Z');
    await softDeleteCryoRecord(db, 'fx-demo_c3-cryo-1', '2026-09-29T00:00:00Z');
    const bindings = { DB: db, SESSION_SIGNING_KEY: 'test-signing-key' } satisfies Bindings;
    const response = await (await guestFetch(bindings))('/api/lines/fx-demo_c3');
    const doc = await response.json<LineDetailDocument>();
    expect(doc.references).toEqual([]);
    expect(doc.cryoRecords).toEqual([]);
    expect(doc.isCryopreserved).toBe(false);
  });

  it('BR-4: Last Update reflects a chat message posted after the line was last edited', async () => {
    const db = createMigratedDb();
    await loadFixture(db, fixture);
    await insertChatMessage(db, {
      id: 'msg-1',
      line_id: 'fx-demo_c3',
      user_id: USER_ID.dan,
      via_admin: 0,
      body: 'Please set up an out-cross',
      request_type: null,
      request_status: null,
      request_done_by: null,
      request_done_at: null,
      edited_at: null,
      deleted_at: null,
      created_at: '2026-09-29T00:00:00Z',
    });
    const bindings = { DB: db, SESSION_SIGNING_KEY: 'test-signing-key' } satisfies Bindings;
    const response = await (await guestFetch(bindings))('/api/lines/fx-demo_c3');
    const doc = await response.json<LineDetailDocument>();
    expect(doc.updatedAt).toBe('2026-09-29T00:00:00Z');
    expect(doc.updatedByName).toBe('Dan');
  });
});

describe('GET /api/lines/:id.csv (T-019, FR-EXP-02)', () => {
  it('exports a line row and one row for each protocol, cryo, genotyping, and reference record', async () => {
    const { get } = await setup();
    const response = await get('/api/lines/fx-demo_c3.csv');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/csv');
    expect(response.headers.get('content-disposition')).toMatch(
      /^attachment; filename="fish-line_demo_c3_\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const csv = new TextDecoder('utf-8').decode(bytes.slice(3));
    expect(csv.match(/^line,/gm)).toHaveLength(1);
    expect(csv.match(/^protocol,/gm)).toHaveLength(1);
    expect(csv.match(/^cryo,/gm)).toHaveLength(1);
    expect(csv.match(/^genotyping,/gm)).toHaveLength(1);
    expect(csv.match(/^reference,/gm)).toHaveLength(1);
    expect(csv).toContain('CGAATACTGCATCTCGCGCGCACACT');
    expect(csv).toContain('Example primers.docx');
  });

  it('includes DEMO_E5 sequence protocol and cryo range', async () => {
    const { get } = await setup();
    const csv = await (await get('/api/lines/fx-demo_e5.csv')).text();
    expect(csv).toContain('PRIMER-3');
    expect(csv).toContain('G125 to T');
    expect(csv).toContain('C0605–C0610');
  });
});
