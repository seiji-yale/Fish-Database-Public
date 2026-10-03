/**
 * Uploading a file to a line (T-016): `POST /api/lines/:id/attachments` as multipart, with upload
 * progress (`fetch` cannot report it, so this uses XMLHttpRequest). A failed upload throws the same
 * `HttpError` as every other call, so the forms handle errors the same way.
 */
import { HttpError, type ApiErrorBody } from './api';
import { makeThumbnail } from './thumbnail';

export interface UploadOptions {
  file: File;
  kind: 'gel_image' | 'fluorescence_image' | 'sequence_result' | 'reference_file' | 'other';
  /** An image for this ID protocol (one line version); omitted = a staged upload. */
  protocolId?: string;
  /** With `protocolId`: the version the page was loaded with (BR-12). */
  expectedVersion?: number;
  caption?: string;
  onProgress?: (percent: number) => void;
}

export interface UploadResult {
  attachmentId: string;
  id?: string;
  version?: number;
  summary?: string;
}

export async function uploadFile(lineId: string, options: UploadOptions): Promise<UploadResult> {
  const form = new FormData();
  form.set('file', options.file);
  form.set('kind', options.kind);
  const thumb = await makeThumbnail(options.file);
  if (thumb !== null) form.set('thumb', thumb, 'thumb.jpg');
  if (options.protocolId !== undefined) form.set('protocolId', options.protocolId);
  if (options.expectedVersion !== undefined)
    form.set('expectedVersion', String(options.expectedVersion));
  if (options.caption !== undefined && options.caption !== '') form.set('caption', options.caption);

  return new Promise<UploadResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/lines/${encodeURIComponent(lineId)}/attachments`);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable)
        options.onProgress?.(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onerror = () => {
      reject(new HttpError(0));
    };
    xhr.onload = () => {
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(xhr.responseText);
      } catch {
        /* not JSON */
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        const body = parsed as UploadResult & { id?: string };
        resolve({ ...body, attachmentId: body.attachmentId });
        return;
      }
      const error = (parsed as { error?: ApiErrorBody } | null)?.error;
      reject(new HttpError(xhr.status, typeof error?.code === 'string' ? error : null));
    };
    xhr.send(form);
  });
}

/** `DELETE /api/lines/:id/attachments/:aid`: hides an image or file (kept for good, BR-7). */
export async function removeAttachment(
  lineId: string,
  attachmentId: string,
  payload: Record<string, unknown>,
): Promise<{ version: number; summary: string }> {
  const response = await fetch(
    `/api/lines/${encodeURIComponent(lineId)}/attachments/${encodeURIComponent(attachmentId)}`,
    {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );
  if (!response.ok) {
    let error: ApiErrorBody | null = null;
    try {
      error = ((await response.json()) as { error?: ApiErrorBody }).error ?? null;
    } catch {
      /* ignore */
    }
    throw new HttpError(response.status, error);
  }
  return (await response.json()) as { version: number; summary: string };
}
