import { request } from './api';
import type { EditResult } from './lineEditApi';

export type ActivityAction = 'start-breeding' | 'genotyping' | 'close' | 'reopen';

/** `POST /api/lines/:id/<action>` (T-013): the API answers `{ id, version, summary }`. */
export const postActivity = (
  id: string,
  action: ActivityAction,
  payload: Record<string, unknown>,
) =>
  request<Omit<EditResult, 'unchanged'>>(`/api/lines/${encodeURIComponent(id)}/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
