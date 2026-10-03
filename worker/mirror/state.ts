import type { Db } from '../db/db';
import { getSetting, setSetting } from '../db/queries/settings';

const DIRTY = 'mirror_dirty_at';
const RUNNING = 'mirror_running_since';
/** A run that died without releasing the lock is taken over after this long. */
const LOCK_TIMEOUT_MS = 10 * 60 * 1000;

/** Remembers the FIRST write since the last export; later writes keep the older time (debounce). */
export async function markMirrorDirty(db: Db, now: Date): Promise<void> {
  // Most writes find the flag already set: a read is enough, and it keeps the busy database free of extra writes.
  if ((await getSetting(db, DIRTY)) !== null) return;
  await db
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value WHERE settings.value IS NULL`,
    )
    .bind(DIRTY, now.toISOString())
    .run();
}

export const getMirrorDirty = (db: Db): Promise<string | null> => getSetting(db, DIRTY);

/** Clears the flag only if no write came in meanwhile (the flag still holds the time the run started with). */
export async function clearMirrorDirty(db: Db, seen: string | null): Promise<void> {
  if (seen === null) return;
  await db
    .prepare('UPDATE settings SET value = NULL WHERE key = ? AND value = ?')
    .bind(DIRTY, seen)
    .run();
}

/** One run at a time: true when this caller now holds the lock. */
export async function acquireMirrorLock(db: Db, now: Date): Promise<boolean> {
  const stale = new Date(now.getTime() - LOCK_TIMEOUT_MS).toISOString();
  const result = await db
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value
       WHERE settings.value IS NULL OR settings.value < ?`,
    )
    .bind(RUNNING, now.toISOString(), stale)
    .run();
  return result.meta.changes === 1;
}

export const releaseMirrorLock = (db: Db): Promise<unknown> => setSetting(db, RUNNING, null);
