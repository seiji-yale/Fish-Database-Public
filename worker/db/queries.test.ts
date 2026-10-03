import { describe, expect, it } from 'vitest';
import type { Db } from './db';
import { AdminAuthorError } from './errors';
import {
  insertActivity,
  insertActivityStatement,
  listActivitiesByLine,
  listRecentActivities,
  ACTIVITIES,
  getActivityById,
} from './queries/activities';
import {
  ATTACHMENTS,
  getAttachmentById,
  insertAttachment,
  listAttachmentsByOwner,
  softDeleteAttachment,
} from './queries/attachments';
import {
  CHAT_MESSAGES,
  getChatMessageById,
  insertChatMessage,
  listChatMessagesByLine,
  listLabChatMessages,
  softDeleteChatMessage,
} from './queries/chatMessages';
import { CHAT_MENTIONS } from './queries/chatMentions';
import {
  CHAT_READS,
  CHAT_READ_STATE,
  listReadsByMessage,
  markMessageRead,
} from './queries/chatReads';
import { CRYO_VIAL_USES } from './queries/cryoVialUses';
import {
  CRYO_RECORDS,
  getCryoRecordById,
  insertCryoRecord,
  listCryoRecordsByLine,
  softDeleteCryoRecord,
} from './queries/cryoRecords';
import {
  ENUMERATIONS,
  getEnumerationById,
  insertEnumeration,
  listEnumerations,
} from './queries/enumerations';
import {
  GENOTYPING_RECORDS,
  getGenotypingRecordById,
  insertGenotypingRecord,
  listGenotypingRecordsByLine,
} from './queries/genotypingRecords';
import {
  getIdProtocolById,
  ID_PROTOCOLS,
  insertIdProtocol,
  listIdProtocolsByLine,
  softDeleteIdProtocol,
} from './queries/idProtocols';
import {
  getImportRunById,
  IMPORT_RUNS,
  insertImportRun,
  listRecentImportRuns,
} from './queries/importRuns';
import {
  getLineAttributeById,
  insertLineAttribute,
  LINE_ATTRIBUTES,
  listLineAttributesByLine,
  softDeleteLineAttribute,
} from './queries/lineAttributes';
import {
  getLinePhenotypeById,
  insertLinePhenotype,
  LINE_PHENOTYPES,
  listLinePhenotypesByLine,
  softDeleteLinePhenotype,
} from './queries/linePhenotypes';
import {
  getLineReferenceById,
  insertLineReference,
  LINE_REFERENCES,
  listLineReferencesByLine,
  softDeleteLineReference,
} from './queries/lineReferences';
import { getLineById, getLineByName, insertLine, LINES, listLines } from './queries/lines';
import {
  getLineVersion,
  getLineVersionById,
  insertLineVersionStatement,
  insertLineVersion,
  LINE_VERSIONS,
  listLineVersionsByLine,
} from './queries/lineVersions';
import {
  getMirrorRunById,
  insertMirrorRun,
  listRecentMirrorRuns,
  MIRROR_RUNS,
} from './queries/mirrorRuns';
import { getSetting, listSettings, setSetting } from './queries/settings';
import { chunk, listRowsByIn, softDeleteRow, type TableSpec } from './queries/shared';
import { INVITES } from './queries/invites';
import { getUserById, getUserByName, insertUser, listUsers, USERS } from './queries/users';
import {
  makeActivity,
  makeAttachment,
  makeAttribute,
  makeChatMessage,
  makeCryoRecord,
  makeGenotypingRecord,
  makeLine,
  makePhenotype,
  makeProtocol,
  makeReference,
  makeVersion,
  T0,
  USER_ID,
} from './testing/builders';
import { createMigratedDb } from './testing/testDb';

async function dbWithLine() {
  const db = createMigratedDb();
  await insertLine(db, makeLine());
  return db;
}

