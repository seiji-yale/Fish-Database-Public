import { describe, expect, it } from 'vitest';
import fixture from '../tests/fixtures/lines.small.json';
import { loadFixture } from './db/fixtures';
import { listActivitiesByLine } from './db/queries/activities';
import { listCryoRecordsByLine } from './db/queries/cryoRecords';
import { getLineByName } from './db/queries/lines';
import { listLineVersionsByLine } from './db/queries/lineVersions';
import { browser, type ErrorBody } from './testBrowser';

interface WriteBody {
  id: string;
  version: number;
  summary: string;
}

async function setup(lineName = 'demo_b2', actor = 'Bob') {
  const b = browser();
  await loadFixture(b.db, fixture);
  await b.actAs(actor);
  const line = await getLineByName(b.db, lineName);
  if (line === null) throw new Error('fixture line missing');
  return {
    ...b,
    line,
    base: `/api/lines/${line.id}`,
    live: () => listCryoRecordsByLine(b.db, line.id),
  };
}

const RECORD = {
  cryoDate: '2026-09-01',
  place: 'Demo freezer shelf',
  boxName: 'Demo cryo box-Bob',
  cryoIdStart: 'C0637',
  cryoIdEnd: 'C0644',
};

async function fields(response: Response): Promise<Record<string, string>> {
  return ((await response.json<ErrorBody>()).error.details?.['fields'] ?? {}) as Record<
    string,
    string
  >;
}

describe('GET /api/cryo/next-id (FR-CRYO-03)', () => {
  it('is the largest existing ID over all lines plus one', async () => {
    const { call } = await setup();
    const response = await call('/api/cryo/next-id');
    expect(await response.json()).toEqual({ nextId: 'C0611' });
  });

  it('moves on after a record is added and back after it is removed', async () => {
    const { call, base, live } = await setup();
    await call(`${base}/cryo`, { expectedVersion: 1, ...RECORD });
    expect(await (await call('/api/cryo/next-id')).json()).toEqual({ nextId: 'C0645' });
    const added = (await live())[0];
    await call(`${base}/cryo/${added?.id ?? ''}`, { expectedVersion: 2 }, 'DELETE');
    expect(await (await call('/api/cryo/next-id')).json()).toEqual({ nextId: 'C0611' });
  });
});

