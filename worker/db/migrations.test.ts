import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { EnumerationRow, SettingRow, UserRow } from './types';
import { createMigratedDb, migrationFiles, MIGRATIONS_DIR } from './testing/testDb';

const BOB = '01H00000000000000000000003';

async function insertLine(db: ReturnType<typeof createMigratedDb>, id: string, name: string) {
  return db
    .prepare(
      `INSERT INTO lines (id, name, status, created_at, created_by, updated_at, updated_by)
       VALUES (?, ?, 'Current', '2026-09-28T00:00:00Z', ?, '2026-09-28T00:00:00Z', ?)`,
    )
    .bind(id, name, BOB, BOB)
    .run();
}

describe('migration files', () => {
  it('are numbered consecutively from 0001', () => {
    const numbers = migrationFiles().map((file) => Number(file.slice(0, 4)));
    expect(numbers).toEqual(numbers.map((_, index) => index + 1));
  });

  it('T-017 migration is idempotent and backfills existing read marks', async () => {
    const db = createMigratedDb();
    await db
      .prepare(
        `INSERT INTO chat_messages (id, line_id, user_id, via_admin, body, created_at)
         VALUES ('old-message', NULL, ?, 0, 'Existing message', '2026-09-29T12:00:00Z')`,
      )
      .bind(BOB)
      .run();
    await db
      .prepare('INSERT INTO chat_reads (message_id, user_id, read_at) VALUES (?, ?, ?)')
      .bind('old-message', BOB, '2026-09-29T12:01:00Z')
      .run();
    const migration = readFileSync(`${MIGRATIONS_DIR}0007_chat_read_revocation.sql`, 'utf8');
    db.sqlite.exec(migration);
    db.sqlite.exec(migration);
    expect(
      await db
        .prepare('SELECT message_id, user_id, read_at, deleted_at FROM chat_read_state')
        .first<{
          message_id: string;
          user_id: string;
          read_at: string;
          deleted_at: string | null;
        }>(),
    ).toEqual({
      message_id: 'old-message',
      user_id: BOB,
      read_at: '2026-09-29T12:01:00Z',
      deleted_at: null,
    });
  });

  it('T-017 mentions keep edited recipients with soft deletes', async () => {
    const db = createMigratedDb();
    const bob = '01H00000000000000000000003';
    const guest = '01H00000000000000000000006';
    await db
      .prepare(
        `INSERT INTO chat_messages (id, line_id, user_id, via_admin, body, created_at)
         VALUES ('mention-message', NULL, ?, 0, '@Guest hello', '2026-09-29T12:00:00Z')`,
      )
      .bind(bob)
      .run();
    await db
      .prepare(
        `INSERT INTO chat_mentions (id, message_id, user_id, created_at)
         VALUES ('mention-old', 'mention-message', ?, '2026-09-29T12:00:00Z')`,
      )
      .bind(guest)
      .run();
    await db
      .prepare(
        "UPDATE chat_mentions SET deleted_at = '2026-09-29T12:01:00Z' WHERE id = 'mention-old'",
      )
      .run();
    await db
      .prepare(
        `INSERT INTO chat_mentions (id, message_id, user_id, created_at)
         VALUES ('mention-new', 'mention-message', ?, '2026-09-29T12:01:00Z')`,
      )
      .bind(guest)
      .run();
    expect(
      await db
        .prepare('SELECT id FROM chat_mentions WHERE message_id = ? AND deleted_at IS NULL')
        .bind('mention-message')
        .first<{ id: string }>(),
    ).toEqual({ id: 'mention-new' });
  });
});