describe('row types match the DDL', () => {
  const specs: TableSpec<never>[] = [
    USERS,
    INVITES,
    ENUMERATIONS,
    LINES,
    LINE_PHENOTYPES,
    LINE_ATTRIBUTES,
    ID_PROTOCOLS,
    GENOTYPING_RECORDS,
    CRYO_RECORDS,
    CRYO_VIAL_USES,
    ATTACHMENTS,
    LINE_REFERENCES,
    LINE_VERSIONS,
    ACTIVITIES,
    CHAT_MESSAGES,
    CHAT_MENTIONS,
    CHAT_READS,
    CHAT_READ_STATE,
    MIRROR_RUNS,
    IMPORT_RUNS,
  ];

  it.each(specs.map((spec) => [spec.table, spec] as const))(
    '%s: typed columns equal PRAGMA table_info, in order',
    async (table, spec) => {
      const db = createMigratedDb();
      const { results } = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
      expect(spec.columns).toEqual(results.map((column) => column.name));
    },
  );

  it('covers every table in the database (settings has its own two-column helpers)', async () => {
    const db = createMigratedDb();
    const { results } = await db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all<{ name: string }>();
    const tables = results.map((table) => table.name).sort();
    expect(tables).toEqual([...specs.map((spec) => spec.table), 'settings'].sort());
  });

  it('never allows a NULL primary key (SQLite permits it on TEXT keys unless NOT NULL is stated)', async () => {
    const db = createMigratedDb();
    const { results: tables } = await db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all<{ name: string }>();
    for (const { name } of tables) {
      const { results } = await db
        .prepare(`PRAGMA table_info(${name})`)
        .all<{ name: string; pk: number; notnull: number }>();
      for (const column of results.filter((c) => c.pk > 0)) {
        expect({ table: name, column: column.name, notnull: column.notnull }).toEqual({
          table: name,
          column: column.name,
          notnull: 1,
        });
      }
    }
  });

  it('stores soft-delete columns exactly on the tables whose spec says so', async () => {
    const db = createMigratedDb();
    for (const spec of specs) {
      const { results } = await db
        .prepare(`PRAGMA table_info(${spec.table})`)
        .all<{ name: string }>();
      expect(results.some((column) => column.name === 'deleted_at')).toBe(spec.softDelete);
    }
  });
});

describe('insert and getById round-trip', () => {
  it('returns exactly what was inserted, for every table', async () => {
    const db = await dbWithLine();
    const protocol = makeProtocol();
    await insertIdProtocol(db, protocol);
    expect(await getIdProtocolById(db, protocol.id)).toEqual(protocol);
    expect(await getLineById(db, 'line-1')).toEqual(makeLine());

    const phenotype = makePhenotype();
    await insertLinePhenotype(db, phenotype);
    expect(await getLinePhenotypeById(db, phenotype.id)).toEqual(phenotype);

    const attribute = makeAttribute();
    await insertLineAttribute(db, attribute);
    expect(await getLineAttributeById(db, attribute.id)).toEqual(attribute);

    const record = makeGenotypingRecord({ protocol_id: 'proto-1', screened_count: 40 });
    await insertGenotypingRecord(db, record);
    expect(await getGenotypingRecordById(db, record.id)).toEqual(record);

    const cryo = makeCryoRecord();
    await insertCryoRecord(db, cryo);
    expect(await getCryoRecordById(db, cryo.id)).toEqual(cryo);

    const attachment = makeAttachment();
    await insertAttachment(db, attachment);
    expect(await getAttachmentById(db, attachment.id)).toEqual(attachment);

    const reference = makeReference({ url: 'https://example.org/p' });
    await insertLineReference(db, reference);
    expect(await getLineReferenceById(db, reference.id)).toEqual(reference);

    const version = makeVersion({ diff: '[{"path":"gene","before":null,"after":"pkd2"}]' });
    await insertLineVersion(db, version);
    expect(await getLineVersionById(db, version.id)).toEqual(version);

    const activity = makeActivity();
    await insertActivity(db, activity);
    expect(await getActivityById(db, activity.id)).toEqual(activity);

    const message = makeChatMessage({ request_type: 'Genotyping', request_status: 'open' });
    await insertChatMessage(db, message);
    expect(await getChatMessageById(db, message.id)).toEqual(message);
  });

  it('round-trips users, enumerations, mirror runs and import runs', async () => {
    const db = createMigratedDb();
    const user = {
      id: 'u1',
      name: 'Test',
      role: 'member' as const,
      is_active: 1,
      is_builtin: 0,
      created_at: T0,
      updated_at: T0,
      password_hash: null,
      must_change_password: 0,
      session_epoch: 0,
      failed_logins: 0,
      locked_until: null,
    };
    await insertUser(db, user);
    expect(await getUserById(db, 'u1')).toEqual(user);
    const enumeration = {
      id: 'e1',
      kind: 'cryo_place' as const,
      value: 'Freezer 9',
      sort_order: 9,
      is_active: 1,
    };
    await insertEnumeration(db, enumeration);
    expect(await getEnumerationById(db, 'e1')).toEqual(enumeration);
    const mirror = {
      id: 'm1',
      kind: 'nightly' as const,
      status: 'failed' as const,
      started_at: T0,
      finished_at: T0,
      files_written: 3,
      error: 'Dropbox unreachable',
    };
    await insertMirrorRun(db, mirror);
    expect(await getMirrorRunById(db, 'm1')).toEqual(mirror);
    const run = {
      id: 'i1',
      source_file: 'Example-Master.xlsx',
      source_sheet: 'Ver. 1.1',
      mode: 'dry_run' as const,
      started_at: T0,
      finished_at: T0,
      report_md: '# Report',
      row_count: 42,
    };
    await insertImportRun(db, run);
    expect(await getImportRunById(db, 'i1')).toEqual(run);
  });

  it('returns null for an unknown id', async () => {
    const db = createMigratedDb();
    expect(await getLineById(db, 'nope')).toBeNull();
    expect(await getCryoRecordById(db, 'nope')).toBeNull();
    expect(await getUserByName(db, 'Nobody')).toBeNull();
  });
});