describe('POST /api/lines/:id/cryo', () => {
  it('adds a record with the derived count, a readable summary, one version and one activity', async () => {
    const { db, call, base, line, live } = await setup();
    const response = await call(`${base}/cryo`, {
      expectedVersion: 1,
      ...RECORD,
      count: 99,
      note: 'batch 3',
    });
    expect(response.status).toBe(200);
    expect(await response.json<WriteBody>()).toMatchObject({
      version: 2,
      summary: 'Added cryo record C0637–C0644 (8) at Demo freezer shelf.',
    });
    expect(await live()).toMatchObject([
      { cryo_id_start: 'C0637', cryo_id_end: 'C0644', count: 8, details_unknown: 0 },
    ]);
    const [latest] = await listLineVersionsByLine(db, line.id);
    expect(latest).toMatchObject({ change_type: 'cryo_changed', note: 'batch 3' });
    expect((await listActivitiesByLine(db, line.id, 1))[0]?.type).toBe('cryo_changed');
  });

  it('flips is_cryopreserved in the list API: yes after adding, no after removing the only record', async () => {
    const { call, base, live } = await setup();
    const cryoLines = async () =>
      (
        await (await call('/api/lines?view=all&cryo=yes')).json<{ items: { name: string }[] }>()
      ).items.map((item) => item.name);
    expect(await cryoLines()).not.toContain('demo_b2');
    await call(`${base}/cryo`, { expectedVersion: 1, ...RECORD });
    expect(await cryoLines()).toContain('demo_b2');
    const added = (await live())[0];
    await call(`${base}/cryo/${added?.id ?? ''}`, { expectedVersion: 2 }, 'DELETE');
    expect(await cryoLines()).not.toContain('demo_b2');
  });

  it('accepts external storage without IDs, and a details-unknown record', async () => {
    const { call, base } = await setup();
    const external = await call(`${base}/cryo`, {
      expectedVersion: 1,
      place: 'External storage',
      count: 10,
    });
    expect(external.status).toBe(200);
    const unknown = await call(`${base}/cryo`, { expectedVersion: 2, detailsUnknown: true });
    expect(unknown.status).toBe(200);
    expect((await unknown.json<WriteBody>()).summary).toBe('Added cryo record details unknown.');
  });

  it('rejects end < start, a bad ID, an empty record and a future date with the field named', async () => {
    const { call, base, line } = await setup();
    const backwards = await call(`${base}/cryo`, {
      expectedVersion: 1,
      ...RECORD,
      cryoIdStart: 'C0644',
      cryoIdEnd: 'C0637',
    });
    expect(backwards.status).toBe(400);
    expect(Object.keys(await fields(backwards))).toEqual(['cryoIdEnd']);
    expect(
      Object.keys(
        await fields(
          await call(`${base}/cryo`, {
            expectedVersion: 1,
            place: 'x',
            cryoIdStart: 'C1',
            cryoIdEnd: 'C2',
          }),
        ),
      ).sort(),
    ).toEqual(['cryoIdEnd', 'cryoIdStart']);
    expect(Object.keys(await fields(await call(`${base}/cryo`, { expectedVersion: 1 })))).toEqual([
      'form',
    ]);
    expect(
      (await fields(await call(`${base}/cryo`, { expectedVersion: 1, cryoDate: '2999-01-01' })))[
        'cryoDate'
      ],
    ).toMatch(/future/);
    expect((await getLineByName((await setup()).db, line.name))?.version).toBe(1);
  });

  it('refuses a Guest, lets an Admin add, and reports a stale version', async () => {
    const guest = await setup('demo_b2', 'Guest');
    expect((await guest.call(`${guest.base}/cryo`, { expectedVersion: 1, ...RECORD })).status).toBe(
      403,
    );
    const admin = await setup('demo_b2', 'Admin');
    const ask = await admin.call(`${admin.base}/cryo`, { expectedVersion: 1, ...RECORD });
    expect(ask.status).toBe(200);
    const { call, base } = await setup();
    await call(`${base}/cryo`, { expectedVersion: 1, ...RECORD });
    const stale = await call(`${base}/cryo`, { expectedVersion: 1, ...RECORD });
    expect((await stale.json<ErrorBody>()).error.code).toBe('VERSION_CONFLICT');
  });
});

describe('PATCH and DELETE /api/lines/:id/cryo/:cid', () => {
  it('edits a record in place (e.g. an imported one) and removes it softly', async () => {
    const { db, call, base, line, live } = await setup('DEMO_E5');
    const target = (await live())[0];
    expect(target?.cryo_id_start).toBe('C0605');
    const edited = await call(
      `${base}/cryo/${target?.id ?? ''}`,
      {
        expectedVersion: 1,
        ...RECORD,
        place: 'External storage',
        cryoIdStart: 'C0801',
        cryoIdEnd: 'C0810',
      },
      'PATCH',
    );
    expect((await edited.json<WriteBody>()).summary).toBe(
      'Updated cryo record C0801–C0810 (10) at External storage.',
    );
    expect((await live())[0]).toMatchObject({
      id: target?.id,
      count: 10,
      place: 'External storage',
    });

    const removed = await call(
      `${base}/cryo/${target?.id ?? ''}`,
      { expectedVersion: 2 },
      'DELETE',
    );
    expect((await removed.json<WriteBody>()).summary).toMatch(/^Removed cryo record C0801–C0810/);
    expect(await live()).toHaveLength(0);
    const hidden = await db
      .prepare('SELECT deleted_at FROM cryo_records WHERE id = ?')
      .bind(target?.id ?? '')
      .first<{ deleted_at: string | null }>();
    expect(hidden?.deleted_at).not.toBeNull();
    expect((await listLineVersionsByLine(db, line.id))[0]?.change_type).toBe('cryo_changed');
  });

  it('answers 404 for an unknown or already removed record and 400 for a bad body', async () => {
    const { call, base, live } = await setup('DEMO_E5');
    const target = (await live())[0];
    expect(
      (await call(`${base}/cryo/nope`, { expectedVersion: 1, ...RECORD }, 'PATCH')).status,
    ).toBe(404);
    await call(`${base}/cryo/${target?.id ?? ''}`, { expectedVersion: 1 }, 'DELETE');
    expect(
      (await call(`${base}/cryo/${target?.id ?? ''}`, { expectedVersion: 2 }, 'DELETE')).status,
    ).toBe(404);
    expect(
      (await call(`${base}/cryo/${target?.id ?? ''}`, { expectedVersion: 'x' }, 'DELETE')).status,
    ).toBe(400);
    expect((await call(`${base}/cryo/x`, [1], 'PATCH')).status).toBe(400);
  });
});

