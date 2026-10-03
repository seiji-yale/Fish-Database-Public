/**
 * `/api/admin/*` (T-018, FR-ADM-01…05, U-1): everything an Admin runs without a developer — people and
 * their invites, the Guest URL, pick-lists, settings, deleted items, and the export. Every route needs
 * a signed-in user with the admin role (`requireAdmin`, ADR-0005). Changes are recorded as activities
 * (`user_added`, `user_deactivated`, `settings_changed`) authored by that Admin (BR-5).
 */
import { Hono } from 'hono';
import {
  addEnumerationSchema,
  addUserSchema,
  adminMessages,
  EDITABLE_KINDS,
  ENUMERATION_KINDS,
  nameTaken,
  inviteSchema,
  readOnlySchema,
  settingsSchema,
  updateEnumerationSchema,
  updateUserSchema,
  validateAdmin,
  type AdminValidation,
} from '../../domain/admin';
import type { ResolvedAuthor } from '../../domain/types';
import type { Db, DbStatement } from '../db/db';
import { newId, nowIso } from '../db/ids';
import { insertActivityStatement } from '../db/queries/activities';
import { listEnumerations } from '../db/queries/enumerations';
import { getSetting } from '../db/queries/settings';
import { getUserById, getUserByName, listUsers } from '../db/queries/users';
import type { ActivityType, EnumerationKind } from '../db/types';
import { actingUser, requireAuthor } from '../lib/attribution';
import { appDisplayName } from '../lib/appName';
import { DELETED_TYPES, deletedItems, restoreDeleted } from '../lib/adminDeleted';
import { newInvite, randomToken } from '../lib/accounts';
import { buildExportFiles, buildExportZip } from '../export/build';
import { exportLinesCsv } from '../export/linesCsv';
import { buildSnapshotHtml } from '../export/snapshot';
import { isReadOnly } from '../lib/readOnly';
import { runMirror } from '../mirror/run';
import { targetFromEnv } from '../mirror/target';
import { ApiError } from '../lib/errors';
import { messages } from '../lib/messages';
import { hashPassword } from '../lib/passwords';
import type { Bindings } from '../middleware/session';

export const adminRoutes = new Hono<{ Bindings: Bindings }>();

type Ctx = Parameters<typeof actingUser>[0];

async function requireAdmin(c: Ctx): Promise<void> {
  const acting = await actingUser(c);
  if (acting.role !== 'admin') throw new ApiError(403, 'ADMIN_ONLY', messages.adminOnly);
}

adminRoutes.use('/admin/*', async (c, next) => {
  await requireAdmin(c as Ctx);
  return next();
});

async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await request.json();
    if (body !== null && typeof body === 'object' && !Array.isArray(body))
      return body as Record<string, unknown>;
  } catch {
    /* fall through */
  }
  throw new ApiError(400, 'INVALID_INPUT', messages.invalidInput);
}

function invalid(errors: Record<string, string>): ApiError {
  return new ApiError(400, 'INVALID_INPUT', messages.invalidInput, undefined, { fields: errors });
}

function valid<T>(result: AdminValidation<T>): T {
  if (!result.ok) throw invalid(result.errors);
  return result.value;
}

/** The body without the attribution answer, and the lab member recorded as the author (BR-5). */
async function authorAndForm(c: Ctx) {
  const body = await readBody(c.req.raw);
  const author = await requireAuthor(c, 'data');
  const form = { ...body };
  delete form['chosenUserId'];
  return { author, form };
}

async function activity(
  db: Db,
  author: ResolvedAuthor,
  type: ActivityType,
  summary: string,
  ref?: { type: string; id: string },
  lineId: string | null = null,
): Promise<DbStatement> {
  return insertActivityStatement(db, {
    id: newId(),
    line_id: lineId,
    user_id: author.authorId,
    via_admin: author.viaAdmin ? 1 : 0,
    type,
    summary,
    ref_type: ref?.type ?? null,
    ref_id: ref?.id ?? null,
    created_at: nowIso(),
  });
}

