import { request } from './api';

export interface ReferenceWriteResult {
  id: string;
  version: number;
  summary: string;
}

const send = (method: string, path: string, body: unknown) =>
  request<ReferenceWriteResult>(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const base = (lineId: string) => `/api/lines/${encodeURIComponent(lineId)}/references`;

export const addReference = (lineId: string, payload: Record<string, unknown>) =>
  send('POST', base(lineId), payload);
export const editReference = (lineId: string, id: string, payload: Record<string, unknown>) =>
  send('PATCH', `${base(lineId)}/${encodeURIComponent(id)}`, payload);
export const removeReference = (lineId: string, id: string, payload: Record<string, unknown>) =>
  send('DELETE', `${base(lineId)}/${encodeURIComponent(id)}`, payload);
