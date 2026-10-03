/**
 * ID protocol endpoints (T-014, FR-ID-01…09):
 * `POST /api/lines/:id/protocols`, `PATCH|DELETE /api/lines/:id/protocols/:pid`,
 * `POST .../:pid/set-current`, `POST /api/lines/:id/protocols/reorder`, and the Admin-only
 * `POST .../:pid/restore` for a removed protocol. Every write goes through `withLineWrite`
 * (one version, one activity, optimistic locking); the fields are validated by `domain/newLine`.
 */
import { Hono } from 'hono';
import {
  validateProtocolRequest,
  validateReorder,
  validateSetCurrent,
  validateVersionOnly,
} from '../../domain/protocolEdit';
import { currentProtocols } from '../../domain/currentProtocols';
import { nowIso } from '../db/ids';
import { ID_PROTOCOLS } from '../db/queries/idProtocols';
import type { IdProtocolRow } from '../db/types';
import { actingUser, requireAuthor } from '../lib/attribution';
import { ApiError } from '../lib/errors';
import { loadLineDocument, withLineWrite, type LineWriteInput } from '../lib/lineWrite';
import { messages } from '../lib/messages';
import {
  addProtocolChange,
  editProtocolChange,
  otherLabels,
  removeProtocolChange,
  protocolDefaultsFrom,
  reorderChange,
  restoreProtocolChange,
  setCurrentChange,
} from '../lib/protocolWrite';
import type { Bindings } from '../middleware/session';

export const lineProtocolRoutes = new Hono<{ Bindings: Bindings }>();

type Ctx = Parameters<typeof requireAuthor>[0];

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

/** The body without the attribution answer, and who is recorded as the author (BR-5). */
async function authorAndForm(c: Ctx, admin = false) {
  if (admin && (await actingUser(c)).role !== 'admin')
    throw new ApiError(403, 'ADMIN_ONLY', messages.adminOnly);
  const body = await readBody(c.req.raw);
  const author = await requireAuthor(c, 'data');
  const form = { ...body };
  delete form['chosenUserId'];
  return { author, form };
}

async function write(
  c: Ctx,
  input: Omit<LineWriteInput, 'lineId'>,
  extra: Record<string, unknown> = {},
) {
  const lineId = c.req.param('id') ?? '';
  const result = await withLineWrite(c.env.DB, { ...input, lineId });
  return c.json({ id: lineId, version: result.versionNo, summary: result.summary, ...extra });
}

/** Read before write only for the checks that need the current protocols (labels, ids). */
async function documentOf(c: Ctx) {
  const document = await loadLineDocument(c.env.DB, c.req.param('id') ?? '');
  if (document === null) throw new ApiError(404, 'LINE_NOT_FOUND', messages.lineNotFound);
  return document;
}

lineProtocolRoutes.post('/lines/:id/protocols/reorder', async (c) => {
  const { author, form } = await authorAndForm(c);
  const document = await documentOf(c);
  const check = validateReorder(
    form,
    document.protocols.map((row) => row.id),
  );
  if (!check.ok) throw invalid(check.errors);
  return write(c, {
    expectedVersion: check.expectedVersion,
    author,
    changeType: 'protocol_changed',
    now: nowIso(),
    mutate: (before) => reorderChange(c.env.DB, before, check.order),
  });
});

lineProtocolRoutes.post('/lines/:id/protocols', async (c) => {
  const { author, form } = await authorAndForm(c);
  const document = await documentOf(c);
  const check = validateProtocolRequest(
    form,
    otherLabels(document),
    undefined,
    await protocolDefaultsFrom(c.env.DB),
  );
  if (!check.ok) throw invalid(check.errors);
  const { protocol, setCurrent, note, expectedVersion, warnings } = check.value;
  const now = nowIso();
  return write(
    c,
    {
      expectedVersion,
      author,
      changeType: 'protocol_changed',
      note,
      now,
      mutate: (before) => addProtocolChange(c.env.DB, before, protocol, setCurrent, now),
    },
    { warnings },
  );
});

lineProtocolRoutes.patch('/lines/:id/protocols/:pid', async (c) => {
  const { author, form } = await authorAndForm(c);
  const document = await documentOf(c);
  const protocolId = c.req.param('pid');
  const existing = document.protocols.find((row) => row.id === protocolId);
  if (existing === undefined)
    throw new ApiError(404, 'PROTOCOL_NOT_FOUND', messages.protocolNotFound);
  const check = validateProtocolRequest(
    form,
    otherLabels(document, protocolId),
    existing.protocol_type,
    await protocolDefaultsFrom(c.env.DB),
  );
  if (!check.ok) throw invalid(check.errors);
  const { protocol, note, expectedVersion, warnings } = check.value;
  const now = nowIso();
  return write(
    c,
    {
      expectedVersion,
      author,
      changeType: 'protocol_changed',
      note,
      now,
      mutate: (before) => editProtocolChange(c.env.DB, before, protocolId, protocol, now),
    },
    { warnings },
  );
});

lineProtocolRoutes.delete('/lines/:id/protocols/:pid', async (c) => {
  const { author, form } = await authorAndForm(c);
  const check = validateVersionOnly(form);
  if (!check.ok) throw invalid(check.errors);
  const protocolId = c.req.param('pid');
  const now = nowIso();
  const document = await documentOf(c);
  return write(
    c,
    {
      expectedVersion: check.expectedVersion,
      author,
      changeType: 'protocol_changed',
      note: check.note,
      now,
      mutate: (before) => removeProtocolChange(c.env.DB, before, protocolId, now),
    },
    // The line has no current method any more: the page tells the person (FR-ID-01).
    {
      methodCleared: (() => {
        const current = currentProtocols(document.line.current_protocol_id, document.protocols);
        return current.length === 1 && current[0]?.id === protocolId;
      })(),
    },
  );
});

lineProtocolRoutes.post('/lines/:id/protocols/:pid/set-current', async (c) => {
  const { author, form } = await authorAndForm(c);
  const check = validateSetCurrent(form);
  if (!check.ok) throw invalid(check.errors);
  const protocolId = c.req.param('pid');
  return write(c, {
    expectedVersion: check.expectedVersion,
    author,
    changeType: 'protocol_changed',
    note: check.note,
    now: nowIso(),
    mutate: (before) => setCurrentChange(c.env.DB, before, protocolId, check.current),
  });
});

lineProtocolRoutes.post('/lines/:id/protocols/:pid/restore', async (c) => {
  const { author, form } = await authorAndForm(c, true);
  const check = validateVersionOnly(form);
  if (!check.ok) throw invalid(check.errors);
  const protocolId = c.req.param('pid');
  const lineId = c.req.param('id');
  const deleted = await c.env.DB.prepare(
    `SELECT ${ID_PROTOCOLS.columns.join(', ')} FROM id_protocols WHERE id = ? AND line_id = ? AND deleted_at IS NOT NULL`,
  )
    .bind(protocolId, lineId)
    .first<IdProtocolRow>();
  if (deleted === null) throw new ApiError(404, 'PROTOCOL_NOT_FOUND', messages.protocolNotRemoved);
  const now = nowIso();
  return write(c, {
    expectedVersion: check.expectedVersion,
    author,
    changeType: 'protocol_changed',
    note: check.note,
    now,
    mutate: (before) => restoreProtocolChange(c.env.DB, before, deleted, now),
  });
});