// --- Overview ---------------------------------------------------------------------------------

adminRoutes.get('/admin/overview', async (c) => {
  const db = c.env.DB;
  const [users, settings, importReport, mirrorOk, mirrorError, mirrorInfo] = await Promise.all([
    listUsers(db, { includeInactive: true }),
    Promise.all(
      ['upcoming_breeding_months', 'default_annealing_c', 'default_cycles', 'app_name'].map((key) =>
        getSetting(db, key),
      ),
    ),
    getSetting(db, 'import_report_md'),
    getSetting(db, 'mirror_last_ok_at'),
    getSetting(db, 'mirror_last_error'),
    mirrorOverview(c.env),
  ]);
  const lists = await Promise.all(
    ENUMERATION_KINDS.map(async (kind) => ({
      kind,
      editable: EDITABLE_KINDS.includes(kind),
      entries: (await listEnumerations(db, kind, { includeInactive: true })).map((row) => ({
        id: row.id,
        value: row.value,
        isActive: row.is_active === 1,
      })),
    })),
  );
  return c.json({
    users: users.map((user) => ({
      id: user.id,
      name: user.name,
      role: user.role,
      isActive: user.is_active === 1,
      isBuiltin: user.is_builtin === 1,
      // Waiting for the first sign-in through an invite, or never invited (ADR-0005).
      invitePending: user.must_change_password === 1,
      canSignIn: user.password_hash !== null,
    })),
    lists,
    settings: {
      databaseName: appDisplayName(settings[3] ?? c.env.APP_NAME),
      upcomingBreedingMonths: Number(settings[0] ?? '11'),
      defaultAnnealingC: Number(settings[1] ?? '60'),
      defaultCycles: Number(settings[2] ?? '35'),
    },
    importReport,
    readOnly: await isReadOnly(db),
    mirror: { lastOkAt: mirrorOk, lastError: mirrorError, ...mirrorInfo },
  });
});

// --- Dropbox mirror ---------------------------------------------------------------------------

/** What Data & Backup shows besides the last result: is it connected, where, what is waiting, the last runs. */
async function mirrorOverview(env: Bindings) {
  const db = env.DB;
  const [tick, folder, dirty, runs] = await Promise.all([
    getSetting(db, 'mirror_last_tick_at'),
    getSetting(db, 'mirror_folder_path'),
    getSetting(db, 'mirror_dirty_at'),
    db
      .prepare(
        `SELECT kind, status, started_at, finished_at, files_written, error FROM mirror_runs
         ORDER BY started_at DESC, rowid DESC LIMIT 5`,
      )
      .all<{
        kind: string;
        status: string;
        started_at: string;
        finished_at: string | null;
        files_written: number;
        error: string | null;
      }>(),
  ]);
  return {
    connected: Boolean(env.DROPBOX_APP_KEY && env.DROPBOX_REFRESH_TOKEN),
    folder: folder ?? env.MIRROR_FOLDER ?? '/',
    lastTickAt: tick,
    pending: dirty !== null,
    runs: runs.results.map((run) => ({
      kind: run.kind,
      status: run.status,
      startedAt: run.started_at,
      finishedAt: run.finished_at,
      filesWritten: run.files_written,
      error: run.error,
    })),
  };
}

