import { request } from './api';

/** `POST /api/lines` response (`worker/routes/lines.ts`). */
export interface CreatedLine {
  id: string;
  name: string;
  version: number;
  summary: string;
  warnings: Record<string, string>;
}

export interface NameCheck {
  available: boolean;
  existing?: { id: string; name: string };
}

export type EnumerationKind = 'fluorophore' | 'cryo_place' | 'attribute_key';

export const createLine = (payload: Record<string, unknown>) =>
  request<CreatedLine>('/api/lines', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

export const checkLineName = (name: string) =>
  request<NameCheck>(`/api/lines/check-name?name=${encodeURIComponent(name)}`);

export const getEnumeration = (kind: EnumerationKind) =>
  request<{ kind: EnumerationKind; values: string[] }>(`/api/enumerations?kind=${kind}`);
