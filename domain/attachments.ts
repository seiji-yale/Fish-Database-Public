/**
 * Upload rules (T-016, FR-REF-01/02, OQ-15, NFR-07): which files are accepted, how big, how they are
 * named in storage. Shared by the API (which enforces them) and the uploader (which checks first so
 * the person gets the message before waiting for an upload).
 */

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
/** Thumbnails are made in the browser (≤ 400 px JPEG); anything larger is not a thumbnail. */
export const MAX_THUMB_BYTES = 1024 * 1024;

export type UploadKind = 'image' | 'pdf' | 'docx';

/** Accepted types: JPG, PNG, WebP, HEIC/HEIF, PDF, DOCX (no TIFF, no SVG). */
export const ACCEPTED_TYPES: Readonly<Record<string, { kind: UploadKind; extensions: string[] }>> =
  {
    'image/jpeg': { kind: 'image', extensions: ['jpg', 'jpeg'] },
    'image/png': { kind: 'image', extensions: ['png'] },
    'image/webp': { kind: 'image', extensions: ['webp'] },
    'image/heic': { kind: 'image', extensions: ['heic'] },
    'image/heif': { kind: 'image', extensions: ['heif'] },
    'application/pdf': { kind: 'pdf', extensions: ['pdf'] },
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
      kind: 'docx',
      extensions: ['docx'],
    },
  };

/** For `<input accept>`: the types plus their extensions (some phones report no MIME type). */
export const ACCEPT_ATTRIBUTE = Object.entries(ACCEPTED_TYPES)
  .flatMap(([type, { extensions }]) => [type, ...extensions.map((extension) => `.${extension}`)])
  .join(',');

export const IMAGE_ACCEPT_ATTRIBUTE = Object.entries(ACCEPTED_TYPES)
  .filter(([, entry]) => entry.kind === 'image')
  .flatMap(([type, { extensions }]) => [type, ...extensions.map((extension) => `.${extension}`)])
  .join(',');

export const uploadMessages = {
  tooLarge:
    'This file is larger than 15 MB. Make it smaller (for example export the gel as JPG) and try again.',
  empty: 'This file is empty. Choose another file.',
  wrongType:
    'This file type is not accepted. Use JPG, PNG, WebP, HEIC or PDF (and DOCX for references). TIFF is not accepted: export the gel as PNG or JPG.',
  notImage: 'Choose an image (JPG, PNG, WebP or HEIC).',
  contentMismatch: 'The file content does not match its type. Export it again and retry.',
  heicUnsupported:
    'This browser cannot open HEIC photos, so they would show as broken images. Export the photo as JPG or PNG first, or upload it from an iPhone or Safari (which convert it automatically).',
} as const;

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot < 0 ? '' : fileName.slice(dot + 1).toLowerCase();
}

/**
 * The accepted MIME type for a file, from its reported type or, when the browser reports none
 * (common on phones), from its extension. Null when neither is accepted.
 */
export function acceptedType(fileName: string, reportedType: string): string | null {
  const reported = (reportedType.toLowerCase().split(';')[0] as string).trim();
  if (reported in ACCEPTED_TYPES) return reported;
  const extension = extensionOf(fileName);
  const match = Object.entries(ACCEPTED_TYPES).find(([, entry]) =>
    entry.extensions.includes(extension),
  );
  return reported === '' || reported === 'application/octet-stream' ? (match?.[0] ?? null) : null;
}

export type UploadCheck =
  { ok: true; mimeType: string; kind: UploadKind } | { ok: false; message: string };

/** Size and type; `imagesOnly` for protocol and gel images. */
export function checkUpload(
  file: { name: string; type: string; size: number },
  imagesOnly = false,
): UploadCheck {
  if (file.size === 0) return { ok: false, message: uploadMessages.empty };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, message: uploadMessages.tooLarge };
  const mimeType = acceptedType(file.name, file.type);
  if (mimeType === null) return { ok: false, message: uploadMessages.wrongType };
  const kind = (ACCEPTED_TYPES[mimeType] as { kind: UploadKind }).kind;
  if (imagesOnly && kind !== 'image') return { ok: false, message: uploadMessages.notImage };
  return { ok: true, mimeType, kind };
}

/**
 * The first bytes of each accepted type (the API checks them, so a renamed `.exe` is refused).
 * HEIC/HEIF are ISO-BMFF files: bytes 4..7 are `ftyp`. DOCX is a ZIP file.
 */
export function contentMatchesType(bytes: Uint8Array, mimeType: string): boolean {
  const starts = (...values: number[]) => values.every((value, index) => bytes[index] === value);
  const ascii = (from: number, text: string) =>
    Array.from(text).every((char, index) => bytes[from + index] === char.charCodeAt(0));
  switch (mimeType) {
    case 'image/jpeg':
      return starts(0xff, 0xd8, 0xff);
    case 'image/png':
      return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case 'image/webp':
      return ascii(0, 'RIFF') && ascii(8, 'WEBP');
    case 'image/heic':
    case 'image/heif':
      return ascii(4, 'ftyp');
    case 'application/pdf':
      return ascii(0, '%PDF-');
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return starts(0x50, 0x4b, 0x03, 0x04);
    default:
      return false;
  }
}

/** A storage-safe version of a file name: letters, digits, `.`, `-`, `_`; at most 80 characters. */
export function safeFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() as string;
  const cleaned = base
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/-+\./g, '.')
    .replace(/^[-.]+|[-.]+$/g, '');
  const trimmed = cleaned.slice(-80).replace(/^[-.]+/, '');
  return trimmed === '' ? 'file' : trimmed;
}

/** `lines/<line_id>/<attachment_id>-<safe_file_name>` (docs/03-data-model.md 2.10, the mirror maps it). */
export function attachmentKey(lineId: string, attachmentId: string, fileName: string): string {
  return `lines/${lineId}/${attachmentId}-${safeFileName(fileName)}`;
}

export function thumbnailKey(lineId: string, attachmentId: string): string {
  return `lines/${lineId}/${attachmentId}-thumb.jpg`;
}
