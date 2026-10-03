import { describe, expect, it } from 'vitest';
import {
  ACCEPT_ATTRIBUTE,
  IMAGE_ACCEPT_ATTRIBUTE,
  MAX_UPLOAD_BYTES,
  acceptedType,
  attachmentKey,
  checkUpload,
  contentMatchesType,
  safeFileName,
  thumbnailKey,
  uploadMessages,
} from './attachments';

const bytes = (...values: number[]) => Uint8Array.from(values);
const text = (value: string) => Uint8Array.from(Array.from(value, (char) => char.charCodeAt(0)));

describe('acceptedType', () => {
  it('trusts a known MIME type, falls back to the extension only when none is reported', () => {
    expect(acceptedType('a.png', 'image/png')).toBe('image/png');
    expect(acceptedType('a.png', 'IMAGE/PNG; charset=x')).toBe('image/png');
    expect(acceptedType('IMG_1.JPG', '')).toBe('image/jpeg');
    expect(acceptedType('IMG_1.heic', 'application/octet-stream')).toBe('image/heic');
    expect(acceptedType('gel.tif', 'image/tiff')).toBeNull();
    expect(acceptedType('x.exe', 'application/x-msdownload')).toBeNull();
    expect(acceptedType('noextension', '')).toBeNull();
    expect(acceptedType('x.exe', '')).toBeNull();
  });
});

describe('checkUpload', () => {
  it('checks size, type and (for images) the kind', () => {
    expect(checkUpload({ name: 'a.png', type: 'image/png', size: 10 })).toEqual({
      ok: true,
      mimeType: 'image/png',
      kind: 'image',
    });
    expect(checkUpload({ name: 'a.pdf', type: 'application/pdf', size: 10 })).toMatchObject({
      ok: true,
      kind: 'pdf',
    });
    expect(checkUpload({ name: 'a.docx', type: '', size: 10 })).toMatchObject({
      ok: true,
      kind: 'docx',
    });
    const message = (file: { name: string; type: string; size: number }, imagesOnly = false) => {
      const result = checkUpload(file, imagesOnly);
      return result.ok ? '' : result.message;
    };
    expect(message({ name: 'a.png', type: 'image/png', size: 0 })).toBe(uploadMessages.empty);
    expect(message({ name: 'a.png', type: 'image/png', size: MAX_UPLOAD_BYTES + 1 })).toBe(
      uploadMessages.tooLarge,
    );
    expect(message({ name: 'a.exe', type: '', size: 5 })).toBe(uploadMessages.wrongType);
    expect(message({ name: 'a.pdf', type: 'application/pdf', size: 5 }, true)).toBe(
      uploadMessages.notImage,
    );
    expect(checkUpload({ name: 'a.png', type: 'image/png', size: MAX_UPLOAD_BYTES }).ok).toBe(true);
  });

  it('lists the accepted types for the file pickers', () => {
    expect(ACCEPT_ATTRIBUTE).toContain('application/pdf');
    expect(ACCEPT_ATTRIBUTE).toContain('.docx');
    expect(IMAGE_ACCEPT_ATTRIBUTE).toContain('.heic');
    expect(IMAGE_ACCEPT_ATTRIBUTE).not.toContain('pdf');
  });
});

describe('contentMatchesType', () => {
  it('checks the first bytes of every accepted type', () => {
    expect(contentMatchesType(bytes(0xff, 0xd8, 0xff, 0xe0), 'image/jpeg')).toBe(true);
    expect(
      contentMatchesType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), 'image/png'),
    ).toBe(true);
    expect(contentMatchesType(text('RIFF\0\0\0\0WEBPVP8 '), 'image/webp')).toBe(true);
    expect(contentMatchesType(text('\0\0\0\x18ftypheic'), 'image/heic')).toBe(true);
    expect(contentMatchesType(text('\0\0\0\x18ftypmif1'), 'image/heif')).toBe(true);
    expect(contentMatchesType(text('%PDF-1.7'), 'application/pdf')).toBe(true);
    expect(
      contentMatchesType(
        bytes(0x50, 0x4b, 0x03, 0x04),
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ),
    ).toBe(true);
  });

  it('refuses mismatches and unknown types', () => {
    expect(contentMatchesType(bytes(0x4d, 0x5a, 0x90), 'image/png')).toBe(false);
    expect(contentMatchesType(text('RIFF\0\0\0\0WAVEfmt '), 'image/webp')).toBe(false);
    expect(contentMatchesType(text('%PDF-1.7'), 'image/jpeg')).toBe(false);
    expect(contentMatchesType(bytes(1, 2, 3), 'image/svg+xml')).toBe(false);
  });
});

describe('storage keys', () => {
  it('cleans file names and follows lines/<line>/<attachment>-<name>', () => {
    expect(safeFileName('Gel 1 (final).png')).toBe('Gel-1-final.png');
    expect(safeFileName('../../etc/passwd')).toBe('passwd');
    expect(safeFileName('C:\\x\\gel é.jpg')).toBe('gel-e.jpg');
    expect(safeFileName('...')).toBe('file');
    expect(safeFileName('')).toBe('file');
    expect(safeFileName(`${'a'.repeat(200)}.png`)).toHaveLength(80);
    expect(attachmentKey('L1', 'A1', 'gel 1.png')).toBe('lines/L1/A1-gel-1.png');
    expect(thumbnailKey('L1', 'A1')).toBe('lines/L1/A1-thumb.jpg');
  });
});
