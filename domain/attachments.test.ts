import { describe, expect, it } from 'vitest';
import {
  ACCEPT_ATTRIBUTE,
  IMAGE_ACCEPT_ATTRIBUTE,
  SEQUENCE_ACCEPT_ATTRIBUTE,
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
    const message = (
      file: { name: string; type: string; size: number },
      scope: 'any' | 'images' | 'sequence' = 'any',
    ) => {
      const result = checkUpload(file, scope);
      return result.ok ? '' : result.message;
    };
    expect(message({ name: 'a.png', type: 'image/png', size: 0 })).toBe(uploadMessages.empty);
    expect(message({ name: 'a.png', type: 'image/png', size: MAX_UPLOAD_BYTES + 1 })).toBe(
      uploadMessages.tooLarge,
    );
    expect(message({ name: 'a.exe', type: '', size: 5 })).toBe(uploadMessages.wrongType);
    expect(message({ name: 'a.pdf', type: 'application/pdf', size: 5 }, 'images')).toBe(
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

describe('sequence files (T-038)', () => {
  const file = (name: string, type = '') => ({ name, type, size: 100 });

  it.each([
    ['trace.ab1', 'application/x-abif', 'sequence-trace'],
    ['TRACE.ABI', 'application/x-abif', 'sequence-trace'],
    ['a.fasta', 'text/x-fasta', 'sequence-text'],
    ['a.fa', 'text/x-fasta', 'sequence-text'],
    ['a.fas', 'text/x-fasta', 'sequence-text'],
    ['a.seq', 'text/x-sequence', 'sequence-text'],
  ])('accepts %s by extension when the browser reports no type', (name, mimeType, kind) => {
    expect(checkUpload(file(name), 'sequence')).toEqual({ ok: true, mimeType, kind });
    expect(checkUpload(file(name, 'application/octet-stream'), 'any')).toMatchObject({ ok: true });
  });

  it('goes by the extension when the system reports another type for a sequence file', () => {
    for (const [name, type] of [
      ['a.fasta', 'text/plain'],
      ['a.seq', 'text/plain'],
      ['a.fa', 'chemical/x-fasta'],
      ['a.ab1', 'application/x-abi'],
      ['a.ab1', 'text/plain'],
    ])
      expect(checkUpload(file(name as string, type as string), 'sequence').ok).toBe(true);
    // Other files keep their type rules, and other text is still refused.
    expect(checkUpload(file('a.txt', 'text/plain'), 'any').ok).toBe(false);
    expect(checkUpload(file('a.png', 'text/plain'), 'any').ok).toBe(false);
    expect(checkUpload(file('a.fasta.exe', 'text/plain'), 'any').ok).toBe(false);
  });

  it('keeps each slot to its own files', () => {
    const sequence = checkUpload(file('a.png', 'image/png'), 'sequence');
    expect(sequence).toEqual({ ok: false, message: uploadMessages.notSequence });
    const image = checkUpload(file('a.ab1'), 'images');
    expect(image).toEqual({ ok: false, message: uploadMessages.notImage });
    expect(checkUpload(file('a.ab1'), 'any').ok).toBe(true);
  });

  it('lists the sequence extensions for the picker', () => {
    expect(SEQUENCE_ACCEPT_ATTRIBUTE).toBe('.ab1,.abi,.fasta,.fa,.fas,.seq');
    expect(ACCEPT_ATTRIBUTE).toContain('.ab1');
    expect(IMAGE_ACCEPT_ATTRIBUTE).not.toContain('.ab1');
  });

  it('checks the content: ABIF header, FASTA ">", plain text without NUL', () => {
    const text = (value: string) => Uint8Array.from(value, (char) => char.charCodeAt(0));
    expect(contentMatchesType(text('ABIF\u0000\u0001'), 'application/x-abif')).toBe(true);
    expect(contentMatchesType(text('>seq1\nACGT\n'), 'application/x-abif')).toBe(false);
    expect(contentMatchesType(text('>seq1\nACGT\n'), 'text/x-fasta')).toBe(true);
    expect(contentMatchesType(text('\n  \r\n>seq1\nACGT'), 'text/x-fasta')).toBe(true);
    expect(contentMatchesType(Uint8Array.of(0xef, 0xbb, 0xbf, 0x3e, 0x61), 'text/x-fasta')).toBe(
      true,
    );
    expect(contentMatchesType(text('ACGT\n>late'), 'text/x-fasta')).toBe(false);
    expect(contentMatchesType(text('   \n'), 'text/x-fasta')).toBe(false);
    expect(contentMatchesType(text('>a\u0000b'), 'text/x-fasta')).toBe(false);
    expect(contentMatchesType(text('ACGTACGT\n'), 'text/x-sequence')).toBe(true);
    expect(contentMatchesType(text(''), 'text/x-sequence')).toBe(false);
    expect(contentMatchesType(Uint8Array.of(0x41, 0x00, 0x42), 'text/x-sequence')).toBe(false);
    // A renamed binary: ABIF-less bytes, a PNG header, invalid UTF-8.
    expect(contentMatchesType(Uint8Array.of(0x89, 0x50, 0x4e, 0x47), 'text/x-sequence')).toBe(
      false,
    );
    expect(contentMatchesType(Uint8Array.of(0x3e, 0xff, 0xfe), 'text/x-fasta')).toBe(false);
  });

  it('allows a multi-byte character cut off at the end of the sample, but not a broken one', () => {
    // "é" is C3 A9; "€" is E2 82 AC; "😀" is F0 9F 98 80.
    expect(contentMatchesType(Uint8Array.of(0x3e, 0xc3), 'text/x-fasta')).toBe(true);
    expect(contentMatchesType(Uint8Array.of(0x3e, 0xe2, 0x82), 'text/x-fasta')).toBe(true);
    expect(contentMatchesType(Uint8Array.of(0x3e, 0xc3, 0xa9, 0x41), 'text/x-fasta')).toBe(true);
    expect(contentMatchesType(Uint8Array.of(0x3e, 0xf0, 0x9f, 0x98, 0x80), 'text/x-fasta')).toBe(
      true,
    );
    expect(contentMatchesType(Uint8Array.of(0x3e, 0xc3, 0x41), 'text/x-fasta')).toBe(false);
    expect(contentMatchesType(Uint8Array.of(0x3e, 0x80), 'text/x-fasta')).toBe(false);
    expect(contentMatchesType(Uint8Array.of(0x3e, 0xf5, 0x80), 'text/x-fasta')).toBe(false);
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
