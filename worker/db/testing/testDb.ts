import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { SqliteD1 } from './sqliteD1';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations/', import.meta.url));
const TEST_USERS = fileURLToPath(new URL('../../../tests/fixtures/users.sql', import.meta.url));

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();
}

/** A fresh in-memory database with every migration applied in order (foreign keys on). */
export function createMigratedDb(): SqliteD1 {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  for (const file of migrationFiles()) {
    sqlite.exec(readFileSync(MIGRATIONS_DIR + file, 'utf8'));
  }
  // Demo people belong to tests and local development, not the public production migrations.
  sqlite.exec(readFileSync(TEST_USERS, 'utf8'));
  return new SqliteD1(sqlite);
}

/** Test-only raw insert: builds the statement from the object's keys. Never use outside tests. */
export function insertRaw(db: SqliteD1, table: string, row: object): Promise<unknown> {
  const entries = Object.entries(row as Record<string, unknown>);
  const columns = entries.map(([key]) => key).join(', ');
  const placeholders = entries.map(() => '?').join(', ');
  return db
    .prepare(`INSERT INTO ${table} (${columns}) VALUES (${placeholders})`)
    .bind(...entries.map(([, value]) => value))
    .run();
}
