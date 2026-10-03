import { request } from './api';

export interface ProtocolWriteResult {
  id: string;
  version: number;
  summary: string;
  /** Problems that did not block saving (repeated label, odd sequence characters). */
  warnings?: Record<string, string>;
  /** Set by a removal: the removed protocol was the line's current ID method. */
  methodCleared?: boolean;
}

const send = (method: string, path: string, body: unknown) =>
  request<ProtocolWriteResult>(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const base = (lineId: string) => `/api/lines/${encodeURIComponent(lineId)}/protocols`;

export const addProtocol = (lineId: string, payload: Record<string, unknown>) =>
  send('POST', base(lineId), payload);

export const editProtocol = (lineId: string, id: string, payload: Record<string, unknown>) =>
  send('PATCH', `${base(lineId)}/${encodeURIComponent(id)}`, payload);

export const removeProtocol = (lineId: string, id: string, payload: Record<string, unknown>) =>
  send('DELETE', `${base(lineId)}/${encodeURIComponent(id)}`, payload);

export const setCurrentProtocol = (lineId: string, id: string, payload: Record<string, unknown>) =>
  send('POST', `${base(lineId)}/${encodeURIComponent(id)}/set-current`, payload);

export const reorderProtocols = (lineId: string, payload: Record<string, unknown>) =>
  send('POST', `${base(lineId)}/reorder`, payload);