/** "Export now": runs the Dropbox copy right away, in the request (the Admin waits for the answer). */
adminRoutes.post('/admin/mirror/run', async (c) => {
  const { author } = await authorAndForm(c);
  const configuredAppName = await getSetting(c.env.DB, 'app_name');
  const target = await targetFromEnv(c.env, c.env.DB);
  if (target === null)
    throw new ApiError(
      409,
      'MIRROR_NOT_SET_UP',
      messages.mirrorNotSetUp,
      messages.mirrorNotSetUpHint,
    );
  const result = await runMirror({
    db: c.env.DB,
    target,
    kind: 'manual',
    now: new Date(),
    triggeredBy: author.authorId,
    files: c.env.FILES,
    appName: appDisplayName(configuredAppName ?? c.env.APP_NAME),
  });
  if (result.status === 'busy') throw new ApiError(409, 'MIRROR_BUSY', messages.mirrorBusy);
  if (result.status === 'failed')
    throw new ApiError(502, 'MIRROR_FAILED', messages.mirrorFailed(result.error));
  return c.json({ filesWritten: result.filesWritten, moreImages: result.moreImages });
});

// --- Users ------------------------------------------------------------------------------------

/** Add a person with an initial password; the answer holds the invite token (shown once). */
adminRoutes.post('/admin/users', async (c) => {
  const { author, form } = await authorAndForm(c);
  const input = valid(validateAdmin(addUserSchema, form));
  const db = c.env.DB;
  const existing = await listUsers(db, { includeInactive: true });
  if (
    nameTaken(
      existing.map((user) => user.name),
      input.name,
    )
  )
    throw invalid({ name: adminMessages.nameTaken(input.name) });
  const id = newId();
  const now = new Date();
  const invite = await newInvite(db, id, author.authorId, now);
  await db.batch([
    db
      .prepare(
        'INSERT INTO users (id, name, role, is_active, is_builtin, created_at, updated_at, password_hash, must_change_password) VALUES (?, ?, ?, 1, 0, ?, ?, ?, 1)',
      )
      .bind(
        id,
        input.name,
        input.role,
        now.toISOString(),
        now.toISOString(),
        await hashPassword(input.initialPassword),
      ),
    ...invite.statements,
    await activity(db, author, 'user_added', `User ${input.name} added as ${input.role}.`, {
      type: 'user',
      id,
    }),
  ]);
  return c.json({ id, inviteToken: invite.token }, 201);
});

/** A new invite with a new initial password: also how a forgotten password is reset. */
adminRoutes.post('/admin/users/:id/invite', async (c) => {
  const { author, form } = await authorAndForm(c);
  const input = valid(validateAdmin(inviteSchema, form));
  const db = c.env.DB;
  const user = await getUserById(db, c.req.param('id'));
  if (user === null) throw new ApiError(404, 'USER_NOT_FOUND', messages.userNotFoundAdmin);
  if (user.is_builtin === 1) throw new ApiError(409, 'BUILTIN_LOCKED', adminMessages.builtinLocked);
  if (user.is_active === 0) throw invalid({ form: adminMessages.inviteInactive });
  // An Admin who invites themselves would lock themselves out of this browser: they use "Change password".
  if (user.id === author.authorId) throw invalid({ form: adminMessages.inviteSelf });
  const now = new Date();
  const invite = await newInvite(db, user.id, author.authorId, now);
  await db.batch([
    db
      .prepare(
        'UPDATE users SET password_hash = ?, must_change_password = 1, session_epoch = session_epoch + 1, failed_logins = 0, locked_until = NULL, updated_at = ? WHERE id = ?',
      )
      .bind(await hashPassword(input.initialPassword), now.toISOString(), user.id),
    ...invite.statements,
    await activity(db, author, 'settings_changed', `New invite for ${user.name}.`, {
      type: 'user',
      id: user.id,
    }),
  ]);
  return c.json({ id: user.id, inviteToken: invite.token });
});

