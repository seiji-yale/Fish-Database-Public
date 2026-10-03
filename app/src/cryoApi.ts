import { request } from './api';

export interface CryoWriteResult {
  id: string;
  version: number;
  summary: string;
}

const send = (method: string, path: string, body: unknown) =>
  request<CryoWriteResult>(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

const base = (lineId: string) => `/api/lines/${encodeURIComponent(lineId)}/cryo`;

export const addCryo = (lineId: string, payload: Record<string, unknown>) =>
  send('POST', base(lineId), payload);

export const editCryo = (lineId: string, id: string, payload: Record<string, unknown>) =>
  send('PATCH', `${base(lineId)}/${encodeURIComponent(id)}`, payload);

export const removeCryo = (lineId: string, id: string, payload: Record<string, unknown>) =>
  send('DELETE', `${base(lineId)}/${encodeURIComponent(id)}`, payload);

/** FR-CRYO-03: the next free Cryo ID over all lines, e.g. `C0637`. */
export const getNextCryoId = () => request<{ nextId: string }>('/api/cryo/next-id');

/** Record vials as used (they leave the list; their IDs are never reused). */
export const recordCryoUse = (lineId: string, payload: Record<string, unknown>) =>
  send('POST', `${base(lineId)}/use`, payload);

/** Undo a recorded vial use: the vial goes back into its record (T-028). */
export const undoCryoUse = (lineId: string, useId: string, payload: Record<string, unknown>) =>
  send('POST', `${base(lineId)}/uses/${encodeURIComponent(useId)}/undo`, payload);