describe('POST /api/lines/:id/cryo/use (vials used)', () => {
  async function withRange(lineName = 'demo_b2') {
    const s = await setup(lineName);
    await s.call(`${s.base}/cryo`, { expectedVersion: 1, ...RECORD });
    return s;
  }
  const usedRows = (db: Awaited<ReturnType<typeof setup>>['db'], lineId: string) =>
    db
      .prepare('SELECT cryo_id, quantity FROM cryo_vial_uses WHERE line_id = ? ORDER BY cryo_id')
      .bind(lineId)
      .all<{ cryo_id: string | null; quantity: number }>();

  it('records used IDs and ranges, lowers the count, keeps the record and writes one readable version', async () => {
    const { db, call, base, line, live } = await withRange();
    const response = await call(`${base}/cryo/use`, {
      expectedVersion: 2,
      vialIds: 'C0640, c0642-C0643',
      usedAt: '2026-09-20',
      note: 'thaw for crossing',
    });
    expect(response.status).toBe(200);
    expect((await response.json<WriteBody>()).summary).toBe(
      'Used cryo vials C0640, C0642–C0643 (3).',
    );
    expect(await live()).toMatchObject([
      { cryo_id_start: 'C0637', cryo_id_end: 'C0644', count: 5, deleted_at: null },
    ]);
    expect((await usedRows(db, line.id)).results.map((row) => row.cryo_id)).toEqual([
      'C0640',
      'C0642',
      'C0643',
    ]);
    const [latest] = await listLineVersionsByLine(db, line.id);
    expect(latest).toMatchObject({ change_type: 'cryo_changed', note: 'thaw for crossing' });
  });

  it('never hands a used ID out again: not in next-id, not in a new record, not used twice', async () => {
    const { call, base, line } = await withRange();
    await call(`${base}/cryo/use`, { expectedVersion: 2, vialIds: 'C0644' });
    // The highest ID was used, so the suggestion moves past it instead of reusing it.
    expect(await (await call('/api/cryo/next-id')).json()).toEqual({ nextId: 'C0645' });
    const again = await call(`${base}/cryo/use`, { expectedVersion: 3, vialIds: 'C0644' });
    expect((await fields(again))['vialIds']).toMatch(/C0644 was already used/);
    const clash = await call(`${base}/cryo`, {
      expectedVersion: 3,
      place: 'x',
      cryoIdStart: 'C0643',
      cryoIdEnd: 'C0646',
    });
    expect((await fields(clash))['cryoIdStart']).toMatch(
      /C0644 was already used and cannot be registered/,
    );
    const other = await call(`/api/lines/${line.id}/cryo`, {
      expectedVersion: 3,
      place: 'x',
      cryoIdStart: 'C0645',
      cryoIdEnd: 'C0646',
    });
    expect(other.status).toBe(200);
  });

  it('refuses IDs that are not on the line and malformed input, and writes nothing', async () => {
    const { call, base, reload } = await withRangeWithReload();
    const notMine = await call(`${base}/cryo/use`, { expectedVersion: 2, vialIds: 'C1499' });
    expect((await fields(notMine))['vialIds']).toMatch(/C1499 is not a vial of this line/);
    for (const vialIds of ['banana', 'C0644-C0637', 'C0640 C0640', '']) {
      const bad = await call(`${base}/cryo/use`, { expectedVersion: 2, vialIds });
      expect(bad.status).toBe(400);
    }
    const future = await call(`${base}/cryo/use`, {
      expectedVersion: 2,
      vialIds: 'C0640',
      usedAt: '2999-01-01',
    });
    expect((await fields(future))['usedAt']).toMatch(/future/);
    expect((await reload()).version).toBe(2);
  });

  async function withRangeWithReload() {
    const s = await withRange();
    return {
      ...s,
      reload: async () => {
        const row = await getLineByName(s.db, 'demo_b2');
        if (row === null) throw new Error('line vanished');
        return row;
      },
    };
  }

  it('using the last vials removes the record (BR-6: no longer cryopreserved) but keeps the used list', async () => {
    const { db, call, base, line, live } = await withRange();
    const response = await call(`${base}/cryo/use`, { expectedVersion: 2, vialIds: 'C0637-C0644' });
    expect((await response.json<WriteBody>()).summary).toBe(
      'Used cryo vials C0637–C0644 (8); no vial left in the record.',
    );
    expect(await live()).toHaveLength(0);
    // The record is gone but its IDs stay used: the next free ID is past them, not back at C0611.
    expect(await (await call('/api/cryo/next-id')).json()).toEqual({ nextId: 'C0645' });
    expect((await usedRows(db, line.id)).results).toHaveLength(8);
    const list = await (
      await call('/api/lines?view=all&cryo=yes')
    ).json<{ items: { name: string }[] }>();
    expect(list.items.map((item) => item.name)).not.toContain('demo_b2');
    const detail = await (
      await call(base)
    ).json<{
      cryoUses: { cryoId: string; place: string | null }[];
      isCryopreserved: boolean;
    }>();
    expect(detail.isCryopreserved).toBe(false);
    expect(detail.cryoUses).toHaveLength(8);
    expect(detail.cryoUses[0]?.place).toBe('Demo freezer shelf');
  });

  it('uses vials of a record without IDs by quantity', async () => {
    const { call, base, live } = await setup();
    await call(`${base}/cryo`, { expectedVersion: 1, place: 'External storage', count: 10 });
    const record = (await live())[0];
    const tooMany = await call(`${base}/cryo/use`, {
      expectedVersion: 2,
      recordId: record?.id,
      quantity: 11,
    });
    expect((await fields(tooMany))['quantity']).toMatch(/Only 10 vials/);
    const ok = await call(`${base}/cryo/use`, {
      expectedVersion: 2,
      recordId: record?.id,
      quantity: '4',
    });
    expect((await ok.json<WriteBody>()).summary).toMatch(/^Used cryo vials 4 from /);
    expect((await live())[0]?.count).toBe(6);
    const wrong = await call(`${base}/cryo/use`, {
      expectedVersion: 3,
      recordId: 'nope',
      quantity: 1,
    });
    expect(wrong.status).toBe(400);
    const none = await call(`${base}/cryo/use`, { expectedVersion: 3, quantity: 1 });
    expect((await fields(none))['vialIds']).toMatch(/Enter vial IDs/);
    const missing = await call(`${base}/cryo/use`, { expectedVersion: 3, recordId: record?.id });
    expect((await fields(missing))['quantity']).toMatch(/whole number/);
    // A record that has IDs cannot be used by quantity.
    await call(`${base}/cryo`, { expectedVersion: 3, ...RECORD });
    const withIds = (await live()).find((row) => row.cryo_id_start !== null);
    const refused = await call(`${base}/cryo/use`, {
      expectedVersion: 4,
      recordId: withIds?.id,
      quantity: 1,
    });
    expect((await fields(refused))['vialIds']).toMatch(/has vial IDs/);
  });

  it('editing a record keeps its used vials inside the range and counts only what is left', async () => {
    const { call, base, live } = await withRange();
    await call(`${base}/cryo/use`, { expectedVersion: 2, vialIds: 'C0640' });
    const record = (await live())[0];
    const edit = (body: object) =>
      call(`${base}/cryo/${record?.id ?? ''}`, { expectedVersion: 3, ...RECORD, ...body }, 'PATCH');
    const outside = await edit({ cryoIdStart: 'C0641', cryoIdEnd: 'C0644' });
    expect((await fields(outside))['cryoIdStart']).toMatch(/C0640/);
    const ok = await edit({ cryoIdStart: 'C0637', cryoIdEnd: 'C0646' });
    expect(ok.status).toBe(200);
    expect((await live())[0]?.count).toBe(9);
  });
});

