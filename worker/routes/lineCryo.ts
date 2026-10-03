/**
 * Cryopreservation endpoints (T-015, FR-CRYO-01…03):
 * `POST /api/lines/:id/cryo`, `PATCH|DELETE /api/lines/:id/cryo/:cid` and `GET /api/cryo/next-id`.
 * Writes go through `withLineWrite` (one version, one activity, optimistic locking); the record is
 * validated by `domain/cryoEdit.ts`, the same code the dialog runs.
 */
import { Hono } from 'hono';
import {
  nextCryoId,
  validateCryoRecord,
  validateCryoRemoval,
  validateCryoUse,
} from '../../domain/cryoEdit';
import { labToday } from '../../domain/dates';
import { nowIso } from '../db/ids';
import { requireAuthor } from '../lib/attribution';
import {
  addCryoChange,
  editCryoChange,
  removeCryoChange,
  undoVialUseChange,
  useVialsChange,
} from '../lib/cryoWrite';
import { listUsedCryoIds } from '../db/queries/cryoVialUses';
import { ApiError } from '../lib/errors';
import { withLineWrite, type LineWriteInput } from '../lib/lineWrite';
import { messages } from '../lib/messages';
import type { Bindings } from '../middleware/session';

export const lineCryoRoutes = new Hono<{ Bindings: Bindings }>();

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

async function authorAndForm(c: Ctx) {
  const body = await readBody(c.req.raw);
  const author = await requireAuthor(c, 'data');
  const form = { ...body };
  delete form['chosenUserId'];
  return { author, form };
}

async function write(c: Ctx, input: Omit<LineWriteInput, 'lineId'>) {
  const lineId = c.req.param('id') ?? '';
  const result = await withLineWrite(c.env.DB, { ...input, lineId });
  return c.json({ id: lineId, version: result.versionNo, summary: result.summary });
}

/** FR-CRYO-03: max existing ID over all lines' live records + 1, e.g. `C0637`. */
lineCryoRoutes.get('/cryo/next-id', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT cryo_id_start, cryo_id_end FROM cryo_records WHERE deleted_at IS NULL',
  ).all<{ cryo_id_start: string | null; cryo_id_end: string | null }>();
  // Used IDs count too: an ID that was taken out of a record is never handed out again.
  const used = await listUsedCryoIds(c.env.DB);
  return c.json({
    nextId: nextCryoId([
      ...results.flatMap((row) => [row.cryo_id_start, row.cryo_id_end]),
      ...used,
    ]),
  });
});

lineCryoRoutes.post('/lines/:id/cryo', async (c) => {
  const { author, form } = await authorAndForm(c);
  const check = validateCryoRecord(form, labToday());
  if (!check.ok) throw invalid(check.errors);
  const input = check.value;
  const now = nowIso();
  return write(c, {
    expectedVersion: input.expectedVersion,
    author,
    changeType: 'cryo_changed',
    note: input.note,
    now,
    mutate: (before) => addCryoChange(c.env.DB, before, input, author, now),
  });
});

/** Record that vials were used: they leave the list, their IDs are never reused. */
lineCryoRoutes.post('/lines/:id/cryo/use', async (c) => {
  const { author, form } = await authorAndForm(c);
  const today = labToday();
  const check = validateCryoUse(form, today);
  if (!check.ok) throw invalid(check.errors);
  const input = check.value;
  const now = nowIso();
  return write(c, {
    expectedVersion: input.expectedVersion,
    author,
    changeType: 'cryo_changed',
    note: input.note,
    now,
    mutate: (before) => useVialsChange(c.env.DB, before, input, author, now),
  });
});

/** Undo a recorded vial use (T-028): any signed-in member or Admin; the dialog warns first. */
lineCryoRoutes.post('/lines/:id/cryo/uses/:useId/undo', async (c) => {
  const { author, form } = await authorAndForm(c);
  const check = validateCryoRemoval(form);
  if (!check.ok) throw invalid(check.errors);
  const useId = c.req.param('useId');
  const now = nowIso();
  return write(c, {
    expectedVersion: check.expectedVersion,
    author,
    changeType: 'cryo_changed',
    note: check.note,
    now,
    mutate: (before) => undoVialUseChange(c.env.DB, before, useId, author, now),
  });
});

lineCryoRoutes.patch('/lines/:id/cryo/:cid', async (c) => {
  const { author, form } = await authorAndForm(c);
  const check = validateCryoRecord(form, labToday());
  if (!check.ok) throw invalid(check.errors);
  const input = check.value;
  const recordId = c.req.param('cid');
  return write(c, {
    expectedVersion: input.expectedVersion,
    author,
    changeType: 'cryo_changed',
    note: input.note,
    now: nowIso(),
    mutate: (before) => editCryoChange(c.env.DB, before, recordId, input),
  });
});

lineCryoRoutes.delete('/lines/:id/cryo/:cid', async (c) => {
  const { author, form } = await authorAndForm(c);
  const check = validateCryoRemoval(form);
  if (!check.ok) throw invalid(check.errors);
  const recordId = c.req.param('cid');
  const now = nowIso();
  return write(c, {
    expectedVersion: check.expectedVersion,
    author,
    changeType: 'cryo_changed',
    note: check.note,
    now,
    mutate: (before) => removeCryoChange(c.env.DB, before, recordId, now),
  });
});