describe('soft delete (BR-7)', () => {
  interface Case {
    name: string;
    insert: (db: Db) => Promise<unknown>;
    list: (db: Db, includeDeleted?: boolean) => Promise<unknown[]>;
    softDelete: (db: Db, id: string, now: string) => Promise<boolean>;
    id: string;
  }
  const opts = (includeDeleted?: boolean) =>
    includeDeleted === undefined ? undefined : { includeDeleted };
  const cases: Case[] = [
    {
      name: 'line_phenotypes',
      id: 'pheno-1',
      insert: (db) => insertLinePhenotype(db, makePhenotype()),
      list: (db, d) => listLinePhenotypesByLine(db, 'line-1', opts(d)),
      softDelete: softDeleteLinePhenotype,
    },
    {
      name: 'line_attributes',
      id: 'attr-1',
      insert: (db) => insertLineAttribute(db, makeAttribute()),
      list: (db, d) => listLineAttributesByLine(db, 'line-1', opts(d)),
      softDelete: softDeleteLineAttribute,
    },
    {
      name: 'id_protocols',
      id: 'proto-1',
      insert: (db) => insertIdProtocol(db, makeProtocol()),
      list: (db, d) => listIdProtocolsByLine(db, 'line-1', opts(d)),
      softDelete: softDeleteIdProtocol,
    },
    {
      name: 'cryo_records',
      id: 'cryo-1',
      insert: (db) => insertCryoRecord(db, makeCryoRecord()),
      list: (db, d) => listCryoRecordsByLine(db, 'line-1', opts(d)),
      softDelete: softDeleteCryoRecord,
    },
    {
      name: 'line_references',
      id: 'ref-1',
      insert: (db) => insertLineReference(db, makeReference()),
      list: (db, d) => listLineReferencesByLine(db, 'line-1', opts(d)),
      softDelete: softDeleteLineReference,
    },
    {
      name: 'attachments',
      id: 'att-1',
      insert: (db) => insertAttachment(db, makeAttachment()),
      list: (db, d) => listAttachmentsByOwner(db, 'id_protocol', 'proto-1', opts(d)),
      softDelete: softDeleteAttachment,
    },
    {
      name: 'chat_messages',
      id: 'msg-1',
      insert: (db) => insertChatMessage(db, makeChatMessage()),
      list: (db, d) => listChatMessagesByLine(db, 'line-1', opts(d)),
      softDelete: softDeleteChatMessage,
    },
  ];

  it.each(cases.map((c) => [c.name, c] as const))(
    '%s: list hides a deleted row unless includeDeleted; the row is kept',
    async (_name, c) => {
      const db = await dbWithLine();
      await c.insert(db);
      expect(await c.list(db)).toHaveLength(1);
      expect(await c.softDelete(db, c.id, '2026-09-29T00:00:00Z')).toBe(true);
      expect(await c.list(db)).toHaveLength(0);
      expect(await c.list(db, false)).toHaveLength(0);
      expect(await c.list(db, true)).toHaveLength(1);
      const stored = await db
        .prepare(`SELECT deleted_at FROM ${c.name} WHERE id = ?`)
        .bind(c.id)
        .first<{ deleted_at: string }>();
      expect(stored?.deleted_at).toBe('2026-09-29T00:00:00Z');
    },
  );

  it.each(cases.map((c) => [c.name, c] as const))(
    '%s: deleting twice or deleting an unknown id changes nothing',
    async (_name, c) => {
      const db = await dbWithLine();
      await c.insert(db);
      await c.softDelete(db, c.id, '2026-09-29T00:00:00Z');
      expect(await c.softDelete(db, c.id, '2026-10-01T00:00:00Z')).toBe(false);
      expect(await c.softDelete(db, 'unknown', '2026-10-01T00:00:00Z')).toBe(false);
      const stored = await db
        .prepare(`SELECT deleted_at FROM ${c.name} WHERE id = ?`)
        .bind(c.id)
        .first<{ deleted_at: string }>();
      expect(stored?.deleted_at).toBe('2026-09-29T00:00:00Z');
    },
  );

  it('refuses to soft-delete a table that has no deleted_at column', async () => {
    const db = await dbWithLine();
    await expect(softDeleteRow(db, GENOTYPING_RECORDS, 'x', T0)).rejects.toThrow(/no deleted_at/);
  });

  it('lets a soft-deleted attribute key be added again', async () => {
    const db = await dbWithLine();
    await insertLineAttribute(db, makeAttribute());
    await softDeleteLineAttribute(db, 'attr-1', T0);
    await insertLineAttribute(db, makeAttribute({ id: 'attr-2', value: 'In-house' }));
    const live = await listLineAttributesByLine(db, 'line-1');
    expect(live.map((a) => a.value)).toEqual(['In-house']);
  });
});

