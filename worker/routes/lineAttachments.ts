/**
 * Uploads and references (T-016, FR-REF-01/02, FR-ID-03/05/07, FR-ACT-03):
 * - `POST /api/lines/:id/attachments` (multipart): `file`, optional `thumb` (a ≤ 400 px JPEG made by
 *   the browser), `kind`, and either `protocolId` + `expectedVersion` (an image on an ID protocol,
 *   one line version) or nothing else (a *staged* upload that a genotyping record or a reference
 *   links in its own write).
 * - `DELETE /api/lines/:id/attachments/:aid`: hides it (soft delete), one line version.
 * - `POST /api/lines/:id/references`, `PATCH|DELETE …/references/:rid`: a title plus a link or a file.
 * Serving stays in `routes/attachments.ts` (`GET /api/attachments/:id/file`).
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { validateReference } from '../../domain/referenceEdit';
import { nowIso, newId } from '../db/ids';
import { insertAttachmentStatement } from '../db/queries/attachments';
import { insertLineReferenceStatement } from '../db/queries/lineReferences';
import type { AttachmentKind, LineReferenceRow } from '../db/types';
import {
  ATTACHMENT_KINDS,
  attachmentRow,
  clearLatestStatements,
  findLineAttachment,
  findStaged,
  KIND_WORDS,
  linkStatement,
  promoteNewestStatement,
  storeUpload,
} from '../lib/attachmentWrite';
import { requireAuthor } from '../lib/attribution';
import { ApiError } from '../lib/errors';
import { loadLineDocument, withLineWrite, type LineWriteInput } from '../lib/lineWrite';
import { messages } from '../lib/messages';
import { findLiveProtocol } from '../lib/protocolWrite';
import type { Bindings } from '../middleware/session';

export const lineAttachmentRoutes = new Hono<{ Bindings: Bindings }>();

type Ctx = Parameters<typeof requireAuthor>[0];

const versionField = z.coerce.number().int().min(1);

function invalid(errors: Record<string, string>): ApiError {
  return new ApiError(400, 'INVALID_INPUT', messages.invalidInput, undefined, { fields: errors });
}

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

async function documentOf(c: Ctx) {
  const document = await loadLineDocument(c.env.DB, c.req.param('id') ?? '');
  if (document === null) throw new ApiError(404, 'LINE_NOT_FOUND', messages.lineNotFound);
  return document;
}

async function write(c: Ctx, input: Omit<LineWriteInput, 'lineId'>, extra: object = {}) {
  const lineId = c.req.param('id') ?? '';
  const result = await withLineWrite(c.env.DB, { ...input, lineId });
  return c.json({ id: lineId, version: result.versionNo, summary: result.summary, ...extra });
}

function text(form: FormData, name: string): string | null {
  const value = form.get(name);
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

lineAttachmentRoutes.post('/lines/:id/attachments', async (c) => {
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    throw new ApiError(400, 'INVALID_INPUT', messages.invalidInput);
  }
  const author = await requireAuthor(c, 'data');
  const document = await documentOf(c);
  const file = form.get('file');
  if (!(file instanceof File)) throw invalid({ file: messages.uploadMissingFile });
  const thumb = form.get('thumb');
  const kindText = text(form, 'kind') ?? 'other';
  if (!ATTACHMENT_KINDS.includes(kindText as AttachmentKind))
    throw invalid({ kind: messages.invalidInput });
  const kind = kindText as AttachmentKind;
  const protocolId = text(form, 'protocolId');
  const caption = text(form, 'caption');
  const db = c.env.DB;
  const lineId = document.line.id;
  const now = nowIso();

  if (protocolId === null) {
    // Staged: linked later by the genotyping or reference form (which writes the line version).
    const stored = await storeUpload(
      c.env.FILES,
      lineId,
      file,
      thumb instanceof File ? thumb : null,
      kind !== 'reference_file',
    );
    const row = attachmentRow(
      stored,
      { owner_type: 'line', owner_id: lineId, kind, is_latest: 0 },
      caption,
      author.authorId,
      now,
    );
    await insertAttachmentStatement(db, row).run();
    return c.json({ attachmentId: row.id, fileName: row.file_name, mimeType: row.mime_type }, 201);
  }

  const expectedVersion = versionField.safeParse(text(form, 'expectedVersion'));
  if (!expectedVersion.success) throw invalid({ expectedVersion: messages.invalidInput });
  const protocol = findLiveProtocol(document, protocolId);
  const stored = await storeUpload(
    c.env.FILES,
    lineId,
    file,
    thumb instanceof File ? thumb : null,
    true,
  );
  const row = attachmentRow(
    stored,
    { owner_type: 'id_protocol', owner_id: protocolId, kind, is_latest: 1 },
    caption,
    author.authorId,
    now,
  );
  return write(
    c,
    {
      expectedVersion: expectedVersion.data,
      author,
      changeType: 'protocol_changed',
      now,
      mutate: () => ({
        line: {},
        statements: [...clearLatestStatements(db, protocolId), insertAttachmentStatement(db, row)],
        summaryContext: { text: `Uploaded ${KIND_WORDS[kind]} for ${protocol.label}.` },
      }),
    },
    { attachmentId: row.id },
  );
});

lineAttachmentRoutes.delete('/lines/:id/attachments/:aid', async (c) => {
  const body = await readJson(c.req.raw);
  const author = await requireAuthor(c, 'data');
  const expectedVersion = versionField.safeParse(body['expectedVersion']);
  if (!expectedVersion.success) throw invalid({ expectedVersion: messages.invalidInput });
  const db = c.env.DB;
  const document = await documentOf(c);
  const { row, protocolId } = await findLineAttachment(db, document, c.req.param('aid'));
  const now = nowIso();
  const name = row.caption ?? row.file_name ?? KIND_WORDS[row.kind];
  return write(c, {
    expectedVersion: expectedVersion.data,
    author,
    changeType: row.owner_type === 'line_reference' ? 'reference_changed' : 'protocol_changed',
    now,
    mutate: () => ({
      line: {},
      statements: [
        db
          .prepare('UPDATE attachments SET deleted_at = ?, is_latest = 0 WHERE id = ?')
          .bind(now, row.id),
        ...(protocolId !== null && row.is_latest === 1
          ? [promoteNewestStatement(db, protocolId)]
          : []),
      ],
      summaryContext: { text: `Removed ${KIND_WORDS[row.kind]} ${name}.` },
    }),
  });
});

// --- References -------------------------------------------------------------------------------

async function authorAndBody(c: Ctx) {
  const body = await readJson(c.req.raw);
  const author = await requireAuthor(c, 'data');
  const form = { ...body };
  delete form['chosenUserId'];
  return { author, form };
}

lineAttachmentRoutes.post('/lines/:id/references', async (c) => {
  const { author, form } = await authorAndBody(c);
  const check = validateReference(form);
  if (!check.ok) throw invalid(check.errors);
  const input = check.value;
  const db = c.env.DB;
  const document = await documentOf(c);
  if (input.attachmentId !== null)
    await findStaged(db, document.line.id, input.attachmentId, 'attachmentId');
  const now = nowIso();
  const row: LineReferenceRow = {
    id: newId(),
    line_id: document.line.id,
    title: input.title,
    url: input.url,
    attachment_id: input.attachmentId,
    note: input.note,
    sort_order: document.references.reduce((max, entry) => Math.max(max, entry.sort_order), -1) + 1,
    deleted_at: null,
    created_at: now,
    created_by: author.authorId,
  };
  return write(c, {
    expectedVersion: input.expectedVersion,
    author,
    changeType: 'reference_changed',
    now,
    mutate: (before) => ({
      line: {},
      statements: [
        insertLineReferenceStatement(db, row),
        ...(input.attachmentId === null
          ? []
          : [
              linkStatement(
                db,
                input.attachmentId,
                'line_reference',
                row.id,
                'reference_file',
                false,
              ),
            ]),
      ],
      children: { references: [...before.references, row] },
      summaryContext: { text: `Added reference: ${row.title}.` },
    }),
  });
});

function findReference(document: { references: LineReferenceRow[] }, referenceId: string) {
  const found = document.references.find((entry) => entry.id === referenceId);
  if (found === undefined)
    throw new ApiError(404, 'REFERENCE_NOT_FOUND', messages.referenceNotFound);
  return found;
}

lineAttachmentRoutes.patch('/lines/:id/references/:rid', async (c) => {
  const { author, form } = await authorAndBody(c);
  const db = c.env.DB;
  const document = await documentOf(c);
  const current = findReference(document, c.req.param('rid'));
  const check = validateReference(form, current.attachment_id !== null);
  if (!check.ok) throw invalid(check.errors);
  const input = check.value;
  if (input.attachmentId !== null)
    await findStaged(db, document.line.id, input.attachmentId, 'attachmentId');
  const now = nowIso();
  const attachmentId = input.keepFile ? current.attachment_id : input.attachmentId;
  const next: LineReferenceRow = {
    ...current,
    title: input.title,
    url: input.url,
    attachment_id: attachmentId,
    note: input.note,
  };
  const replacedFile = current.attachment_id !== null && current.attachment_id !== attachmentId;
  return write(c, {
    expectedVersion: input.expectedVersion,
    author,
    changeType: 'reference_changed',
    now,
    mutate: (before) => ({
      line: {},
      statements: [
        db
          .prepare(
            'UPDATE line_references SET title = ?, url = ?, attachment_id = ?, note = ? WHERE id = ?',
          )
          .bind(next.title, next.url, next.attachment_id, next.note, next.id),
        ...(input.attachmentId === null
          ? []
          : [
              linkStatement(
                db,
                input.attachmentId,
                'line_reference',
                next.id,
                'reference_file',
                false,
              ),
            ]),
        // A replaced file is hidden, not deleted (BR-7).
        ...(replacedFile
          ? [
              db
                .prepare('UPDATE attachments SET deleted_at = ? WHERE id = ?')
                .bind(now, current.attachment_id),
            ]
          : []),
      ],
      children: {
        references: before.references.map((entry) => (entry.id === next.id ? next : entry)),
      },
      summaryContext: { text: `Updated reference: ${next.title}.` },
    }),
  });
});

lineAttachmentRoutes.delete('/lines/:id/references/:rid', async (c) => {
  const { author, form } = await authorAndBody(c);
  const expectedVersion = versionField.safeParse(form['expectedVersion']);
  if (!expectedVersion.success) throw invalid({ expectedVersion: messages.invalidInput });
  const db = c.env.DB;
  const document = await documentOf(c);
  const current = findReference(document, c.req.param('rid'));
  const now = nowIso();
  return write(c, {
    expectedVersion: expectedVersion.data,
    author,
    changeType: 'reference_changed',
    now,
    mutate: (before) => ({
      line: {},
      statements: [
        db.prepare('UPDATE line_references SET deleted_at = ? WHERE id = ?').bind(now, current.id),
      ],
      children: { references: before.references.filter((entry) => entry.id !== current.id) },
      summaryContext: { text: `Removed reference: ${current.title}.` },
    }),
  });
});
