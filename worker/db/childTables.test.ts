import { describe, expect, it } from 'vitest';
import { AdminAuthorError } from './errors';
import { getChatMessageById, insertChatMessage } from './queries/chatMessages';
import {
  makeActivity,
  makeAttachment,
  makeChatMessage,
  makeCryoRecord,
  makeGenotypingRecord,
  makeLine,
  makeProtocol,
  makeReference,
  makeVersion,
  USER_ID,
} from './testing/builders';
import { createMigratedDb, insertRaw } from './testing/testDb';

async function dbWithLine() {
  const db = createMigratedDb();
  await insertRaw(db, 'lines', makeLine());
  return db;
}

describe('CHECK constraints', () => {
  it('rejects a negative positive_count and accepts zero', async () => {
    const db = await dbWithLine();
    await expect(
      insertRaw(db, 'genotyping_records', makeGenotypingRecord({ positive_count: -1 })),
    ).rejects.toThrow(/CHECK/);
    await expect(
      insertRaw(db, 'genotyping_records', makeGenotypingRecord({ positive_count: 0 })),
    ).resolves.toBeDefined();
  });

  it('rejects a negative screened_count and accepts NULL', async () => {
    const db = await dbWithLine();
    await expect(
      insertRaw(db, 'genotyping_records', makeGenotypingRecord({ screened_count: -5 })),
    ).rejects.toThrow(/CHECK/);
    await expect(
      insertRaw(db, 'genotyping_records', makeGenotypingRecord({ screened_count: null })),
    ).resolves.toBeDefined();
  });

  it('rejects a generation_no below 1 and a non-boolean is_new_generation', async () => {
    const db = await dbWithLine();
    await expect(
      insertRaw(db, 'genotyping_records', makeGenotypingRecord({ generation_no: 0 })),
    ).rejects.toThrow(/CHECK/);
    await expect(
      insertRaw(db, 'genotyping_records', makeGenotypingRecord({ is_new_generation: 2 })),
    ).rejects.toThrow(/CHECK/);
  });

  it('rejects an invalid line status on update as well as insert', async () => {
    const db = await dbWithLine();
    await expect(
      db.prepare("UPDATE lines SET status = 'Archived' WHERE id = 'line-1'").run(),
    ).rejects.toThrow(/CHECK/);
  });

  it('rejects unknown protocol types, roles, and other closed vocabularies', async () => {
    const db = await dbWithLine();
    await expect(
      insertRaw(db, 'id_protocols', makeProtocol({ protocol_type: 'western_blot' as 'pcr' })),
    ).rejects.toThrow(/CHECK/);
    await expect(
      insertRaw(db, 'users', {
        id: 'u-x',
        name: 'Nobody',
        role: 'owner',
        created_at: 't',
        updated_at: 't',
      }),
    ).rejects.toThrow(/CHECK/);
    await expect(
      insertRaw(db, 'attachments', makeAttachment({ kind: 'video' as 'other' })),
    ).rejects.toThrow(/CHECK/);
    await expect(
      insertRaw(db, 'attachments', makeAttachment({ owner_type: 'user' as 'line' })),
    ).rejects.toThrow(/CHECK/);
    await expect(
      insertRaw(db, 'line_versions', makeVersion({ change_type: 'deleted' as 'edited' })),
    ).rejects.toThrow(/CHECK/);
    await expect(
      insertRaw(db, 'activities', makeActivity({ type: 'logged_in' as 'edited' })),
    ).rejects.toThrow(/CHECK/);
    await expect(
      insertRaw(db, 'chat_messages', makeChatMessage({ request_status: 'pending' as 'open' })),
    ).rejects.toThrow(/CHECK/);
    await expect(
      insertRaw(db, 'mirror_runs', { id: 'm1', kind: 'hourly', status: 'ok', started_at: 't' }),
    ).rejects.toThrow(/CHECK/);
    await expect(
      insertRaw(db, 'import_runs', { id: 'i1', mode: 'preview', started_at: 't' }),
    ).rejects.toThrow(/CHECK/);
  });

  it('accepts every documented activity type', async () => {
    const db = await dbWithLine();
    const types = [
      'created',
      'edited',
      'breeding_started',
      'genotyping_same_gen',
      'genotyping_new_gen',
      'closed',
      'reopened',
      'protocol_changed',
      'cryo_changed',
      'reference_changed',
      'restored',
      'imported',
      'chat_posted',
      'request_opened',
      'request_done',
      'user_added',
      'user_deactivated',
      'settings_changed',
      'mirror_failed',
    ] as const;
    for (const [index, type] of types.entries()) {
      await insertRaw(db, 'activities', makeActivity({ id: `act-${String(index)}`, type }));
    }
  });

  it('rejects invalid JSON in id_protocols.fields, line_versions.snapshot and diff', async () => {
    const db = await dbWithLine();
    await expect(
      insertRaw(db, 'id_protocols', makeProtocol({ fields: 'not json' })),
    ).rejects.toThrow(/CHECK/);
    await expect(
      insertRaw(db, 'line_versions', makeVersion({ snapshot: '{oops' })),
    ).rejects.toThrow(/CHECK/);
    await expect(
      insertRaw(db, 'line_versions', makeVersion({ diff: '[not json' })),
    ).rejects.toThrow(/CHECK/);
  });
});

