/**
 * The Dropbox mirror target (T-020 Step 2, Mechanism A, docs/06-operations.md §1.4). The app
 * `Fish-Database-Copy` is an App-folder app, so `/` is `Dropbox/Apps/Fish-Database-Copy/`.
 *
 * - A short-lived access token is fetched once per run from the refresh token (PKCE app: no secret).
 * - Before writing into a top folder (`latest`, `archive/<day>`) its files are listed once; a file
 *   whose Dropbox `content_hash` equals ours is skipped, so a run uploads only what changed.
 * - Files over 150 MB go through an upload session (the mirror's files are far smaller in practice).
 * - Error messages carry the endpoint, the HTTP status and Dropbox's error summary — never a token.
 */
import type { MirrorTarget } from './target';

const API = 'https://api.dropboxapi.com';
const CONTENT = 'https://content.dropboxapi.com';
const SIMPLE_UPLOAD_LIMIT = 150 * 1024 * 1024;
const SESSION_CHUNK_DEFAULT = 64 * 1024 * 1024;
const HASH_BLOCK = 4 * 1024 * 1024;

export type Fetch = (input: string, init: RequestInit) => Promise<Response>;

export class DropboxError extends Error {}

const encoder = new TextEncoder();
const toBytes = (body: string | Uint8Array): Uint8Array =>
  typeof body === 'string' ? encoder.encode(body) : body;

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Dropbox's content hash: SHA-256 over the SHA-256 of every 4 MB block. */
export async function dropboxContentHash(bytes: Uint8Array): Promise<string> {
  const blocks: Uint8Array[] = [];
  for (let start = 0; start < bytes.length; start += HASH_BLOCK) {
    blocks.push(
      new Uint8Array(
        await crypto.subtle.digest('SHA-256', bytes.subarray(start, start + HASH_BLOCK)),
      ),
    );
  }
  const joined = new Uint8Array(blocks.length * 32);
  blocks.forEach((block, index) => {
    joined.set(block, index * 32);
  });
  return hex(await crypto.subtle.digest('SHA-256', joined));
}

