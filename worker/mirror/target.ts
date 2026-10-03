/**
 * Where the mirror writes (T-020). The runner only knows this small interface, so tests use an
 * in-memory folder and `DropboxTarget` is the real implementation.
 * Paths are relative to the mirror folder, e.g. `latest/lines.csv`, `archive/2026-10-05/lines.csv`.
 */
import type { Db } from '../db/db';
import { getSetting } from '../db/queries/settings';
import { DropboxTarget } from './dropbox';

export interface MirrorTarget {
  /** Creates or overwrites one file; false when the same content is already there (nothing sent). */
  put(path: string, body: string | Uint8Array): Promise<boolean>;
  /** True when a file exists at the path (used for images, which never change once stored). */
  has(path: string): Promise<boolean>;
  /** Names of the direct children of a folder (empty when the folder does not exist). */
  list(folder: string): Promise<string[]>;
  /** Removes a file or a whole folder. */
  remove(path: string): Promise<void>;
  /** Outgoing requests so far: the free plan allows 50 per invocation, so the runner stops early. */
  requests(): number;
}

/** What the Worker needs from its environment to reach the mirror folder. */
export interface MirrorEnv {
  APP_NAME?: string;
  DROPBOX_APP_KEY?: string;
  DROPBOX_REFRESH_TOKEN?: string;
  /** Folder inside the Dropbox app folder: `/` (production) or `/preview` (wrangler.toml vars). */
  MIRROR_FOLDER?: string;
}

/**
 * The configured target, or null while the mirror is not set up (no secrets): the cron then does
 * nothing. The folder is `settings.mirror_folder_path` when the Admin set one, else `MIRROR_FOLDER`.
 */
export async function targetFromEnv(env: MirrorEnv, db: Db): Promise<MirrorTarget | null> {
  if (!env.DROPBOX_APP_KEY || !env.DROPBOX_REFRESH_TOKEN) return null;
  const root = (await getSetting(db, 'mirror_folder_path')) ?? env.MIRROR_FOLDER ?? '/';
  return new DropboxTarget({
    appKey: env.DROPBOX_APP_KEY,
    refreshToken: env.DROPBOX_REFRESH_TOKEN,
    root,
  });
}
