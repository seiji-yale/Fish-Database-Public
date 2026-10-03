/**
 * `GET /api/attachments/:id/file` (T-009 Step 3, FR-ID-03, FR-REF-01): read-only access to an
 * uploaded file so Line Detail can show gel/fluorescence images and open reference files. Uploads
 * themselves arrive with T-016; until then no attachment rows exist, so this returns 404 for every
 * id, and it also returns 404 when the R2 bucket is not bound (plain local dev).
 * `?thumb=1` serves the thumbnail when the attachment has one, else the original.
 */
import { Hono } from 'hono';
import { getAttachmentById } from '../db/queries/attachments';
import { ApiError } from '../lib/errors';
import { messages } from '../lib/messages';
import type { Bindings } from '../middleware/session';

const INLINE_TYPES: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
]);

export const attachmentRoutes = new Hono<{ Bindings: Bindings }>();

attachmentRoutes.get('/attachments/:id/file', async (c) => {
  const row = await getAttachmentById(c.env.DB, c.req.param('id'));
  const bucket = c.env.FILES;
  if (row === null || row.deleted_at !== null || bucket === undefined)
    throw new ApiError(404, 'FILE_NOT_FOUND', messages.fileNotFound);

  const wantsThumb = c.req.query('thumb') === '1' && row.thumb_r2_key !== null;
  const object = await bucket.get(
    wantsThumb && row.thumb_r2_key !== null ? row.thumb_r2_key : row.r2_key,
  );
  if (object === null) throw new ApiError(404, 'FILE_NOT_FOUND', messages.fileNotFound);

  const mimeType = row.mime_type ?? 'application/octet-stream';
  // Only raster images render inline. SVG (which can carry script), PDF, DOCX, ... download, and
  // nothing is content-sniffed or allowed to run anything from this URL.
  return new Response(object.body, {
    headers: {
      'Content-Type': mimeType,
      'Content-Disposition': INLINE_TYPES.has(mimeType) ? 'inline' : 'attachment',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=3600',
    },
  });
});
