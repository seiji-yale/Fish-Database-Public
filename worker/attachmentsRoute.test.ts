import { describe, expect, it } from 'vitest';
import { insertAttachment, softDeleteAttachment } from './db/queries/attachments';
import { makeAttachment } from './db/testing/builders';
import { createMigratedDb } from './db/testing/testDb';
import { guestFetch } from './testBrowser';
import type { Bindings } from './middleware/session';

/** The one method the route uses from an R2 bucket. */
function fakeBucket(objects: Record<string, string>): R2Bucket {
  return {
    get: (key: string) =>
      Promise.resolve(
        key in objects
          ? ({ body: new Response(objects[key]).body } as unknown as R2ObjectBody)
          : null,
      ),
  } as unknown as R2Bucket;
}

async function setup(objects: Record<string, string> = {}, withBucket = true) {
  const db = createMigratedDb();
  const bindings = {
    DB: db,
    SESSION_SIGNING_KEY: 'test-signing-key',
    ...(withBucket ? { FILES: fakeBucket(objects) } : {}),
  } satisfies Bindings;
  return { db, get: await guestFetch(bindings) };
}

describe('GET /api/attachments/:id/file (T-009 Step 3)', () => {
  it('serves an image inline with its stored MIME type and no content sniffing', async () => {
    const { db, get } = await setup({ 'lines/line-1/att-1-gel.png': 'PNGDATA' });
    await insertAttachment(db, makeAttachment());
    const response = await get('/api/attachments/att-1/file');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('content-disposition')).toBe('inline');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
    expect(await response.text()).toBe('PNGDATA');
  });

  it('never serves SVG inline (it can carry script)', async () => {
    const { db, get } = await setup({ 'lines/line-1/att-1-gel.png': '<svg onload="alert(1)"/>' });
    await insertAttachment(db, makeAttachment({ mime_type: 'image/svg+xml' }));
    const response = await get('/api/attachments/att-1/file');
    expect(response.headers.get('content-disposition')).toBe('attachment');
  });

  it('serves a non-image as a download, and defaults the type when none is stored', async () => {
    const { db, get } = await setup({ 'lines/line-1/att-1-gel.png': 'DOC' });
    await insertAttachment(db, makeAttachment({ mime_type: null, kind: 'reference_file' }));
    const response = await get('/api/attachments/att-1/file');
    expect(response.headers.get('content-type')).toBe('application/octet-stream');
    expect(response.headers.get('content-disposition')).toBe('attachment');
  });

  it('serves the thumbnail for ?thumb=1 when one exists, else the original', async () => {
    const { db, get } = await setup({ 'thumb-key': 'THUMB', 'lines/line-1/att-2-x.png': 'FULL' });
    await insertAttachment(db, makeAttachment({ id: 'att-1', thumb_r2_key: 'thumb-key' }));
    await insertAttachment(
      db,
      makeAttachment({ id: 'att-2', r2_key: 'lines/line-1/att-2-x.png', thumb_r2_key: null }),
    );
    expect(await (await get('/api/attachments/att-1/file?thumb=1')).text()).toBe('THUMB');
    expect(await (await get('/api/attachments/att-2/file?thumb=1')).text()).toBe('FULL');
  });

  it('404s for an unknown id, a soft-deleted attachment, a missing object and an unbound bucket', async () => {
    const { db, get } = await setup({ 'lines/line-1/att-1-gel.png': 'X' });
    expect((await get('/api/attachments/nope/file')).status).toBe(404);

    await insertAttachment(db, makeAttachment());
    await softDeleteAttachment(db, 'att-1', '2026-09-29T00:00:00Z');
    const deleted = await get('/api/attachments/att-1/file');
    expect(deleted.status).toBe(404);
    expect(await deleted.json()).toMatchObject({ error: { code: 'FILE_NOT_FOUND' } });

    await insertAttachment(db, makeAttachment({ id: 'att-3', r2_key: 'missing-object' }));
    expect((await get('/api/attachments/att-3/file')).status).toBe(404);

    const unbound = await setup({}, false);
    await insertAttachment(unbound.db, makeAttachment());
    expect((await unbound.get('/api/attachments/att-1/file')).status).toBe(404);
  });
});