adminRoutes.patch('/admin/users/:id', async (c) => {
  const { author, form } = await authorAndForm(c);
  const input = valid(validateAdmin(updateUserSchema, form));
  const db = c.env.DB;
  const user = await getUserById(db, c.req.param('id'));
  if (user === null) throw new ApiError(404, 'USER_NOT_FOUND', messages.userNotFoundAdmin);
  if (user.is_builtin === 1) throw new ApiError(409, 'BUILTIN_LOCKED', adminMessages.builtinLocked);
  const changes: string[] = [];
  let type: ActivityType = 'settings_changed';
  const name = input.name ?? user.name;
  const role = input.role ?? user.role;
  const isActive = input.isActive === undefined ? user.is_active : input.isActive ? 1 : 0;
  if (input.name !== undefined && input.name !== user.name) {
    const others = (await listUsers(db, { includeInactive: true })).filter((u) => u.id !== user.id);
    if (
      nameTaken(
        others.map((u) => u.name),
        input.name,
      )
    )
      throw invalid({ name: adminMessages.nameTaken(input.name) });
    changes.push(`renamed ${user.name} to ${input.name}`);
  }
  if (input.role !== undefined && input.role !== user.role)
    changes.push(`set ${user.name}'s role to ${input.role}`);
  if (isActive !== user.is_active) {
    changes.push(isActive === 1 ? `reactivated ${user.name}` : `removed ${user.name}`);
    if (isActive === 0) type = 'user_deactivated';
  }
  if (changes.length === 0) throw invalid({ form: adminMessages.nothingToChange });
  const losesAdmin =
    user.role === 'admin' && user.is_active === 1 && (role !== 'admin' || isActive === 0);
  // Removing someone or changing their role ends their sessions (ADR-0005).
  const endSessions = isActive === 0 || role !== user.role ? 1 : 0;
  const summary = `User ${changes.join(', ')}.`;
  // The "last Admin" guard sits inside the UPDATE, so two Admins removing each other at the same
  // moment cannot both succeed.
  const updated = await db
    .prepare(
      `UPDATE users SET name = ?, role = ?, is_active = ?, session_epoch = session_epoch + ?, updated_at = ?
       WHERE id = ? AND (? = 0 OR EXISTS (
         SELECT 1 FROM users WHERE role = 'admin' AND is_active = 1 AND is_builtin = 0 AND id <> ?))`,
    )
    .bind(name, role, isActive, endSessions, nowIso(), user.id, losesAdmin ? 1 : 0, user.id)
    .run();
  if (updated.meta.changes === 0) throw new ApiError(409, 'LAST_ADMIN', adminMessages.lastAdmin);
  await db.batch([
    // A removed user's unused invites stop working, also if the person is reactivated later.
    ...(isActive === 0
      ? [
          db
            .prepare('UPDATE invites SET used_at = ? WHERE user_id = ? AND used_at IS NULL')
            .bind(nowIso(), user.id),
        ]
      : []),
    await activity(db, author, type, summary.charAt(0).toUpperCase() + summary.slice(1), {
      type: 'user',
      id: user.id,
    }),
  ]);
  return c.json({ id: user.id });
});

/**
 * Delete a removed user for good (T-030). Only a person who never appears anywhere (no change, message,
 * mention, upload, invite they sent, ...) can go: the database refuses the delete while any row still points
 * at them, and then the entry stays (hidden under "Removed users"). Their own unused invites are deleted
 * with them. This is the one hard delete in the app; the owner asked for it so a name can be invited anew.
 */
adminRoutes.delete('/admin/users/:id', async (c) => {
  const { author } = await authorAndForm(c);
  const db = c.env.DB;
  const user = await getUserById(db, c.req.param('id'));
  if (user === null) throw new ApiError(404, 'USER_NOT_FOUND', messages.userNotFoundAdmin);
  if (user.is_builtin === 1) throw new ApiError(409, 'BUILTIN_LOCKED', adminMessages.builtinLocked);
  if (user.id === author.authorId) throw invalid({ form: adminMessages.deleteSelf });
  if (user.is_active === 1) throw invalid({ form: adminMessages.deleteNeedsRemoved });
  try {
    await db.batch([
      db.prepare('DELETE FROM invites WHERE user_id = ?').bind(user.id),
      db.prepare('DELETE FROM users WHERE id = ?').bind(user.id),
      await activity(
        db,
        author,
        'settings_changed',
        `User ${user.name} was deleted from the list for good.`,
      ),
    ]);
  } catch {
    // A row elsewhere still points at this person: the whole batch rolled back, nothing changed.
    throw new ApiError(409, 'USER_HAS_HISTORY', adminMessages.userHasHistory);
  }
  return c.json({ id: user.id });
});