describe('uniqueness and foreign keys', () => {
  it('keeps version numbers unique per line', async () => {
    const db = await dbWithLine();
    await insertRaw(db, 'line_versions', makeVersion({ id: 'v1', version_no: 1 }));
    await expect(
      insertRaw(db, 'line_versions', makeVersion({ id: 'v2', version_no: 1 })),
    ).rejects.toThrow(/UNIQUE/);
    await expect(
      insertRaw(db, 'line_versions', makeVersion({ id: 'v3', version_no: 2 })),
    ).resolves.toBeDefined();
    await insertRaw(db, 'lines', makeLine({ id: 'line-2', name: 'DEMO_E5' }));
    await expect(
      insertRaw(db, 'line_versions', makeVersion({ id: 'v4', line_id: 'line-2', version_no: 1 })),
    ).resolves.toBeDefined();
  });

  it('rejects children of a line that does not exist', async () => {
    const db = createMigratedDb();
    const orphan = { line_id: 'missing' };
    await expect(insertRaw(db, 'cryo_records', makeCryoRecord(orphan))).rejects.toThrow(
      /FOREIGN KEY/,
    );
    await expect(insertRaw(db, 'line_references', makeReference(orphan))).rejects.toThrow(
      /FOREIGN KEY/,
    );
    await expect(insertRaw(db, 'genotyping_records', makeGenotypingRecord(orphan))).rejects.toThrow(
      /FOREIGN KEY/,
    );
    await expect(insertRaw(db, 'id_protocols', makeProtocol(orphan))).rejects.toThrow(
      /FOREIGN KEY/,
    );
    await expect(insertRaw(db, 'line_versions', makeVersion(orphan))).rejects.toThrow(
      /FOREIGN KEY/,
    );
    await expect(insertRaw(db, 'activities', makeActivity(orphan))).rejects.toThrow(/FOREIGN KEY/);
    await expect(insertRaw(db, 'chat_messages', makeChatMessage(orphan))).rejects.toThrow(
      /FOREIGN KEY/,
    );
  });

  it('allows a lab-wide chat message and an activity with no line', async () => {
    const db = createMigratedDb();
    await expect(
      insertRaw(db, 'chat_messages', makeChatMessage({ line_id: null })),
    ).resolves.toBeDefined();
    await expect(
      insertRaw(db, 'activities', makeActivity({ line_id: null, type: 'user_added' })),
    ).resolves.toBeDefined();
  });

  it('rejects a genotyping record that names an unknown protocol', async () => {
    const db = await dbWithLine();
    await expect(
      insertRaw(db, 'genotyping_records', makeGenotypingRecord({ protocol_id: 'missing' })),
    ).rejects.toThrow(/FOREIGN KEY/);
    await insertRaw(db, 'id_protocols', makeProtocol());
    await expect(
      insertRaw(db, 'genotyping_records', makeGenotypingRecord({ protocol_id: 'proto-1' })),
    ).resolves.toBeDefined();
  });

  // Documents plain SQLite behaviour only. Hosted D1 does NOT honour the deferral (T-004), so
  // application code must not rely on it -- see docs/03-data-model.md section 7 for the write order.
  it('lets a line and its first protocol be created in one batch (deferred foreign key, SQLite only)', async () => {
    const db = createMigratedDb();
    const line = makeLine({ current_protocol_id: 'proto-1' });
    const insertLine = (row: typeof line) =>
      db
        .prepare(
          `INSERT INTO lines (id, name, status, current_protocol_id, created_at, created_by, updated_at, updated_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          row.id,
          row.name,
          row.status,
          row.current_protocol_id,
          row.created_at,
          row.created_by,
          row.updated_at,
          row.updated_by,
        );
    const insertProtocol = () =>
      db.prepare(
        `INSERT INTO id_protocols (id, line_id, protocol_type, label, fields, created_at, updated_at)
           VALUES ('proto-1', 'line-1', 'pcr', 'PCR', '{}', 't', 't')`,
      );
    await db.batch([insertLine(line), insertProtocol()]);
    const stored = await db
      .prepare("SELECT current_protocol_id FROM lines WHERE id = 'line-1'")
      .first<{ current_protocol_id: string }>();
    expect(stored?.current_protocol_id).toBe('proto-1');
  });

  it('rejects a line whose current protocol never appears (checked at commit)', async () => {
    const db = createMigratedDb();
    await expect(
      db.batch([
        db
          .prepare(
            `INSERT INTO lines (id, name, status, current_protocol_id, created_at, created_by, updated_at, updated_by)
             VALUES ('line-1', 'demo_c3', 'Current', 'ghost', 't', ?, 't', ?)`,
          )
          .bind(USER_ID.bob, USER_ID.bob),
      ]),
    ).rejects.toThrow(/FOREIGN KEY/);
    const count = await db.prepare('SELECT count(*) AS n FROM lines').first<{ n: number }>();
    expect(count?.n).toBe(0);
  });

  it('rolls back the whole batch when one statement fails', async () => {
    const db = createMigratedDb();
    const insert = (id: string, name: string) =>
      db
        .prepare(
          `INSERT INTO lines (id, name, status, created_at, created_by, updated_at, updated_by)
           VALUES (?, ?, 'Current', 't', ?, 't', ?)`,
        )
        .bind(id, name, USER_ID.bob, USER_ID.bob);
    await expect(db.batch([insert('a', 'demo_c3'), insert('b', 'DEMO_C3')])).rejects.toThrow(
      /UNIQUE/,
    );
    const count = await db.prepare('SELECT count(*) AS n FROM lines').first<{ n: number }>();
    expect(count?.n).toBe(0);
  });

  it('keeps the attachment link of a reference a real attachment', async () => {
    const db = await dbWithLine();
    await expect(
      insertRaw(db, 'line_references', makeReference({ attachment_id: 'nope' })),
    ).rejects.toThrow(/FOREIGN KEY/);
    await insertRaw(db, 'attachments', makeAttachment({ owner_type: 'line', owner_id: 'line-1' }));
    await expect(
      insertRaw(db, 'line_references', makeReference({ attachment_id: 'att-1' })),
    ).resolves.toBeDefined();
  });

  it('keeps R2 keys unique', async () => {
    const db = await dbWithLine();
    await insertRaw(db, 'attachments', makeAttachment());
    await expect(insertRaw(db, 'attachments', makeAttachment({ id: 'att-2' }))).rejects.toThrow(
      /UNIQUE/,
    );
  });

  it('allows one read receipt per message and user', async () => {
    const db = await dbWithLine();
    await insertRaw(db, 'chat_messages', makeChatMessage());
    const read = { message_id: 'msg-1', user_id: USER_ID.carol, read_at: 't' };
    await insertRaw(db, 'chat_reads', read);
    await expect(insertRaw(db, 'chat_reads', read)).rejects.toThrow(/UNIQUE|PRIMARY KEY/);
    await expect(
      insertRaw(db, 'chat_reads', { ...read, user_id: USER_ID.dan }),
    ).resolves.toBeDefined();
  });
});

describe('Admin-author guard (BR-5)', () => {
  it('rejects a chat message written as Admin and stores nothing', async () => {
    const db = await dbWithLine();
    await expect(
      insertChatMessage(db, makeChatMessage({ user_id: USER_ID.admin, via_admin: 1 })),
    ).rejects.toThrow(AdminAuthorError);
    expect(await getChatMessageById(db, 'msg-1')).toBeNull();
  });

  it('accepts members and Guest, keeping via_admin for the audit trail', async () => {
    const db = await dbWithLine();
    await insertChatMessage(db, makeChatMessage({ id: 'm-member', user_id: USER_ID.carol }));
    await insertChatMessage(db, makeChatMessage({ id: 'm-guest', user_id: USER_ID.guest }));
    await insertChatMessage(
      db,
      makeChatMessage({ id: 'm-via', user_id: USER_ID.alice, via_admin: 1 }),
    );
    expect((await getChatMessageById(db, 'm-member'))?.user_id).toBe(USER_ID.carol);
    expect((await getChatMessageById(db, 'm-guest'))?.user_id).toBe(USER_ID.guest);
    expect((await getChatMessageById(db, 'm-via'))?.via_admin).toBe(1);
  });

  it('still rejects an unknown author through the foreign key', async () => {
    const db = await dbWithLine();
    await expect(insertChatMessage(db, makeChatMessage({ user_id: 'nobody' }))).rejects.toThrow(
      /FOREIGN KEY/,
    );
  });
});
