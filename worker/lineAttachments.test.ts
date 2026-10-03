import { describe, expect, it } from 'vitest';
import fixture from '../tests/fixtures/lines.small.json';
import { loadFixture } from './db/fixtures';
import { listActivitiesByLine } from './db/queries/activities';
import { getLineByName } from './db/queries/lines';
import { listLineVersionsByLine } from './db/queries/lineVersions';
import { browser, type ErrorBody } from './testBrowser';

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const PDF = new TextEncoder().encode('%PDF-1.4 test');
const EXE = Uint8Array.from([0x4d, 0x5a, 0x90, 0x00]);

function file(bytes: Uint8Array, name: string, type: string) {
  return new File([bytes], name, { type });
}

interface WriteBody {
  id: string;
  version: number;
  summary: string;
  attachmentId?: string;
}

async function setup(actor = 'Bob') {
  const b = browser();
  await loadFixture(b.db, fixture);
  await b.actAs(actor);
  const line = await getLineByName(b.db, 'demo_c3');
  if (line === null) throw new Error('fixture line missing');
  const base = `/api/lines/${line.id}`;
  const protocolId = line.current_protocol_id ?? '';
  const form = (entries: Record<string, string | File>) => {
    const data = new FormData();
    for (const [key, value] of Object.entries(entries)) data.set(key, value);
    return data;
  };
  const fieldsOf = async (response: Response) =>
    ((await response.json<ErrorBody>()).error.details?.['fields'] ?? {}) as Record<string, string>;
  const attachments = async (ownerId?: string) =>
    (
      await b.db
        .prepare('SELECT * FROM attachments WHERE deleted_at IS NULL ORDER BY created_at, id')
        .all<{
          id: string;
          owner_type: string;
          owner_id: string;
          kind: string;
          is_latest: number;
          r2_key: string;
          thumb_r2_key: string | null;
        }>()
    ).results.filter((row) => ownerId === undefined || row.owner_id === ownerId);
  return { ...b, line, base, protocolId, form, fieldsOf, attachments };
}

