/**
 * `PATCH /api/lines/:id` (T-012, FR-LINE-02/03, BR-8, BR-12) and
 * `POST /api/lines/:id/restore/:versionNo` (Admin, FR-HIST-02, NFR-09).
 * Both go through `withLineWrite`: one version, one activity, optimistic locking.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { labToday } from '../../domain/dates';
import { descriptiveFromSnapshot, validateLineEdit } from '../../domain/lineEdit';
import { getLineVersion } from '../db/queries/lineVersions';
import { nowIso } from '../db/ids';
import { actingUser, requireAuthor } from '../lib/attribution';
import { ApiError } from '../lib/errors';
import {
  applyDescriptive,
  descriptiveOf,
  NoChangeError,
  nameRaceError,
  previewDescriptive,
} from '../lib/lineEdit';
import { loadLineDocument, withLineWrite } from '../lib/lineWrite';
import { messages } from '../lib/messages';
import type { Bindings } from '../middleware/session';

export const lineEditRoutes = new Hono<{ Bindings: Bindings }>();

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await request.json();
    if (body !== null && typeof body === 'object' && !Array.isArray(body))
      return body as Record<string, unknown>;
  } catch {
    /* fall through */
  }
  throw new ApiError(400, 'INVALID_INPUT', messages.invalidInput);
}

lineEditRoutes.patch('/lines/:id', async (c) => {
  const body = await readJson(c.req.raw);
  const author = await requireAuthor(c, 'data');
  const formValues = { ...body };
  delete formValues['chosenUserId'];
  const validation = validateLineEdit(formValues, labToday());
  if (!validation.ok)
    throw new ApiError(400, 'INVALID_INPUT', messages.invalidInput, undefined, {
      fields: validation.errors,
    });

  const { expectedVersion, note, changes } = validation.value;
  const db = c.env.DB;
  const lineId = c.req.param('id');
  const now = nowIso();
  try {
    const result = await withLineWrite(db, {
      lineId,
      expectedVersion,
      author,
      changeType: 'edited',
      note,
      now,
      mutate: (before) => applyDescriptive(db, before, changes, now),
    });
    return c.json({
      id: lineId,
      version: result.versionNo,
      summary: result.summary,
      unchanged: false,
    });
  } catch (error) {
    if (error instanceof NoChangeError)
      return c.json({ id: lineId, version: expectedVersion, summary: '', unchanged: true });
    throw await nameRaceError(db, lineId, changes.name ?? '', error);
  }
});

/** The content of a version, or the API error explaining why it cannot be restored. */
async function restorableContent(db: Bindings['DB'], lineId: string, versionNoText: string) {
  const versionNo = Number(versionNoText);
  const source = Number.isInteger(versionNo) ? await getLineVersion(db, lineId, versionNo) : null;
  if (source === null) throw new ApiError(404, 'VERSION_NOT_FOUND', messages.versionNotFound);
  // `line_versions.snapshot` is CHECKed as valid JSON, so this parse cannot throw.
  const target = descriptiveFromSnapshot(JSON.parse(source.snapshot));
  if (target === null) throw new ApiError(422, 'NOT_RESTORABLE', messages.versionNotRestorable);
  return { versionNo, target };
}

/** What restoring this version would change, so the Admin can confirm knowingly (T-012 step 3). */
lineEditRoutes.get('/lines/:id/restore/:versionNo/preview', async (c) => {
  const db = c.env.DB;
  const lineId = c.req.param('id');
  const document = await loadLineDocument(db, lineId);
  if (document === null) throw new ApiError(404, 'LINE_NOT_FOUND', messages.lineNotFound);
  const { versionNo, target } = await restorableContent(db, lineId, c.req.param('versionNo'));
  return c.json({
    versionNo,
    currentVersion: document.line.version,
    changes: previewDescriptive(descriptiveOf(document), target),
  });
});

lineEditRoutes.post('/lines/:id/restore/:versionNo', async (c) => {
  const acting = await actingUser(c);
  if (acting.role !== 'admin') throw new ApiError(403, 'ADMIN_ONLY', messages.adminOnly);
  const body = await readJson(c.req.raw);
  const author = await requireAuthor(c, 'data');
  const expectedVersion = z.number().int().min(1).safeParse(body['expectedVersion']);
  if (!expectedVersion.success) throw new ApiError(400, 'INVALID_INPUT', messages.invalidInput);

  const db = c.env.DB;
  const lineId = c.req.param('id');
  const { versionNo, target } = await restorableContent(db, lineId, c.req.param('versionNo'));

  const now = nowIso();
  try {
    const result = await withLineWrite(db, {
      lineId,
      expectedVersion: expectedVersion.data,
      author,
      changeType: 'restored',
      note: `Restored from version ${String(versionNo)}.`,
      now,
      mutate: async (before) => {
        const change = await applyDescriptive(db, before, target, now);
        return { ...change, summaryContext: { restoredVersionNo: versionNo } };
      },
    });
    return c.json({
      id: lineId,
      version: result.versionNo,
      summary: result.summary,
      unchanged: false,
    });
  } catch (error) {
    if (error instanceof NoChangeError)
      return c.json({ id: lineId, version: expectedVersion.data, summary: '', unchanged: true });
    throw await nameRaceError(db, lineId, target.name, error);
  }
});
