import { request } from './api';

export interface EditResult {
  id: string;
  version: number;
  summary: string;
  unchanged: boolean;
}

export interface RestorePreview {
  versionNo: number;
  currentVersion: number;
  changes: { path: string; before: unknown; after: unknown }[];
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const patchLine = (id: string, payload: Record<string, unknown>) =>
  request<EditResult>(`/api/lines/${encodeURIComponent(id)}`, {
    ...json(payload),
    method: 'PATCH',
  });

export const getRestorePreview = (id: string, versionNo: number) =>
  request<RestorePreview>(
    `/api/lines/${encodeURIComponent(id)}/restore/${String(versionNo)}/preview`,
  );

export const restoreVersion = (id: string, versionNo: number, payload: Record<string, unknown>) =>
  request<EditResult>(
    `/api/lines/${encodeURIComponent(id)}/restore/${String(versionNo)}`,
    json(payload),
  );