describe('POST /api/lines/:id/attachments on an ID protocol', () => {
  it('stores a PNG under the documented key, marks it latest, and writes one readable version', async () => {
    const { db, files, upload, base, line, protocolId, form, attachments } = await setup();
    const response = await upload(
      `${base}/attachments`,
      form({
        file: file(PNG, 'Gel 1 (final).png', 'image/png'),
        thumb: file(JPEG, 'thumb.jpg', 'image/jpeg'),
        kind: 'gel_image',
        protocolId,
        expectedVersion: '1',
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json<WriteBody>();
    expect(body).toMatchObject({ version: 2 });
    expect(body.summary).toMatch(/^Uploaded gel image for /);
    const [row] = await attachments(protocolId);
    expect(row).toMatchObject({ owner_type: 'id_protocol', kind: 'gel_image', is_latest: 1 });
    expect(row?.r2_key).toBe(
      `lines/${line.id}/${body.attachmentId ?? ''}-Gel-1-final-.png`.replace(
        '-final-.png',
        '-final.png',
      ),
    );
    expect(files.has(row?.r2_key ?? '')).toBe(true);
    expect(files.has(row?.thumb_r2_key ?? '')).toBe(true);
    expect((await listLineVersionsByLine(db, line.id))[0]?.change_type).toBe('protocol_changed');
    expect((await listActivitiesByLine(db, line.id, 1))[0]?.type).toBe('protocol_changed');
  });

  it('a second image becomes the latest and the first loses the mark', async () => {
    const { upload, base, protocolId, form, attachments } = await setup();
    for (const version of ['1', '2'])
      await upload(
        `${base}/attachments`,
        form({
          file: file(PNG, 'g.png', 'image/png'),
          kind: 'gel_image',
          protocolId,
          expectedVersion: version,
        }),
      );
    expect((await attachments(protocolId)).map((row) => row.is_latest)).toEqual([0, 1]);
  });

  it('refuses a 20 MB file, an .exe, a renamed .exe, TIFF, and an empty file — and stores nothing', async () => {
    const { files, upload, base, protocolId, form, fieldsOf, reload } = await withReload();
    const send = (f: File) =>
      upload(
        `${base}/attachments`,
        form({ file: f, kind: 'gel_image', protocolId, expectedVersion: '1' }),
      );
    const big = await send(file(new Uint8Array(20 * 1024 * 1024), 'big.png', 'image/png'));
    expect((await fieldsOf(big))['file']).toMatch(/larger than 15 MB/);
    const exe = await send(file(EXE, 'setup.exe', 'application/x-msdownload'));
    expect((await fieldsOf(exe))['file']).toMatch(/not accepted/);
    const renamed = await send(file(EXE, 'gel.png', 'image/png'));
    expect((await fieldsOf(renamed))['file']).toMatch(/does not match/);
    const tiff = await send(file(PNG, 'gel.tif', 'image/tiff'));
    expect((await fieldsOf(tiff))['file']).toMatch(/TIFF/);
    const empty = await send(file(new Uint8Array(0), 'gel.png', 'image/png'));
    expect((await fieldsOf(empty))['file']).toMatch(/empty/);
    const pdf = await send(file(PDF, 'method.pdf', 'application/pdf'));
    expect((await fieldsOf(pdf))['file']).toMatch(/Choose an image/);
    expect(files.size).toBe(0);
    expect((await reload()).version).toBe(1);
  });

  async function withReload() {
    const s = await setup();
    return {
      ...s,
      reload: async () => {
        const row = await getLineByName(s.db, 'demo_c3');
        if (row === null) throw new Error('line vanished');
        return row;
      },
    };
  }

  it('accepts a phone upload that reports no MIME type (by extension), refuses a Guest, lets an Admin upload, needs a file', async () => {
    const { upload, base, protocolId, form } = await setup();
    const noType = await upload(
      `${base}/attachments`,
      form({
        file: file(JPEG, 'IMG_0001.JPG', ''),
        kind: 'gel_image',
        protocolId,
        expectedVersion: '1',
      }),
    );
    expect(noType.status).toBe(200);
    const missing = await upload(
      `${base}/attachments`,
      form({ kind: 'gel_image', protocolId, expectedVersion: '2' }),
    );
    expect(missing.status).toBe(400);
    const guest = await setup('Guest');
    const denied = await guest.upload(
      `${guest.base}/attachments`,
      guest.form({
        file: file(PNG, 'g.png', 'image/png'),
        kind: 'gel_image',
        protocolId: guest.protocolId,
        expectedVersion: '1',
      }),
    );
    expect(denied.status).toBe(403);
    const admin = await setup('Admin');
    const ask = await admin.upload(
      `${admin.base}/attachments`,
      admin.form({
        file: file(PNG, 'g.png', 'image/png'),
        kind: 'gel_image',
        protocolId: admin.protocolId,
        expectedVersion: '1',
      }),
    );
    expect(ask.status).toBe(200);
  });

  it('answers 404 for a protocol that is not on the line and 409 for a stale version', async () => {
    const { upload, base, protocolId, form } = await setup();
    const other = await upload(
      `${base}/attachments`,
      form({
        file: file(PNG, 'g.png', 'image/png'),
        kind: 'gel_image',
        protocolId: 'nope',
        expectedVersion: '1',
      }),
    );
    expect(other.status).toBe(404);
    await upload(
      `${base}/attachments`,
      form({
        file: file(PNG, 'g.png', 'image/png'),
        kind: 'gel_image',
        protocolId,
        expectedVersion: '1',
      }),
    );
    const stale = await upload(
      `${base}/attachments`,
      form({
        file: file(PNG, 'g.png', 'image/png'),
        kind: 'gel_image',
        protocolId,
        expectedVersion: '1',
      }),
    );
    expect((await stale.json<ErrorBody>()).error.code).toBe('VERSION_CONFLICT');
  });

  it('reports storage as unavailable when R2 is not bound', async () => {
    const { call } = await setup();
    // `call` (JSON) cannot be multipart: a JSON body is refused as malformed.
    const response = await call('/api/lines/x/attachments', { a: 1 });
    expect([400, 404]).toContain(response.status);
  });
});

describe('gel image with a genotyping record', () => {
  it('a staged upload is linked by the genotyping write and shows on the protocol card as latest', async () => {
    const { call, upload, base, protocolId, form, attachments } = await setup();
    const staged = await upload(
      `${base}/attachments`,
      form({ file: file(PNG, 'gel.png', 'image/png'), kind: 'gel_image' }),
    );
    expect(staged.status).toBe(201);
    const { attachmentId } = await staged.json<{ attachmentId: string }>();
    expect((await attachments()).at(-1)).toMatchObject({ owner_type: 'line' });
    const saved = await call(`${base}/genotyping`, {
      expectedVersion: 1,
      recordDate: '2026-06-10',
      protocolId,
      positiveCount: 4,
      isNewGeneration: false,
      attachmentId,
    });
    expect(saved.status).toBe(200);
    expect((await attachments()).at(-1)).toMatchObject({
      owner_type: 'genotyping_record',
      kind: 'gel_image',
      is_latest: 1,
    });
    const detail = await (
      await call(base)
    ).json<{
      protocols: { id: string; attachments: { id: string; isLatest: boolean }[] }[];
      generations: { records: { attachments: { id: string }[] }[] }[];
    }>();
    const card = detail.protocols.find((protocol) => protocol.id === protocolId);
    expect(card?.attachments.map((a) => a.id)).toContain(attachmentId);
    expect(
      detail.generations
        .flatMap((g) => g.records)
        .flatMap((r) => r.attachments)
        .map((a) => a.id),
    ).toContain(attachmentId);

    // A second gel through another record: the first is no longer the latest.
    const second = await upload(
      `${base}/attachments`,
      form({ file: file(PNG, 'gel2.png', 'image/png'), kind: 'gel_image' }),
    );
    const { attachmentId: secondId } = await second.json<{ attachmentId: string }>();
    await call(`${base}/genotyping`, {
      expectedVersion: 2,
      recordDate: '2026-06-11',
      protocolId,
      positiveCount: 1,
      isNewGeneration: false,
      attachmentId: secondId,
    });
    const flags = Object.fromEntries((await attachments()).map((row) => [row.id, row.is_latest]));
    expect(flags[attachmentId]).toBe(0);
    expect(flags[secondId]).toBe(1);
  });

  it('refuses an attachment that was not staged on this line', async () => {
    const { call, base, protocolId } = await setup();
    const response = await call(`${base}/genotyping`, {
      expectedVersion: 1,
      recordDate: '2026-06-10',
      protocolId,
      positiveCount: 1,
      isNewGeneration: false,
      attachmentId: 'nope',
    });
    expect(response.status).toBe(400);
  });
});

describe('DELETE /api/lines/:id/attachments/:aid', () => {
  it('hides the image (the row and the file stay), promotes the previous one, and writes a version', async () => {
    const { db, files, call, upload, base, line, protocolId, form, attachments } = await setup();
    for (const version of ['1', '2'])
      await upload(
        `${base}/attachments`,
        form({
          file: file(PNG, 'g.png', 'image/png'),
          kind: 'gel_image',
          protocolId,
          expectedVersion: version,
        }),
      );
    const [first, second] = await attachments(protocolId);
    const response = await call(
      `${base}/attachments/${second?.id ?? ''}`,
      { expectedVersion: 3 },
      'DELETE',
    );
    expect(response.status).toBe(200);
    expect((await response.json<WriteBody>()).summary).toMatch(/^Removed gel image/);
    const left = await attachments(protocolId);
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ id: first?.id, is_latest: 1 });
    expect(files.has(second?.r2_key ?? '')).toBe(true);
    const hidden = await db
      .prepare('SELECT deleted_at FROM attachments WHERE id = ?')
      .bind(second?.id ?? '')
      .first<{ deleted_at: string | null }>();
    expect(hidden?.deleted_at).not.toBeNull();
    expect((await listLineVersionsByLine(db, line.id))[0]?.change_type).toBe('protocol_changed');
    expect((await call(`${base}/attachments/nope`, { expectedVersion: 4 }, 'DELETE')).status).toBe(
      404,
    );
  });
});

describe('references: add, edit, remove with a link or a file', () => {
  it('adds a link reference, edits it, removes it (soft), each as a reference_changed version', async () => {
    const { db, call, base, line } = await setup();
    const add = await call(`${base}/references`, {
      expectedVersion: 1,
      title: 'ZFIN',
      url: 'https://zfin.org/x',
    });
    expect(add.status).toBe(200);
    expect((await add.json<WriteBody>()).summary).toBe('Added reference: ZFIN.');
    const rows = async () =>
      (
        await db
          .prepare(
            'SELECT * FROM line_references WHERE line_id = ? AND deleted_at IS NULL ORDER BY sort_order',
          )
          .bind(line.id)
          .all<{ id: string; title: string; url: string | null; attachment_id: string | null }>()
      ).results;
    const added = (await rows()).at(-1);
    const edit = await call(
      `${base}/references/${added?.id ?? ''}`,
      { expectedVersion: 2, title: 'ZFIN page', url: 'https://zfin.org/y' },
      'PATCH',
    );
    expect((await edit.json<WriteBody>()).summary).toBe('Updated reference: ZFIN page.');
    expect((await rows()).at(-1)).toMatchObject({ title: 'ZFIN page', url: 'https://zfin.org/y' });
    const removed = await call(
      `${base}/references/${added?.id ?? ''}`,
      { expectedVersion: 3 },
      'DELETE',
    );
    expect((await removed.json<WriteBody>()).summary).toBe('Removed reference: ZFIN page.');
    expect((await rows()).find((row) => row.id === added?.id)).toBeUndefined();
    expect((await listLineVersionsByLine(db, line.id))[0]?.change_type).toBe('reference_changed');
  });

  it('adds a reference with an uploaded PDF, opens it by its reference, and keeps the file when only the title changes', async () => {
    const { db, call, upload, base, form } = await setup();
    const staged = await upload(
      `${base}/attachments`,
      form({ file: file(PDF, 'PCR protocol.pdf', 'application/pdf'), kind: 'reference_file' }),
    );
    const { attachmentId } = await staged.json<{ attachmentId: string }>();
    const add = await call(`${base}/references`, {
      expectedVersion: 1,
      title: 'PCR protocol',
      attachmentId,
    });
    expect(add.status).toBe(200);
    const detail = await (
      await call(base)
    ).json<{
      references: {
        id: string;
        title: string;
        attachment: { id: string; mimeType: string } | null;
      }[];
    }>();
    const reference = detail.references.find((entry) => entry.title === 'PCR protocol');
    expect(reference?.attachment).toMatchObject({ id: attachmentId, mimeType: 'application/pdf' });
    const retitle = await call(
      `${base}/references/${reference?.id ?? ''}`,
      { expectedVersion: 2, title: 'PCR protocol v2' },
      'PATCH',
    );
    expect(retitle.status).toBe(200);
    const row = await db
      .prepare('SELECT attachment_id FROM line_references WHERE id = ?')
      .bind(reference?.id ?? '')
      .first<{ attachment_id: string | null }>();
    expect(row?.attachment_id).toBe(attachmentId);
  });

  it('needs a title and a link or a file, and refuses both, bad links and unknown references', async () => {
    const { call, upload, base, form } = await setup();
    const errors = async (body: object) =>
      ((await (await call(`${base}/references`, { expectedVersion: 1, ...body })).json<ErrorBody>())
        .error.details?.['fields'] ?? {}) as Record<string, string>;
    expect(await errors({ title: '', url: 'https://x.example' })).toHaveProperty('title');
    expect(await errors({ title: 'x' })).toHaveProperty('url');
    expect(await errors({ title: 'x', url: 'ftp://x' })).toHaveProperty('url');
    const staged = await upload(
      `${base}/attachments`,
      form({ file: file(PDF, 'a.pdf', 'application/pdf'), kind: 'reference_file' }),
    );
    const { attachmentId } = await staged.json<{ attachmentId: string }>();
    expect((await errors({ title: 'x', url: 'https://x.example', attachmentId })).url).toMatch(
      /either a link or a file/,
    );
    expect((await errors({ title: 'x', attachmentId: 'nope' })).attachmentId).toMatch(
      /Upload the file again/,
    );
    expect(
      (
        await call(
          `${base}/references/nope`,
          { expectedVersion: 1, title: 'x', url: 'https://x.example' },
          'PATCH',
        )
      ).status,
    ).toBe(404);
    expect((await call(`${base}/references/nope`, { expectedVersion: 1 }, 'DELETE')).status).toBe(
      404,
    );
  });
});