describe('list ordering and lookups', () => {
  it('lists users without inactive ones by default', async () => {
    const db = createMigratedDb();
    const names = (await listUsers(db)).map((u) => u.name);
    // The built-in Admin entry is retired by migration 0010 (ADR-0005).
    expect(names).toEqual(['Alice', 'Bob', 'Carol', 'Dan', 'Guest']);
    expect((await listUsers(db, { includeInactive: true })).map((u) => u.name)).toContain('Erin');
    expect((await getUserByName(db, 'Erin'))?.is_active).toBe(0);
  });

  it('lists enumerations by kind in sort order and hides disabled values', async () => {
    const db = createMigratedDb();
    expect((await listEnumerations(db, 'fluorophore')).map((e) => e.value)).toEqual([
      'GFP',
      'mCherry',
      'DsRed',
    ]);
    await db
      .prepare(
        "UPDATE enumerations SET is_active = 0 WHERE kind = 'fluorophore' AND value = 'mCherry'",
      )
      .run();
    expect((await listEnumerations(db, 'fluorophore')).map((e) => e.value)).toEqual([
      'GFP',
      'DsRed',
    ]);
    expect(
      (await listEnumerations(db, 'fluorophore', { includeInactive: true })).map((e) => e.value),
    ).toEqual(['GFP', 'mCherry', 'DsRed']);
  });

  it('reads, upserts and lists settings', async () => {
    const db = createMigratedDb();
    expect(await getSetting(db, 'upcoming_breeding_months')).toBe('11');
    await setSetting(db, 'upcoming_breeding_months', '12');
    await setSetting(db, 'mirror_last_ok_at', T0);
    expect(await getSetting(db, 'upcoming_breeding_months')).toBe('12');
    expect(await getSetting(db, 'mirror_last_ok_at')).toBe(T0);
    expect(await getSetting(db, 'lab_passphrase_hash')).toBeNull();
    expect(await getSetting(db, 'no_such_key')).toBeNull();
    const keys = (await listSettings(db)).map((s) => s.key);
    expect(keys).toEqual([...keys].sort());
    expect(keys).toContain('mirror_last_ok_at');
  });

  it('finds a line by name ignoring case and surrounding spaces (BR-8) and filters by status', async () => {
    const db = await dbWithLine();
    await insertLine(db, makeLine({ id: 'line-2', name: 'DEMO_E5', status: 'Closed' }));
    expect((await getLineByName(db, '  DEMO_C3 '))?.id).toBe('line-1');
    expect(await getLineByName(db, 'hi4')).toBeNull();
    expect((await listLines(db)).map((l) => l.name)).toEqual(['demo_c3', 'DEMO_E5']);
    expect((await listLines(db, { status: 'Closed' })).map((l) => l.name)).toEqual(['DEMO_E5']);
    expect(await listLines(db, { status: 'Breeding' })).toEqual([]);
  });

  it('lists versions newest first and finds one by number', async () => {
    const db = await dbWithLine();
    for (const n of [1, 2, 3])
      await insertLineVersion(db, makeVersion({ id: `v${String(n)}`, version_no: n }));
    expect((await listLineVersionsByLine(db, 'line-1')).map((v) => v.version_no)).toEqual([
      3, 2, 1,
    ]);
    expect((await getLineVersion(db, 'line-1', 2))?.id).toBe('v2');
    expect(await getLineVersion(db, 'line-1', 9)).toBeNull();
  });

  it('lists genotyping records by generation then date', async () => {
    const db = await dbWithLine();
    await insertGenotypingRecord(
      db,
      makeGenotypingRecord({ id: 'g3', generation_no: 2, record_date: '2026-05-01' }),
    );
    await insertGenotypingRecord(
      db,
      makeGenotypingRecord({ id: 'g2', generation_no: 1, record_date: '2026-03-01' }),
    );
    await insertGenotypingRecord(
      db,
      makeGenotypingRecord({ id: 'g1', generation_no: 1, record_date: '2026-01-08' }),
    );
    expect((await listGenotypingRecordsByLine(db, 'line-1')).map((r) => r.id)).toEqual([
      'g1',
      'g2',
      'g3',
    ]);
  });

  it('lists recent activities newest first with a limit, and by line', async () => {
    const db = await dbWithLine();
    await insertLine(db, makeLine({ id: 'line-2', name: 'DEMO_E5' }));
    await insertActivity(db, makeActivity({ id: 'a1', created_at: '2026-09-01T00:00:00Z' }));
    await insertActivity(
      db,
      makeActivity({ id: 'a2', line_id: 'line-2', created_at: '2026-09-03T00:00:00Z' }),
    );
    await insertActivity(db, makeActivity({ id: 'a3', created_at: '2026-09-02T00:00:00Z' }));
    expect((await listRecentActivities(db, 10)).map((a) => a.id)).toEqual(['a2', 'a3', 'a1']);
    expect((await listRecentActivities(db, 2)).map((a) => a.id)).toEqual(['a2', 'a3']);
    expect((await listActivitiesByLine(db, 'line-1', 10)).map((a) => a.id)).toEqual(['a3', 'a1']);
  });

  it('lists lab-wide chat separately from line chat, and mirror / import runs newest first', async () => {
    const db = await dbWithLine();
    await insertChatMessage(
      db,
      makeChatMessage({ id: 'c1', line_id: null, created_at: '2026-09-02T00:00:00Z' }),
    );
    await insertChatMessage(db, makeChatMessage({ id: 'c2', line_id: 'line-1' }));
    await insertChatMessage(
      db,
      makeChatMessage({ id: 'c3', line_id: null, created_at: '2026-09-01T00:00:00Z' }),
    );
    expect((await listLabChatMessages(db)).map((m) => m.id)).toEqual(['c3', 'c1']);
    expect((await listChatMessagesByLine(db, 'line-1')).map((m) => m.id)).toEqual(['c2']);
    await softDeleteChatMessage(db, 'c1', T0);
    expect((await listLabChatMessages(db)).map((m) => m.id)).toEqual(['c3']);
    expect((await listLabChatMessages(db, { includeDeleted: true })).map((m) => m.id)).toEqual([
      'c3',
      'c1',
    ]);
    await insertMirrorRun(db, {
      id: 'm1',
      kind: 'manual',
      status: 'ok',
      started_at: '2026-09-01T00:00:00Z',
      finished_at: null,
      files_written: 0,
      error: null,
    });
    await insertMirrorRun(db, {
      id: 'm2',
      kind: 'nightly',
      status: 'ok',
      started_at: '2026-09-02T00:00:00Z',
      finished_at: null,
      files_written: 0,
      error: null,
    });
    expect((await listRecentMirrorRuns(db, 5)).map((r) => r.id)).toEqual(['m2', 'm1']);
    await insertImportRun(db, {
      id: 'i1',
      source_file: null,
      source_sheet: null,
      mode: 'apply',
      started_at: '2026-09-01T00:00:00Z',
      finished_at: null,
      report_md: null,
      row_count: null,
    });
    expect((await listRecentImportRuns(db, 5)).map((r) => r.id)).toEqual(['i1']);
  });

  it('records one read per user and keeps the first read time', async () => {
    const db = await dbWithLine();
    await insertChatMessage(db, makeChatMessage());
    await markMessageRead(db, 'msg-1', USER_ID.carol, '2026-09-28T13:00:00Z');
    await markMessageRead(db, 'msg-1', USER_ID.carol, '2026-09-28T14:00:00Z');
    await markMessageRead(db, 'msg-1', USER_ID.dan, '2026-09-28T13:30:00Z');
    const reads = await listReadsByMessage(db, 'msg-1');
    expect(reads.map((r) => [r.user_id, r.read_at])).toEqual([
      [USER_ID.carol, '2026-09-28T13:00:00Z'],
      [USER_ID.dan, '2026-09-28T13:30:00Z'],
    ]);
  });

  it('lists attachments by owner only', async () => {
    const db = await dbWithLine();
    await insertAttachment(db, makeAttachment());
    await insertAttachment(db, makeAttachment({ id: 'att-2', r2_key: 'k2', owner_id: 'proto-2' }));
    await insertAttachment(
      db,
      makeAttachment({ id: 'att-3', r2_key: 'k3', owner_type: 'genotyping_record' }),
    );
    expect((await listAttachmentsByOwner(db, 'id_protocol', 'proto-1')).map((a) => a.id)).toEqual([
      'att-1',
    ]);
  });
});