describe('the place list learns new places', () => {
  it('a place typed under Other is saved once and then offered; existing places are not duplicated', async () => {
    const { call, base } = await setup();
    const places = async () =>
      (await (await call('/api/enumerations?kind=cryo_place')).json<{ values: string[] }>()).values;
    expect(await places()).not.toContain('Freezer 9');
    await call(`${base}/cryo`, { expectedVersion: 1, place: 'Freezer 9', count: 3 });
    expect(await places()).toContain('Freezer 9');
    await call(`${base}/cryo`, { expectedVersion: 2, place: 'freezer 9', count: 2 });
    await call(`${base}/cryo`, { expectedVersion: 3, place: 'Demo freezer shelf', count: 2 });
    const after = await places();
    expect(after.filter((value) => value.toLowerCase() === 'freezer 9')).toHaveLength(1);
    expect(after.filter((value) => value === 'Demo freezer shelf')).toHaveLength(1);
  });

  it('a new line created with a new place saves it too', async () => {
    const { call } = await setup();
    const response = await call('/api/lines', {
      name: 'place-line',
      dob: '2026-01-05',
      cryo: { place: 'Freezer 12', count: 4 },
    });
    expect(response.status).toBe(201);
    const values = (
      await (await call('/api/enumerations?kind=cryo_place')).json<{ values: string[] }>()
    ).values;
    expect(values).toContain('Freezer 12');
  });
});