/** A new Guest URL: the old one stops working and every Guest session ends (ADR-0005). */
adminRoutes.post('/admin/guest-link/rotate', async (c) => {
  const { author } = await authorAndForm(c);
  const db = c.env.DB;
  const guest = await getUserByName(db, 'Guest');
  const token = randomToken();
  await db.batch([
    db
      .prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
      )
      .bind('guest_link_token', token),
    db
      .prepare('UPDATE users SET session_epoch = session_epoch + 1 WHERE id = ?')
      .bind(guest?.id ?? ''),
    await activity(
      db,
      author,
      'settings_changed',
      'The guest link was replaced; the old link no longer works.',
    ),
  ]);
  return c.json({ token });
});

// --- Pick-lists -------------------------------------------------------------------------------

adminRoutes.post('/admin/enumerations', async (c) => {
  const { author, form } = await authorAndForm(c);
  const input = valid(validateAdmin(addEnumerationSchema, form));
  if (!EDITABLE_KINDS.includes(input.kind))
    throw new ApiError(409, 'LIST_READ_ONLY', adminMessages.listReadOnly);
  const db = c.env.DB;
  const existing = await listEnumerations(db, input.kind, { includeInactive: true });
  if (
    nameTaken(
      existing.map((row) => row.value),
      input.value,
    )
  )
    throw invalid({ value: adminMessages.valueTaken(input.value) });
  const id = newId();
  const last = existing.reduce((max, row) => Math.max(max, row.sort_order), 0);
  await db.batch([
    db
      .prepare(
        'INSERT INTO enumerations (id, kind, value, sort_order, is_active) VALUES (?, ?, ?, ?, 1)',
      )
      .bind(id, input.kind, input.value, last + 1),
    await activity(db, author, 'settings_changed', `List ${input.kind}: added "${input.value}".`, {
      type: 'enumeration',
      id,
    }),
  ]);
  return c.json({ id }, 201);
});

adminRoutes.patch('/admin/enumerations/:id', async (c) => {
  const { author, form } = await authorAndForm(c);
  const input = valid(validateAdmin(updateEnumerationSchema, form));
  const db = c.env.DB;
  const row = await db
    .prepare('SELECT id, kind, value, is_active FROM enumerations WHERE id = ?')
    .bind(c.req.param('id'))
    .first<{ id: string; kind: EnumerationKind; value: string; is_active: number }>();
  if (row === null) throw new ApiError(404, 'LIST_ENTRY_NOT_FOUND', messages.listValueNotFound);
  if (!(EDITABLE_KINDS as readonly string[]).includes(row.kind))
    throw new ApiError(409, 'LIST_READ_ONLY', adminMessages.listReadOnly);
  const value = input.value ?? row.value;
  const isActive = input.isActive === undefined ? row.is_active : input.isActive ? 1 : 0;
  const changes: string[] = [];
  if (value !== row.value) {
    const others = (await listEnumerations(db, row.kind, { includeInactive: true })).filter(
      (entry) => entry.id !== row.id,
    );
    if (
      nameTaken(
        others.map((entry) => entry.value),
        value,
      )
    )
      throw invalid({ value: adminMessages.valueTaken(value) });
    changes.push(`renamed "${row.value}" to "${value}"`);
  }
  if (isActive !== row.is_active)
    changes.push(`${isActive === 1 ? 'enabled' : 'disabled'} "${value}"`);
  if (changes.length === 0) throw invalid({ form: adminMessages.nothingToChange });
  await db.batch([
    db
      .prepare('UPDATE enumerations SET value = ?, is_active = ? WHERE id = ?')
      .bind(value, isActive, row.id),
    await activity(db, author, 'settings_changed', `List ${row.kind}: ${changes.join(', ')}.`, {
      type: 'enumeration',
      id: row.id,
    }),
  ]);
  return c.json({ id: row.id });
});

