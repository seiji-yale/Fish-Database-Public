import { describe, expect, it } from 'vitest';
import fixture from '../tests/fixtures/lines.small.json';
import { loadFixture } from './db/fixtures';
import { listActivitiesByLine } from './db/queries/activities';
import { getLineByName } from './db/queries/lines';
import { listLineVersionsByLine } from './db/queries/lineVersions';
import { getUserByName } from './db/queries/users';
import { createMigratedDb } from './db/testing/testDb';
import { loadLineDocument } from './lib/lineWrite';
import { browser, signedInFetch, type ErrorBody } from './testBrowser';

interface CreatedBody {
  id: string;
  name: string;
  version: number;
  summary: string;
  warnings: Record<string, string>;
}

const minimal = { name: 'demo_c3-new', dob: '2026-01-05' };

describe('POST /api/lines (T-011, FR-NEW-01…03)', () => {
  it('creates a line from the minimal payload with defaults, version 1 and a created activity', async () => {
    const { db, call, actAs } = browser();
    const carol = await actAs('Carol');
    const response = await call('/api/lines', minimal);
    expect(response.status).toBe(201);
    const body = await response.json<CreatedBody>();
    expect(body).toMatchObject({ name: 'demo_c3-new', version: 1, summary: 'Line created.' });

    const document = await loadLineDocument(db, body.id);
    expect(document?.line).toMatchObject({
      name: 'demo_c3-new',
      status: 'Current',
      dob: '2026-01-05',
      generation_no: 1,
      ided_number: 0,
      last_id_date: null,
      breeding_started_at: null,
      current_protocol_id: null,
      version: 1,
      created_by: carol,
      updated_by: carol,
    });

    const versions = await listLineVersionsByLine(db, body.id);
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({
      version_no: 1,
      change_type: 'created',
      diff: null,
      via_admin: 0,
      created_by: carol,
    });
    expect(JSON.parse(versions[0]?.snapshot ?? '{}')).toMatchObject({
      line: { name: 'demo_c3-new', ided_number: 0 },
    });
    const activities = await listActivitiesByLine(db, body.id, 10);
    expect(activities).toHaveLength(1);
    expect(activities[0]).toMatchObject({
      type: 'created',
      user_id: carol,
      via_admin: 0,
      ref_type: 'line_version',
      ref_id: versions[0]?.id,
    });
  });

  it('creates a full line: phenotypes, attributes, PCR protocol with defaults, cryo record, references', async () => {
    const { db, call, actAs } = browser();
    await actAs('Bob');
    const response = await call('/api/lines', {
      name: '  demo_033 ',
      gene: 'ihxa',
      phenotypes: ['green heart', 'curly tail'],
      notes: 'From the 2026 cross',
      attributes: [{ key: 'Source', value: 'REPOSITORY A' }],
      dob: '2026-02-01',
      status: 'Breeding',
      idedNumber: 4,
      protocols: [
        {
          type: 'pcr',
          fields: {
            primer_f_name: 'F1',
            primer_f_seq: 'ACGT',
            primer_r_name: 'R1',
            primer_r_seq: 'TTGA',
          },
          notes: 'Use fresh Taq',
        },
        { type: 'tails' },
      ],
      cryo: {
        cryoDate: '2026-03-01',
        place: 'Demo freezer shelf',
        boxName: 'Demo cryo box-Bob',
        cryoIdStart: 'C0701',
        cryoIdEnd: 'C0707',
      },
      references: [
        { title: 'Paper', url: 'https://example.org/paper' },
        { title: 'Notebook page 4' },
      ],
    });
    expect(response.status).toBe(201);
    const body = await response.json<CreatedBody>();
    const document = await loadLineDocument(db, body.id);
    if (document === null) throw new Error('line missing');

    expect(document.line).toMatchObject({
      name: 'demo_033',
      status: 'Breeding',
      ided_number: 4,
      current_protocol_id: document.protocols[0]?.id,
    });
    expect(document.line.breeding_started_at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(document.phenotypes.map((row) => row.description)).toEqual([
      'green heart',
      'curly tail',
    ]);
    expect(document.attributes).toMatchObject([{ key: 'Source', value: 'REPOSITORY A' }]);
    expect(document.protocols.map((row) => [row.protocol_type, row.label])).toEqual([
      ['pcr', 'PCR'],
      ['tails', 'Tails'],
    ]);
    expect(JSON.parse(document.protocols[0]?.fields ?? '{}')).toEqual({
      primer_f_name: 'F1',
      primer_f_seq: 'ACGT',
      primer_r_name: 'R1',
      primer_r_seq: 'TTGA',
      annealing_c: 60,
      cycles: 35,
    });
    expect(document.cryoRecords).toMatchObject([
      {
        place: 'Demo freezer shelf',
        cryo_id_start: 'C0701',
        cryo_id_end: 'C0707',
        count: 7,
        details_unknown: 0,
      },
    ]);
    expect(document.references).toMatchObject([
      { title: 'Paper', url: 'https://example.org/paper', sort_order: 0 },
      { title: 'Notebook page 4', url: null, sort_order: 1 },
    ]);
    const snapshot = JSON.parse(
      (await listLineVersionsByLine(db, body.id))[0]?.snapshot ?? '{}',
    ) as {
      protocols: unknown[];
      cryoRecords: unknown[];
    };
    expect(snapshot.protocols).toHaveLength(2);
    expect(snapshot.cryoRecords).toHaveLength(1);
  });

  it('returns sequence warnings without blocking the save (FR-ID-08)', async () => {
    const { call, actAs } = browser();
    await actAs('Bob');
    const response = await call('/api/lines', {
      ...minimal,
      protocols: [{ type: 'pcr', fields: { primer_f_seq: 'ACGT-XX' } }],
    });
    expect(response.status).toBe(201);
    const body = await response.json<CreatedBody>();
    expect(Object.keys(body.warnings)).toEqual(['protocols.0.fields.primer_f_seq']);
  });

  it('refuses a duplicate name in any case with a hint that names the existing line (BR-8)', async () => {
    const { db, call, actAs } = browser();
    await loadFixture(db, fixture);
    await actAs('Bob');
    const existing = await getLineByName(db, 'demo_c3');
    const response = await call('/api/lines', { name: '  DEMO_C3  ', dob: '2026-01-05' });
    expect(response.status).toBe(409);
    const body = await response.json<ErrorBody>();
    expect(body.error.code).toBe('NAME_TAKEN');
    expect(body.error.message).toContain('"demo_c3"');
    expect(body.error.hint).toBeDefined();
    expect(body.error.details).toEqual({ existingId: existing?.id, existingName: 'demo_c3' });
    expect(await getLineByName(db, 'DEMO_C3')).toMatchObject({ id: existing?.id, version: 1 });
  });

  it('rejects a future DOB and other invalid input with per-field messages, writing nothing', async () => {
    const { db, call, actAs } = browser();
    await actAs('Bob');
    const response = await call('/api/lines', {
      name: '',
      dob: '2999-01-01',
      protocols: [{ type: 'pcr', fields: { annealing_c: 'hot' } }],
    });
    expect(response.status).toBe(400);
    const body = await response.json<ErrorBody>();
    expect(body.error.code).toBe('INVALID_INPUT');
    expect(body.error.details?.fields).toMatchObject({
      name: expect.stringContaining('Enter the line name') as string,
      dob: expect.stringContaining('future') as string,
    });
    expect(await getLineByName(db, '')).toBeNull();
    const { results } = await db.prepare('SELECT COUNT(*) AS n FROM lines').all<{ n: number }>();
    expect(results[0]?.n).toBe(0);
  });

  it('rejects a body that is not JSON or not an object', async () => {
    const { call, actAs } = browser();
    await actAs('Bob');
    const notJson = await (
      await signedInFetch({ DB: createMigratedDb(), SESSION_SIGNING_KEY: 'test-signing-key' })
    )('/api/lines', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });
    expect(notJson.status).toBe(400);
    const array = await call('/api/lines', [1, 2]);
    expect(array.status).toBe(400);
    expect((await array.json<ErrorBody>()).error.code).toBe('INVALID_INPUT');
  });

  it('refuses a visitor who has not signed in and a Guest (BR-5, ADR-0005)', async () => {
    const { db, call, actAs } = browser();
    const anonymous = await call('/api/lines', minimal);
    expect(anonymous.status).toBe(401);
    expect((await anonymous.json<ErrorBody>()).error.code).toBe('LOGIN_REQUIRED');
    await actAs('Guest');
    expect((await call('/api/lines', minimal)).status).toBe(403);
    expect(await getLineByName(db, 'demo_c3-new')).toBeNull();
  });

  it('records an Admin as the author of their own change (BR-5, ADR-0005)', async () => {
    const { db, call, actAs } = browser();
    const adminId = await actAs('Admin');
    const alice = await getUserByName(db, 'Alice');
    // A chosenUserId from an old client is ignored: the signed-in person is the author.
    const created = await call('/api/lines', { ...minimal, chosenUserId: alice?.id });
    expect(created.status).toBe(201);
    const body = await created.json<CreatedBody>();
    const [version] = await listLineVersionsByLine(db, body.id);
    expect(version).toMatchObject({ created_by: adminId, via_admin: 0 });
    const [activity] = await listActivitiesByLine(db, body.id, 1);
    expect(activity).toMatchObject({ user_id: adminId, via_admin: 0, type: 'created' });
  });

  it('answers two people saving the same name at once with one 201 and one 409, not a 500', async () => {
    const { db, call, actAs } = browser();
    await actAs('Bob');
    const [first, second] = await Promise.all([
      call('/api/lines', minimal),
      call('/api/lines', { ...minimal, name: 'DEMO_C3-NEW' }),
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
    const { results } = await db.prepare('SELECT COUNT(*) AS n FROM lines').all<{ n: number }>();
    expect(results[0]?.n).toBe(1);
  });

  it('shows the new line in the Line List (Active) right away', async () => {
    const { call, actAs } = browser();
    await actAs('Bob');
    await call('/api/lines', { ...minimal, protocols: [{ type: 'none' }] });
    const list = await (
      await call('/api/lines')
    ).json<{ items: { name: string; idMethod: string }[] }>();
    expect(list.items).toMatchObject([{ name: 'demo_c3-new', idMethod: 'None' }]);
  });
});

describe('GET /api/lines/check-name (FR-NEW-02, BR-8)', () => {
  it('says whether a name is free, ignoring case and surrounding spaces', async () => {
    const { db, call, actAs } = browser();
    await actAs('Guest');
    await loadFixture(db, fixture);
    const free = await call('/api/lines/check-name?name=brand-new');
    expect(await free.json()).toEqual({ available: true });
    const taken = await call(`/api/lines/check-name?name=${encodeURIComponent('  DEMO_C3 ')}`);
    expect(await taken.json()).toMatchObject({ available: false, existing: { name: 'demo_c3' } });
    expect(await (await call('/api/lines/check-name')).json()).toEqual({ available: true });
  });

  it('is not mistaken for a line id', async () => {
    const { call, actAs } = browser();
    await actAs('Guest');
    const response = await call('/api/lines/check-name?name=x');
    expect(response.status).toBe(200);
  });
});

describe('GET /api/enumerations', () => {
  it('lists the active values of one kind in display order', async () => {
    const { call, actAs } = browser();
    await actAs('Guest');
    const attributes = await (await call('/api/enumerations?kind=attribute_key')).json();
    expect(attributes).toEqual({ kind: 'attribute_key', values: ['Source'] });
    const fluorophores = await (
      await call('/api/enumerations?kind=fluorophore')
    ).json<{
      values: string[];
    }>();
    expect(fluorophores.values).toEqual(['GFP', 'mCherry', 'DsRed']);
  });

  it('rejects an unknown kind', async () => {
    const { call, actAs } = browser();
    await actAs('Guest');
    const response = await call('/api/enumerations?kind=nonsense');
    expect(response.status).toBe(400);
  });
});