describe('POST /api/lines/:id/cryo/uses/:useId/undo (T-028, OQ-38)', () => {
  async function withUses() {
    const s = await setup();
    await s.call(`${s.base}/cryo`, { expectedVersion: 1, ...RECORD });
    return s;
  }
  const useIdOf = async (
    db: Awaited<ReturnType<typeof setup>>['db'],
    lineId: string,
    cryoId: string,
  ) =>
    (
      await db
        .prepare('SELECT id FROM cryo_vial_uses WHERE line_id = ? AND cryo_id = ?')
        .bind(lineId, cryoId)
        .first<{ id: string }>()
    )?.id ?? '';

  it('puts the vial back, frees its ID, hides the use and writes who undid it', async () => {
    const { db, call, base, line, live } = await withUses();
    await call(`${base}/cryo/use`, { expectedVersion: 2, vialIds: 'C0640, C0641' });
    expect((await live())[0]?.count).toBe(6);
    const use = await useIdOf(db, line.id, 'C0640');
    const response = await call(`${base}/cryo/uses/${use}/undo`, {
      expectedVersion: 3,
      note: 'recorded by mistake',
    });
    expect(response.status).toBe(200);
    expect((await response.json<WriteBody>()).summary).toBe(
      'Undid a cryo vial use C0640 (C0637–C0644 (6) at Demo freezer shelf).',
    );
    expect((await live())[0]?.count).toBe(7);
    // The row stays for good, marked undone; the use list and the used IDs no longer show it.
    expect(
      await db
        .prepare('SELECT undone_by FROM cryo_vial_uses WHERE id = ?')
        .bind(use)
        .first<{ undone_by: string | null }>(),
    ).toEqual({ undone_by: expect.any(String) as string });
    const detail = await (await call(base)).json<{ cryoUses: { cryoId: string }[] }>();
    expect(detail.cryoUses.map((item) => item.cryoId)).toEqual(['C0641']);
    const [latest] = await listLineVersionsByLine(db, line.id);
    expect(latest).toMatchObject({ change_type: 'cryo_changed', note: 'recorded by mistake' });
    // Its ID may be used again later (the unique index only covers uses that stand).
    const again = await call(`${base}/cryo/use`, { expectedVersion: 4, vialIds: 'C0640' });
    expect(again.status).toBe(200);
  });

  it('brings back a record that this use had emptied, with the returned vial in it', async () => {
    const { db, call, base, line, live } = await withUses();
    await call(`${base}/cryo/use`, { expectedVersion: 2, vialIds: 'C0637-C0644' });
    expect(await live()).toHaveLength(0);
    const use = await useIdOf(db, line.id, 'C0644');
    expect((await call(`${base}/cryo/uses/${use}/undo`, { expectedVersion: 3 })).status).toBe(200);
    expect(await live()).toMatchObject([{ cryo_id_start: 'C0637', count: 1, deleted_at: null }]);
    const detail = await (await call(base)).json<{ isCryopreserved: boolean }>();
    expect(detail.isCryopreserved).toBe(true);
  });

  it('undoes a use by quantity', async () => {
    const { db, call, base, line, live } = await setup();
    await call(`${base}/cryo`, { expectedVersion: 1, place: 'External storage', count: 10 });
    const record = (await live())[0];
    await call(`${base}/cryo/use`, { expectedVersion: 2, recordId: record?.id, quantity: 4 });
    const use = (
      await db
        .prepare('SELECT id FROM cryo_vial_uses WHERE line_id = ?')
        .bind(line.id)
        .first<{ id: string }>()
    )?.id;
    const response = await call(`${base}/cryo/uses/${use ?? ''}/undo`, { expectedVersion: 3 });
    expect((await response.json<WriteBody>()).summary).toMatch(/^Undid a cryo vial use 4 vial/);
    expect((await live())[0]?.count).toBe(10);
  });

  it('refuses a second undo, an unknown use, a stale page and a record removed on purpose', async () => {
    const { db, call, base, line, live } = await withUses();
    await call(`${base}/cryo/use`, { expectedVersion: 2, vialIds: 'C0640' });
    const use = await useIdOf(db, line.id, 'C0640');
    const stale = await call(`${base}/cryo/uses/${use}/undo`, { expectedVersion: 2 });
    expect((await stale.json<ErrorBody>()).error.code).toBe('VERSION_CONFLICT');
    expect((await call(`${base}/cryo/uses/${use}/undo`, { expectedVersion: 3 })).status).toBe(200);
    const twice = await call(`${base}/cryo/uses/${use}/undo`, { expectedVersion: 4 });
    expect((await twice.json<ErrorBody>()).error.code).toBe('ALREADY_UNDONE');
    const unknown = await call(`${base}/cryo/uses/nope/undo`, { expectedVersion: 4 });
    expect((await unknown.json<ErrorBody>()).error.code).toBe('USE_NOT_FOUND');

    await call(`${base}/cryo/use`, { expectedVersion: 4, vialIds: 'C0641' });
    const second = await useIdOf(db, line.id, 'C0641');
    const record = (await live())[0];
    await call(`${base}/cryo/${record?.id ?? ''}`, { expectedVersion: 5 }, 'DELETE');
    const removed = await call(`${base}/cryo/uses/${second}/undo`, { expectedVersion: 6 });
    expect((await removed.json<ErrorBody>()).error.code).toBe('RECORD_REMOVED');
  });

  it('refuses to bring an emptied record back over IDs that another record now holds', async () => {
    const { db, call, base, line } = await withUses();
    await call(`${base}/cryo/use`, { expectedVersion: 2, vialIds: 'C0637-C0644' });
    await call(`${base}/cryo`, {
      expectedVersion: 3,
      place: 'x',
      cryoIdStart: 'C0700',
      cryoIdEnd: 'C0703',
    });
    // A record that overlaps the old range can only exist if it was added around the used IDs.
    await db
      .prepare(
        `INSERT INTO cryo_records (id, line_id, place, cryo_id_start, cryo_id_end, count, details_unknown, created_at, created_by)
         VALUES ('clash', ?, 'y', 'C0640', 'C0641', 2, 0, '2026-09-01T00:00:00Z', (SELECT id FROM users WHERE name = 'Bob'))`,
      )
      .bind(line.id)
      .run();
    const use = await useIdOf(db, line.id, 'C0644');
    const response = await call(`${base}/cryo/uses/${use}/undo`, { expectedVersion: 4 });
    expect((await response.json<ErrorBody>()).error.code).toBe('NOT_RESTORABLE');
  });

  it('is refused for a Guest and for a visitor without a session', async () => {
    const { db, call, base, line, actAs } = await withUses();
    await call(`${base}/cryo/use`, { expectedVersion: 2, vialIds: 'C0640' });
    const use = await useIdOf(db, line.id, 'C0640');
    await actAs('Guest');
    expect((await call(`${base}/cryo/uses/${use}/undo`, { expectedVersion: 3 })).status).toBe(403);
    await call('/api/session/logout', {});
    expect((await call(`${base}/cryo/uses/${use}/undo`, { expectedVersion: 3 })).status).toBe(401);
  });

  it('lets an Admin undo and records the Admin as the author', async () => {
    const { db, call, base, line, actAs } = await withUses();
    await call(`${base}/cryo/use`, { expectedVersion: 2, vialIds: 'C0640' });
    const use = await useIdOf(db, line.id, 'C0640');
    const adminId = await actAs('Admin');
    expect((await call(`${base}/cryo/uses/${use}/undo`, { expectedVersion: 3 })).status).toBe(200);
    const [latest] = await listActivitiesByLine(db, line.id, 1);
    expect(latest).toMatchObject({ user_id: adminId, via_admin: 0 });
  });
});