// --- Settings ------------------------------------------------------------

const SETTING_KEYS = {
  databaseName: ['app_name', 'database name'],
  upcomingBreedingMonths: ['upcoming_breeding_months', 'upcoming breeding months'],
  defaultAnnealingC: ['default_annealing_c', 'default annealing temperature'],
  defaultCycles: ['default_cycles', 'default cycles'],
} as const;

adminRoutes.patch('/admin/settings', async (c) => {
  const { author, form } = await authorAndForm(c);
  const input = valid(validateAdmin(settingsSchema, form));
  const db = c.env.DB;
  const statements: DbStatement[] = [];
  const changes: string[] = [];
  for (const [field, [key, words]] of Object.entries(SETTING_KEYS)) {
    const next = input[field as keyof typeof input];
    if (next === undefined) continue;
    const before = await getSetting(db, key);
    if (before !== null && before === String(next)) continue;
    changes.push(`${words} ${before ?? 'unset'} → ${String(next)}`);
    statements.push(
      db
        .prepare(
          'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
        )
        .bind(key, String(next)),
    );
  }
  if (statements.length === 0) throw invalid({ form: adminMessages.nothingToChange });
  statements.push(
    await activity(db, author, 'settings_changed', `Settings: ${changes.join('; ')}.`),
  );
  await db.batch(statements);
  return c.json({ changed: changes.length });
});

adminRoutes.put('/admin/read-only', async (c) => {
  const { author, form } = await authorAndForm(c);
  const input = valid(validateAdmin(readOnlySchema, form));
  const db = c.env.DB;
  if ((await isReadOnly(db)) === input.enabled)
    throw invalid({ form: adminMessages.nothingToChange });
  await db.batch([
    db
      .prepare(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
      )
      .bind('read_only', input.enabled ? '1' : null),
    await activity(
      db,
      author,
      'settings_changed',
      input.enabled
        ? 'Read-only mode was turned on: nobody can change data until it is turned off.'
        : 'Read-only mode was turned off.',
    ),
  ]);
  return c.json({ readOnly: input.enabled });
});

// --- Deleted items ----------------------------------------------------------------------------

adminRoutes.get('/admin/deleted', async (c) => c.json({ items: await deletedItems(c.env.DB) }));

adminRoutes.post('/admin/deleted/:type/:id/restore', async (c) => {
  const { author } = await authorAndForm(c);
  const type = DELETED_TYPES.find((known) => known === c.req.param('type'));
  if (type === undefined) throw new ApiError(404, 'DELETED_NOT_FOUND', messages.deletedNotFound);
  const result = await restoreDeleted(c.env.DB, type, c.req.param('id'), author);
  return c.json(result);
});

// --- Export -----------------------------------------------------------------------------------

/** The read-only viewer (`snapshot.html`), the same file the Dropbox copy holds, for a quick look. */
adminRoutes.get('/admin/snapshot.html', async (c) => {
  const { json } = await buildExportFiles(c.env.DB, new Date(), exportLinesCsv);
  const configuredAppName = await getSetting(c.env.DB, 'app_name');
  return new Response(
    buildSnapshotHtml(json, 'images/', appDisplayName(configuredAppName ?? c.env.APP_NAME)),
    {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': 'attachment; filename="snapshot.html"',
        'Cache-Control': 'no-store',
      },
    },
  );
});

adminRoutes.get('/admin/export.zip', async (c) => {
  const now = new Date();
  const { bytes, fileName } = await buildExportZip(c.env.DB, now, exportLinesCsv);
  return new Response(bytes, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': 'no-store',
    },
  });
});
