import type { Db } from '../db';
import type { SettingRow } from '../types';

export async function getSetting(db: Db, key: string): Promise<string | null> {
  const row = await db
    .prepare('SELECT value FROM settings WHERE key = ?')
    .bind(key)
    .first<Pick<SettingRow, 'value'>>();
  return row?.value ?? null;
}

export async function listSettings(db: Db): Promise<SettingRow[]> {
  const { results } = await db.prepare('SELECT * FROM settings ORDER BY key').all<SettingRow>();
  return results;
}

/** Inserts the key or replaces its value. */
export function setSetting(db: Db, key: string, value: string | null): Promise<unknown> {
  return db
    .prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
    )
    .bind(key, value)
    .run();
}