describe('core tables and seeds', () => {
  it('loads test members plus an inactive former member and built-in Guest; the built-in Admin is retired (0010)', async () => {
    const db = createMigratedDb();
    const { results } = await db.prepare('SELECT * FROM users ORDER BY name').all<UserRow>();
    const summary = results.map((u) => [u.name, u.role, u.is_active, u.is_builtin]);
    const expected = [
      ['Admin', 'admin', 0, 1],
      ['Erin', 'member', 0, 0],
      ['Guest', 'guest', 1, 1],
      ['Dan', 'member', 1, 0],
      ['Carol', 'member', 1, 0],
      ['Bob', 'member', 1, 0],
      ['Alice', 'member', 1, 0],
    ];
    expect(summary.map((row) => JSON.stringify(row)).sort()).toEqual(
      expected.map((row) => JSON.stringify(row)).sort(),
    );
  });

  it('seeds the enumerations, including the Source attribute key', async () => {
    const db = createMigratedDb();
    const { results } = await db
      .prepare('SELECT * FROM enumerations ORDER BY kind, sort_order')
      .all<EnumerationRow>();
    const byKind = (kind: string) => results.filter((e) => e.kind === kind).map((e) => e.value);
    expect(byKind('id_method_type')).toEqual([
      'None',
      'Tails',
      'PCR',
      'PCR + Sequence',
      'Fluorescence',
      'Custom',
    ]);
    expect(byKind('fluorophore')).toEqual(['GFP', 'mCherry', 'DsRed']);
    expect(byKind('cryo_place')).toEqual(['Demo freezer shelf', 'External storage']);
    expect(byKind('request_type')).toEqual([
      'Set up cross',
      'Genotyping',
      'Experimental use',
      'Other',
    ]);
    expect(byKind('attribute_key')).toEqual(['Source']);
    expect(results.every((e) => e.is_active === 1)).toBe(true);
  });

  it('seeds the default settings; the retired passphrase and Admin password are gone (0010)', async () => {
    const db = createMigratedDb();
    const { results } = await db.prepare('SELECT * FROM settings').all<SettingRow>();
    const settings = Object.fromEntries(results.map((s) => [s.key, s.value]));
    expect(settings['upcoming_breeding_months']).toBe('11');
    expect(settings['default_annealing_c']).toBe('60');
    expect(settings['default_cycles']).toBe('35');
    expect('lab_passphrase_hash' in settings).toBe(false);
    expect('admin_password_hash' in settings).toBe(false);
  });

  it('rejects a second line whose name differs only in case or surrounding spaces (BR-8)', async () => {
    const db = createMigratedDb();
    await insertLine(db, 'L1', 'demo_c3');
    await expect(insertLine(db, 'L2', ' DEMO_C3 ')).rejects.toThrow(/UNIQUE/);
    await expect(insertLine(db, 'L3', 'demo_c3')).rejects.toThrow(/UNIQUE/);
    await expect(insertLine(db, 'L4', 'demo_c30')).resolves.toBeDefined();
  });

  it('rejects empty and over-long line names (BR-8)', async () => {
    const db = createMigratedDb();
    await expect(insertLine(db, 'L1', '   ')).rejects.toThrow(/CHECK/);
    await expect(insertLine(db, 'L2', 'x'.repeat(61))).rejects.toThrow(/CHECK/);
    await expect(insertLine(db, 'L3', 'x'.repeat(60))).resolves.toBeDefined();
  });

  it('rejects an invalid line status', async () => {
    const db = createMigratedDb();
    await expect(
      db
        .prepare(
          `INSERT INTO lines (id, name, status, created_at, created_by, updated_at, updated_by)
           VALUES ('L1', 'a', 'Retired', 't', ?, 't', ?)`,
        )
        .bind(BOB, BOB)
        .run(),
    ).rejects.toThrow(/CHECK/);
  });

  it('enforces foreign keys: a line needs an existing creator', async () => {
    const db = createMigratedDb();
    await expect(
      db
        .prepare(
          `INSERT INTO lines (id, name, status, created_at, created_by, updated_at, updated_by)
           VALUES ('L1', 'a', 'Current', 't', 'nobody', 't', 'nobody')`,
        )
        .run(),
    ).rejects.toThrow(/FOREIGN KEY/);
  });

  it('allows one live attribute per (line, key) and a new one after a soft delete', async () => {
    const db = createMigratedDb();
    await insertLine(db, 'L1', 'demo_c3');
    const insertAttr = (id: string, key: string) =>
      db
        .prepare(
          "INSERT INTO line_attributes (id, line_id, key, value) VALUES (?, 'L1', ?, 'REPOSITORY A')",
        )
        .bind(id, key)
        .run();
    await insertAttr('A1', 'Source');
    await expect(insertAttr('A2', 'Source')).rejects.toThrow(/UNIQUE/);
    await insertAttr('A3', 'Tank');
    await db.prepare("UPDATE line_attributes SET deleted_at = 't' WHERE id = 'A1'").run();
    await expect(insertAttr('A4', 'Source')).resolves.toBeDefined();
  });

  it('has no source column on lines (OQ-20)', async () => {
    const db = createMigratedDb();
    const { results } = await db.prepare('PRAGMA table_info(lines)').all<{ name: string }>();
    expect(results.map((c) => c.name)).not.toContain('source');
  });
});

describe('migration 0011 (imported task messages leave the chat)', () => {
  it('removes "[Imported task]" messages with their marks and activities, and nothing else', () => {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec('PRAGMA foreign_keys = ON');
    const files = migrationFiles();
    const before = files.filter((file) => file < '0011');
    for (const file of before) sqlite.exec(readFileSync(MIGRATIONS_DIR + file, 'utf8'));
    sqlite.exec(readFileSync(new URL('../../tests/fixtures/users.sql', import.meta.url), 'utf8'));
    const user = BOB;
    sqlite.exec(`INSERT INTO lines (id, name, status, created_at, created_by, updated_at, updated_by)
      VALUES ('L1', 'demo_c3', 'Current', '2026-09-28T00:00:00Z', '${BOB}', '2026-09-28T00:00:00Z', '${BOB}')`);
    for (const [id, body] of [
      ['M-import', '[Imported task] Set Out-cross — USE WT.'],
      ['M-human', 'Please check the tank.'],
    ] as const) {
      sqlite.exec(`INSERT INTO chat_messages (id, line_id, user_id, body, created_at)
        VALUES ('${id}', 'L1', '${user}', '${body}', '2026-01-02T00:00:00Z')`);
      sqlite.exec(
        `INSERT INTO chat_reads (message_id, user_id, read_at) VALUES ('${id}', '${user}', '2026-01-03T00:00:00Z')`,
      );
      sqlite.exec(`INSERT INTO activities (id, line_id, user_id, via_admin, type, summary, ref_type, ref_id, created_at)
        VALUES ('A-${id}', 'L1', '${user}', 0, 'chat_posted', 'Chat', 'chat_message', '${id}', '2026-01-02T00:00:00Z')`);
    }
    sqlite.exec(
      readFileSync(MIGRATIONS_DIR + (files.find((file) => file.startsWith('0011')) ?? ''), 'utf8'),
    );
    const ids = (sql: string) =>
      (sqlite.prepare(sql).all() as { id: string }[]).map((row) => row.id);
    expect(ids('SELECT id FROM chat_messages')).toEqual(['M-human']);
    expect(ids('SELECT message_id AS id FROM chat_reads')).toEqual(['M-human']);
    expect(ids("SELECT id FROM activities WHERE ref_type = 'chat_message'")).toEqual(['A-M-human']);
    expect(ids('SELECT id FROM lines')).toEqual(['L1']);
  });
});
