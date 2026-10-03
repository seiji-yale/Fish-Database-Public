/**
 * A ≤ 400 px JPEG thumbnail made in the browser (T-016, FR-REF-02): lists and cards load these
 * instead of the original. Returns null when the browser cannot decode the file (HEIC outside
 * Safari, PDF, DOCX): the original is still stored and shown by its link.
 */
const MAX_SIDE = 400;

export async function makeThumbnail(file: File): Promise<Blob | null> {
  if (!file.type.startsWith('image/')) return null;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (context === null) return null;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', 0.8);
    });
  } catch {
    return null;
  }
}

/** HEIC/HEIF photos (iPhone): by type, or by extension when the browser reports none. */
export function isHeic(file: { name: string; type: string }): boolean {
  return /^image\/hei[cf]$/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
}

/**
 * HEIC cannot be shown by Chrome, Edge or Firefox, so an uploaded HEIC would arrive as a broken
 * image there. Where the browser can decode it (Safari, iOS) the photo is converted to a full-size
 * JPEG here and that JPEG is uploaded; where it cannot, this returns null and the caller refuses the
 * file with `uploadMessages.heicUnsupported`.
 */
export async function convertHeicToJpeg(file: File): Promise<File | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (context === null) return null;
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', 0.92);
    });
    if (blob === null) return null;
    return new File([blob], file.name.replace(/\.(heic|heif)$/i, '') + '.jpg', {
      type: 'image/jpeg',
    });
  } catch {
    return null;
  }
}
