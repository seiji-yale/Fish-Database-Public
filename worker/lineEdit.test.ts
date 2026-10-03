import { describe, expect, it } from 'vitest';
import fixture from '../tests/fixtures/lines.small.json';
import { loadFixture } from './db/fixtures';
import { listActivitiesByLine } from './db/queries/activities';
import { getLineByName } from './db/queries/lines';
import { listLineVersionsByLine } from './db/queries/lineVersions';
import { listLineAttributesByLine } from './db/queries/lineAttributes';
import { listLinePhenotypesByLine } from './db/queries/linePhenotypes';
import { loadLineDocument } from './lib/lineWrite';
import { browser, type ErrorBody, TEST_ADMIN } from './testBrowser';

interface EditBody {
  id: string;
  version: number;
  summary: string;
  unchanged: boolean;
}

async function setup(actor = 'Bob') {
  const b = browser();
  await loadFixture(b.db, fixture);
  await b.actAs(actor);
  const line = await getLineByName(b.db, 'demo_c3');
  if (line === null) throw new Error('fixture line missing');
  return { ...b, line, path: `/api/lines/${line.id}` };
}

describe('PATCH /api/lines/:id (T-012, FR-LINE-02)', () => {
  it('edits the gene: version n+1, diff [gene: a → b] without bookkeeping fields, one activity', async () => {
    const { db, call, line, path, idOf } = await setup();
    const response = await call(
      path,
      { expectedVersion: 1, gene: 'demo_c3-gene', note: 'Fixed' },
      'PATCH',
    );
    expect(response.status).toBe(200);
    expect(await response.json<EditBody>()).toMatchObject({
      version: 2,
      summary: 'Line details updated: gene.',
      unchanged: false,
    });
    const [latest] = await listLineVersionsByLine(db, line.id);
    expect(latest).toMatchObject({
      version_no: 2,
      change_type: 'edited',
      note: 'Fixed',
      via_admin: 0,
      created_by: await idOf('Bob'),
    });
    expect(JSON.parse(latest?.diff ?? '[]')).toEqual([
      { path: 'line.gene', before: null, after: 'demo_c3-gene' },
    ]);
    const activities = await listActivitiesByLine(db, line.id, 5);
    expect(activities.map((a) => a.type)).toEqual(['edited', 'imported']);
  });

  it('edits several fields at once and clears text with blank', async () => {
    const { db, call, line, path } = await setup();
    await call(path, { expectedVersion: 1, gene: 'g1', notes: 'n1', dob: '2026-02-03' }, 'PATCH');
    const response = await call(path, { expectedVersion: 2, gene: '', notes: null }, 'PATCH');
    expect((await response.json<EditBody>()).version).toBe(3);
    expect((await getLineByName(db, 'demo_c3'))?.gene).toBeNull();
    expect((await getLineByName(db, 'demo_c3'))?.notes).toBeNull();
    expect((await getLineByName(db, 'demo_c3'))?.dob).toBe('2026-02-03');
    expect(line.version).toBe(1);
  });

  it('rejects a stale expectedVersion with the BR-12 payload (two tabs)', async () => {
    const { call, path } = await setup();
    await call(path, { expectedVersion: 1, gene: 'first tab' }, 'PATCH');
    const stale = await call(path, { expectedVersion: 1, gene: 'second tab' }, 'PATCH');
    expect(stale.status).toBe(409);
    const body = await stale.json<ErrorBody>();
    expect(body.error.code).toBe('VERSION_CONFLICT');
    expect(body.error.message).toMatch(/was changed by Bob at .* — reload/);
    expect(body.error.details).toMatchObject({ changedBy: 'Bob', currentVersion: 2 });
  });

  it('refuses a rename to another line’s name (any case) but allows changing only the case of its own', async () => {
    const { db, call, path } = await setup();
    const taken = await call(path, { expectedVersion: 1, name: ' DEMO_D4 ' }, 'PATCH');
    expect(taken.status).toBe(409);
    expect((await taken.json<ErrorBody>()).error.code).toBe('NAME_TAKEN');
    expect((await getLineByName(db, 'demo_c3'))?.version).toBe(1);
    const own = await call(path, { expectedVersion: 1, name: 'DEMO_C3' }, 'PATCH');
    expect(own.status).toBe(200);
    expect((await getLineByName(db, 'demo_c3'))?.name).toBe('DEMO_C3');
  });

  it('edits phenotypes: unchanged text keeps its row, removed rows are hidden not deleted', async () => {
    const { db, call, line, path } = await setup();
    await call(path, { expectedVersion: 1, phenotypes: ['a', 'b', 'c'] }, 'PATCH');
    const before = await listLinePhenotypesByLine(db, line.id);
    const keep = 'b';
    await call(path, { expectedVersion: 2, phenotypes: [keep, 'brand new'] }, 'PATCH');
    const live = await listLinePhenotypesByLine(db, line.id);
    expect(live.map((row) => row.description)).toEqual([keep, 'brand new']);
    expect(live[0]?.id).toBe(before[1]?.id);
    const all = await listLinePhenotypesByLine(db, line.id, { includeDeleted: true });
    expect(all).toHaveLength(4);
    expect(all.filter((row) => row.deleted_at !== null)).toHaveLength(2);
    const [latest] = await listLineVersionsByLine(db, line.id);
    const diff = JSON.parse(latest?.diff ?? '[]') as { path: string }[];
    expect(diff[0]).toMatchObject({ path: 'phenotypes' });
  });

  it('adds, edits and removes More attributes (soft)', async () => {
    const { db, call, line, path } = await setup();
    await call(
      path,
      {
        expectedVersion: 1,
        attributes: [
          { key: 'Source', value: 'REPOSITORY A 2' },
          { key: 'Box', value: '7' },
        ],
      },
      'PATCH',
    );
    expect(
      (await listLineAttributesByLine(db, line.id)).map((row) => [row.key, row.value]),
    ).toEqual([
      ['Source', 'REPOSITORY A 2'],
      ['Box', '7'],
    ]);
    await call(path, { expectedVersion: 2, attributes: [] }, 'PATCH');
    expect(await listLineAttributesByLine(db, line.id)).toEqual([]);
    const hidden = await listLineAttributesByLine(db, line.id, { includeDeleted: true });
    expect(hidden.length).toBe(2);
    expect(hidden.every((row) => row.deleted_at !== null)).toBe(true);
  });

  it('writes nothing when nothing changed', async () => {
    const { db, call, line, path } = await setup();
    const response = await call(path, { expectedVersion: 1, name: 'demo_c3', gene: null }, 'PATCH');
    expect(await response.json<EditBody>()).toMatchObject({ unchanged: true, version: 1 });
    expect(await listLineVersionsByLine(db, line.id)).toHaveLength(1);
  });

  it('validates input per field and writes nothing', async () => {
    const { db, call, line, path } = await setup();
    const response = await call(path, { expectedVersion: 1, name: '', dob: '2999-01-01' }, 'PATCH');
    expect(response.status).toBe(400);
    const body = await response.json<ErrorBody>();
    expect(body.error.details?.fields).toMatchObject({
      name: expect.stringContaining('Enter the line name') as string,
      dob: expect.stringContaining('future') as string,
    });
    expect((await call(path, ['x'], 'PATCH')).status).toBe(400);
    expect(await listLineVersionsByLine(db, line.id)).toHaveLength(1);
  });

  it('is 404 for an unknown line', async () => {
    const { call } = await setup();
    const response = await call('/api/lines/nope', { expectedVersion: 1, gene: 'x' }, 'PATCH');
    expect(response.status).toBe(404);
    expect((await response.json<ErrorBody>()).error.code).toBe('LINE_NOT_FOUND');
  });

  it('forbids Guest; records an Admin as the author of their own edit (ADR-0005)', async () => {
    const guest = await setup('Guest');
    expect((await guest.call(guest.path, { expectedVersion: 1, gene: 'x' }, 'PATCH')).status).toBe(
      403,
    );

    const admin = await setup('Admin');
    const done = await admin.call(admin.path, { expectedVersion: 1, gene: 'x' }, 'PATCH');
    expect(done.status).toBe(200);
    const [latest] = await listLineVersionsByLine(admin.db, admin.line.id);
    expect(latest).toMatchObject({ created_by: await admin.idOf(TEST_ADMIN), via_admin: 0 });
  });

  it('answers two people renaming to the same name at once with one success and one 409', async () => {
    const { db, call, path } = await setup();
    const other = await getLineByName(db, 'demo_d4');
    const [a, b] = await Promise.all([
      call(path, { expectedVersion: 1, name: 'shared-name' }, 'PATCH'),
      call(`/api/lines/${other?.id ?? ''}`, { expectedVersion: 1, name: 'Shared-Name' }, 'PATCH'),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
  });
});

describe('POST /api/lines/:id/restore/:versionNo (T-012, FR-HIST-02, NFR-09)', () => {
  it('restores v1 after two edits as a new version 4; nothing is overwritten', async () => {
    const b = browser();
    await b.actAs('Bob');
    const created = await (
      await b.call('/api/lines', {
        name: 'restore-me',
        gene: 'g0',
        notes: 'first notes',
        dob: '2026-01-05',
        phenotypes: ['p1', 'p2'],
        attributes: [{ key: 'Source', value: 'REPOSITORY A' }],
      })
    ).json<{ id: string }>();
    const path = `/api/lines/${created.id}`;
    await b.call(path, { expectedVersion: 1, gene: 'g1', phenotypes: ['p1'] }, 'PATCH');
    await b.call(
      path,
      { expectedVersion: 2, name: 'renamed', notes: null, attributes: [] },
      'PATCH',
    );

    const adminId = await b.actAs('Admin');
    const response = await b.call(`${path}/restore/1`, { expectedVersion: 3 });
    expect(response.status).toBe(200);
    expect(await response.json<EditBody>()).toMatchObject({
      version: 4,
      summary: 'Restored the content of version 1.',
    });

    const document = await loadLineDocument(b.db, created.id);
    expect(document?.line).toMatchObject({
      name: 'restore-me',
      gene: 'g0',
      notes: 'first notes',
      dob: '2026-01-05',
      version: 4,
    });
    expect(document?.phenotypes.map((row) => row.description)).toEqual(['p1', 'p2']);
    expect(document?.attributes.map((row) => [row.key, row.value])).toEqual([
      ['Source', 'REPOSITORY A'],
    ]);

    const versions = await listLineVersionsByLine(b.db, created.id);
    expect(versions.map((v) => [v.version_no, v.change_type])).toEqual([
      [4, 'restored'],
      [3, 'edited'],
      [2, 'edited'],
      [1, 'created'],
    ]);
    expect(versions[0]).toMatchObject({
      created_by: adminId,
      via_admin: 0,
      note: 'Restored from version 1.',
    });
    const activities = await listActivitiesByLine(b.db, created.id, 10);
    expect(activities[0]).toMatchObject({ type: 'restored', user_id: adminId, via_admin: 0 });
  });

  it('restores the descriptive content of an imported version 1 (flat snapshot shape)', async () => {
    const { db, call, line, path, actAs, idOf } = await setup();
    await call(path, { expectedVersion: 1, gene: 'changed', attributes: [] }, 'PATCH');
    await actAs('Admin');
    const response = await call(`${path}/restore/1`, {
      expectedVersion: 2,
      chosenUserId: await idOf('Bob'),
    });
    expect(response.status).toBe(200);
    const document = await loadLineDocument(db, line.id);
    expect(document?.line.gene).toBe(line.gene);
    expect(document?.attributes.map((row) => row.key)).toEqual(['Source']);
  });

  it('is Admin only: a Member gets 403 ADMIN_ONLY and nothing changes', async () => {
    const { db, call, line, path } = await setup('Bob');
    await call(path, { expectedVersion: 1, gene: 'x' }, 'PATCH');
    const response = await call(`${path}/restore/1`, { expectedVersion: 2 });
    expect(response.status).toBe(403);
    expect((await response.json<ErrorBody>()).error.code).toBe('ADMIN_ONLY');
    expect(await listLineVersionsByLine(db, line.id)).toHaveLength(2);
  });

  it('reports an unknown version (404), a stale expectedVersion (409) and a bad body (400)', async () => {
    const { call, path, idOf } = await setup('Admin');
    const chosenUserId = await idOf('Bob');
    const missing = await call(`${path}/restore/9`, { expectedVersion: 1, chosenUserId });
    expect(missing.status).toBe(404);
    expect((await missing.json<ErrorBody>()).error.code).toBe('VERSION_NOT_FOUND');
    const oddNumber = await call(`${path}/restore/abc`, { expectedVersion: 1, chosenUserId });
    expect(oddNumber.status).toBe(404);
    const stale = await call(`${path}/restore/1`, { expectedVersion: 5, chosenUserId });
    expect(stale.status).toBe(409);
    expect((await stale.json<ErrorBody>()).error.code).toBe('VERSION_CONFLICT');
    expect((await call(`${path}/restore/1`, { chosenUserId })).status).toBe(400);
    expect((await call(`${path}/restore/1`, 'nope')).status).toBe(400);
  });

  it('writes nothing when the content already matches the version', async () => {
    const { db, call, line, path, actAs, idOf } = await setup();
    await actAs('Admin');
    const response = await call(`${path}/restore/1`, {
      expectedVersion: 1,
      chosenUserId: await idOf('Bob'),
    });
    expect(await response.json<EditBody>()).toMatchObject({ unchanged: true });
    expect(await listLineVersionsByLine(db, line.id)).toHaveLength(1);
  });

  it('refuses a restore whose name now belongs to another line, and a snapshot it cannot read', async () => {
    const { db, call, line, path, actAs, idOf } = await setup();
    await call(path, { expectedVersion: 1, name: 'temp-name' }, 'PATCH');
    const other = await getLineByName(db, 'demo_d4');
    await call(`/api/lines/${other?.id ?? ''}`, { expectedVersion: 1, name: 'demo_c3' }, 'PATCH');
    await actAs('Admin');
    const chosenUserId = await idOf('Bob');
    const taken = await call(`${path}/restore/1`, { expectedVersion: 2, chosenUserId });
    expect(taken.status).toBe(409);
    expect((await taken.json<ErrorBody>()).error.code).toBe('NAME_TAKEN');

    await db
      .prepare("UPDATE line_versions SET snapshot = '[1]' WHERE line_id = ? AND version_no = 1")
      .bind(line.id)
      .run();
    expect((await call(`${path}/restore/1`, { expectedVersion: 2, chosenUserId })).status).toBe(
      422,
    );
  });

  it('previews what a restore would change, and nothing when the content matches', async () => {
    const { call, path, actAs } = await setup();
    await call(path, { expectedVersion: 1, gene: 'changed', attributes: [] }, 'PATCH');
    await actAs('Admin');
    const preview = await (
      await call(`${path}/restore/1/preview`)
    ).json<{
      versionNo: number;
      currentVersion: number;
      changes: { path: string; before: unknown; after: unknown }[];
    }>();
    expect(preview).toMatchObject({ versionNo: 1, currentVersion: 2 });
    expect(preview.changes.map((change) => change.path)).toEqual(['gene', 'attributes']);
    expect(preview.changes[0]).toEqual({ path: 'gene', before: 'changed', after: null });
    expect(preview.changes[1]?.after).toEqual([{ key: 'Source', value: 'REPOSITORY A' }]);
    const same = await (await call(`${path}/restore/2/preview`)).json<{ changes: unknown[] }>();
    expect(same.changes).toEqual([]);
  });

  it('reports 404 for a preview of an unknown line or version', async () => {
    const { call, path } = await setup();
    expect((await call('/api/lines/nope/restore/1/preview')).status).toBe(404);
    expect((await call(`${path}/restore/9/preview`)).status).toBe(404);
  });
});