describe('Admin-author guard for activities (BR-5)', () => {
  it('rejects an activity authored by Admin and stores nothing', async () => {
    const db = await dbWithLine();
    await expect(
      insertActivity(db, makeActivity({ user_id: USER_ID.admin, via_admin: 1 })),
    ).rejects.toThrow(AdminAuthorError);
    await expect(
      insertActivityStatement(db, makeActivity({ user_id: USER_ID.admin })),
    ).rejects.toThrow(AdminAuthorError);
    expect(await getActivityById(db, 'act-1')).toBeNull();
  });

  it('accepts a member, keeping via_admin, in a batch with its version (one transaction)', async () => {
    const db = await dbWithLine();
    await db.batch([
      insertLineVersionStatement(db, makeVersion()),
      await insertActivityStatement(db, makeActivity({ user_id: USER_ID.alice, via_admin: 1 })),
    ]);
    expect((await getActivityById(db, 'act-1'))?.via_admin).toBe(1);
    expect(await getLineVersionById(db, 'ver-1')).not.toBeNull();
  });
});

describe('IN lists longer than the D1 parameter limit (T-018)', () => {
  it('chunk splits a list into pieces of at most 90', () => {
    expect(chunk([1, 2, 3], 2)).toEqual([[1, 2], [3]]);
    expect(chunk([], 2)).toEqual([]);
    expect(
      chunk(Array.from({ length: 200 }, (_, index) => index)).map((part) => part.length),
    ).toEqual([90, 90, 20]);
  });

  it('listRowsByIn finds children of 250 lines with one call (no "too many SQL variables")', async () => {
    const db = createMigratedDb();
    const ids = Array.from({ length: 250 }, (_, index) => `many-${String(index)}`);
    for (const id of ids) await insertLine(db, makeLine({ id, name: `n-${id}` }));
    await insertLinePhenotype(db, makePhenotype({ id: 'p-far', line_id: 'many-249' }));
    const rows = await listRowsByIn(db, LINE_PHENOTYPES, 'line_id', ids, 'id');
    expect(rows.map((row) => row.id)).toEqual(['p-far']);
  });
});