/** `Dropbox-API-Arg` must be ASCII: other characters are written as \uXXXX (Dropbox's documented rule). */
function apiArg(value: unknown): string {
  return JSON.stringify(value).replace(
    /[\u007f-￿]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

function join(...parts: string[]): string {
  const path = parts
    .flatMap((part) => part.split('/'))
    .filter((part) => part !== '')
    .join('/');
  return `/${path}`;
}

export interface DropboxOptions {
  appKey: string;
  refreshToken: string;
  /** Folder inside the app folder that holds the mirror: `/` for production, `/preview` for preview. */
  root: string;
  fetch?: Fetch;
  /** Tests make these small; the defaults are Dropbox's real limits. */
  simpleUploadLimit?: number;
  sessionChunk?: number;
}

export class DropboxTarget implements MirrorTarget {
  private token: string | null = null;
  private readonly known = new Map<string, Map<string, string>>();
  private readonly fetcher: Fetch;
  private sent = 0;

  constructor(private readonly options: DropboxOptions) {
    const send = options.fetch ?? ((input: string, init: RequestInit) => fetch(input, init));
    this.fetcher = (input, init) => {
      this.sent += 1;
      return send(input, init);
    };
  }

  requests(): number {
    return this.sent;
  }

  private async accessToken(): Promise<string> {
    if (this.token !== null) return this.token;
    const response = await this.fetcher(`${API}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this.options.refreshToken,
        client_id: this.options.appKey,
      }).toString(),
    });
    if (!response.ok) {
      // Dropbox names the reason (e.g. `invalid_grant`: wrong or revoked refresh token); it never echoes the token.
      let reason = '';
      try {
        const body: { error?: unknown; error_description?: unknown } = await response.json();
        if (typeof body.error === 'string') reason = `: ${body.error}`;
        if (typeof body.error_description === 'string')
          reason += ` (${body.error_description.slice(0, 120)})`;
      } catch {
        /* not JSON */
      }
      throw new DropboxError(`Dropbox sign-in failed (HTTP ${String(response.status)})${reason}.`);
    }
    const body: { access_token?: unknown } = await response.json();
    if (typeof body.access_token !== 'string')
      throw new DropboxError('Dropbox sign-in returned no access token.');
    this.token = body.access_token;
    return this.token;
  }

  private async call(
    url: string,
    init: { json?: unknown; arg?: unknown; bytes?: Uint8Array },
  ): Promise<Response> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${await this.accessToken()}`,
    };
    let body: BodyInit | null = null;
    if (init.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(init.json);
    }
    if (init.arg !== undefined) {
      headers['Dropbox-API-Arg'] = apiArg(init.arg);
      headers['Content-Type'] = 'application/octet-stream';
      body = init.bytes ?? new Uint8Array();
    }
    return this.fetcher(url, { method: 'POST', headers, body });
  }

  private async fail(endpoint: string, response: Response): Promise<never> {
    let summary = '';
    try {
      const body: { error_summary?: unknown } = await response.json();
      if (typeof body.error_summary === 'string') summary = `: ${body.error_summary}`;
    } catch {
      /* not JSON */
    }
    throw new DropboxError(
      `Dropbox ${endpoint} failed (HTTP ${String(response.status)})${summary}`,
    );
  }

  /** Every file under a folder (recursive), as lower-case path → content hash. Missing folder = empty. */
  private async listFiles(folder: string, recursive = true): Promise<Map<string, string>> {
    const files = new Map<string, string>();
    let response = await this.call(`${API}/2/files/list_folder`, {
      json: { path: folder, recursive },
    });
    for (;;) {
      if (response.status === 409) {
        const text = await response.text();
        if (text.includes('not_found')) return files;
        throw new DropboxError(`Dropbox list_folder failed (HTTP 409): ${text.slice(0, 200)}`);
      }
      if (!response.ok) return this.fail('list_folder', response);
      const page: {
        entries: { '.tag': string; path_lower: string; name: string; content_hash?: string }[];
        cursor: string;
        has_more: boolean;
      } = await response.json();
      for (const entry of page.entries)
        if (entry['.tag'] === 'file') files.set(entry.path_lower, entry.content_hash ?? '');
      if (!page.has_more) return files;
      response = await this.call(`${API}/2/files/list_folder/continue`, {
        json: { cursor: page.cursor },
      });
    }
  }

  /** The known files of the top folder a path belongs to (`latest`, or `archive/<day>`). */
  private async knownFor(path: string): Promise<Map<string, string>> {
    const parts = path.split('/');
    // A file at the top of the copy (README.txt): list that folder alone, never the images below it.
    const flat = parts.length === 1;
    const top = join(
      this.options.root,
      ...(flat ? [] : parts[0] === 'archive' ? parts.slice(0, 2) : parts.slice(0, 1)),
    );
    const key = flat ? `${top}\0flat` : top;
    let known = this.known.get(key);
    if (known === undefined) {
      known = await this.listFiles(top, !flat);
      this.known.set(key, known);
    }
    return known;
  }

  /** True when the file is already there (any content): images never change once stored. */
  async has(path: string): Promise<boolean> {
    return (await this.knownFor(path)).has(join(this.options.root, path).toLowerCase());
  }

  async put(path: string, body: string | Uint8Array): Promise<boolean> {
    const bytes = toBytes(body);
    const full = join(this.options.root, path);
    const known = await this.knownFor(path);
    const hash = await dropboxContentHash(bytes);
    if (known.get(full.toLowerCase()) === hash) return false;
    if (bytes.length <= (this.options.simpleUploadLimit ?? SIMPLE_UPLOAD_LIMIT)) {
      const response = await this.call(`${CONTENT}/2/files/upload`, {
        arg: { path: full, mode: 'overwrite', mute: true },
        bytes,
      });
      if (!response.ok) await this.fail('upload', response);
    } else {
      await this.uploadSession(full, bytes);
    }
    known.set(full.toLowerCase(), hash);
    return true;
  }

  private async uploadSession(full: string, bytes: Uint8Array): Promise<void> {
    const SESSION_CHUNK = this.options.sessionChunk ?? SESSION_CHUNK_DEFAULT;
    const start = await this.call(`${CONTENT}/2/files/upload_session/start`, {
      arg: { close: false },
      bytes: bytes.subarray(0, SESSION_CHUNK),
    });
    if (!start.ok) await this.fail('upload_session/start', start);
    const { session_id: sessionId }: { session_id: string } = await start.json();
    let offset = Math.min(SESSION_CHUNK, bytes.length);
    while (bytes.length - offset > SESSION_CHUNK) {
      const append = await this.call(`${CONTENT}/2/files/upload_session/append_v2`, {
        arg: { cursor: { session_id: sessionId, offset }, close: false },
        bytes: bytes.subarray(offset, offset + SESSION_CHUNK),
      });
      if (!append.ok) await this.fail('upload_session/append_v2', append);
      offset += SESSION_CHUNK;
    }
    const finish = await this.call(`${CONTENT}/2/files/upload_session/finish`, {
      arg: {
        cursor: { session_id: sessionId, offset },
        commit: { path: full, mode: 'overwrite', mute: true },
      },
      bytes: bytes.subarray(offset),
    });
    if (!finish.ok) await this.fail('upload_session/finish', finish);
  }

  async list(folder: string): Promise<string[]> {
    const names = new Set<string>();
    let response = await this.call(`${API}/2/files/list_folder`, {
      json: { path: join(this.options.root, folder), recursive: false },
    });
    for (;;) {
      if (response.status === 409) return [...names];
      if (!response.ok) return this.fail('list_folder', response);
      const page: { entries: { name: string }[]; cursor: string; has_more: boolean } =
        await response.json();
      for (const entry of page.entries) names.add(entry.name);
      if (!page.has_more) return [...names];
      response = await this.call(`${API}/2/files/list_folder/continue`, {
        json: { cursor: page.cursor },
      });
    }
  }

  async remove(path: string): Promise<void> {
    const response = await this.call(`${API}/2/files/delete_v2`, {
      json: { path: join(this.options.root, path) },
    });
    if (!response.ok && response.status !== 409) await this.fail('delete_v2', response);
  }
}
