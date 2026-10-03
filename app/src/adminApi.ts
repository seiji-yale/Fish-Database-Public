/** `/api/admin/*` (T-018): everything the Settings page reads and writes. Admin only. */
import { request } from './api';

export interface AdminUser {
  id: string;
  name: string;
  role: 'admin' | 'member' | 'guest';
  isActive: boolean;
  isBuiltin: boolean;
  /** Waiting for the first sign-in through an invite. */
  invitePending: boolean;
  /** A password exists (false: never invited). */
  canSignIn: boolean;
}

export interface AdminListEntry {
  id: string;
  value: string;
  isActive: boolean;
}

export interface AdminList {
  kind: 'id_method_type' | 'fluorophore' | 'cryo_place' | 'request_type' | 'attribute_key';
  editable: boolean;
  entries: AdminListEntry[];
}

export interface AdminOverview {
  users: AdminUser[];
  lists: AdminList[];
  settings: {
    databaseName: string;
    upcomingBreedingMonths: number;
    defaultAnnealingC: number;
    defaultCycles: number;
  };
  importReport: string | null;
  readOnly: boolean;
  mirror: {
    lastOkAt: string | null;
    lastError: string | null;
    /** The Dropbox secrets exist on this server. */
    connected: boolean;
    folder: string;
    lastTickAt: string | null;
    /** Changes are waiting for the next copy. */
    pending: boolean;
    runs: MirrorRun[];
  };
}

export interface MirrorRun {
  kind: 'on_change' | 'nightly' | 'manual';
  status: 'ok' | 'failed';
  startedAt: string;
  finishedAt: string | null;
  filesWritten: number;
  error: string | null;
}

export interface DeletedItem {
  type: 'protocol' | 'cryo' | 'reference' | 'attachment' | 'message';
  id: string;
  lineId: string | null;
  lineName: string | null;
  label: string;
  deletedAt: string;
  notRestorable: string | null;
}

const send = (method: string, path: string, body: unknown) =>
  request<Record<string, unknown>>(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

export const getOverview = () => request<AdminOverview>('/api/admin/overview');
export const getDeleted = () => request<{ items: DeletedItem[] }>('/api/admin/deleted');

export const addUser = (body: Record<string, unknown>) => send('POST', '/api/admin/users', body);
export const updateUser = (id: string, body: Record<string, unknown>) =>
  send('PATCH', `/api/admin/users/${encodeURIComponent(id)}`, body);
export const addListEntry = (body: Record<string, unknown>) =>
  send('POST', '/api/admin/enumerations', body);
export const updateListEntry = (id: string, body: Record<string, unknown>) =>
  send('PATCH', `/api/admin/enumerations/${encodeURIComponent(id)}`, body);
export const saveSettings = (body: Record<string, unknown>) =>
  send('PATCH', '/api/admin/settings', body);
/** Delete a removed user for good; refused while the person appears in History (T-030). */
export const deleteUser = (id: string) =>
  send('DELETE', `/api/admin/users/${encodeURIComponent(id)}`, {});
export const rotateGuestLink = () => send('POST', '/api/admin/guest-link/rotate', {});
export const addInvite = (id: string, body: Record<string, unknown>) =>
  send('POST', `/api/admin/users/${encodeURIComponent(id)}/invite`, body);
export const restoreDeleted = (type: string, id: string, body: Record<string, unknown>) =>
  send(
    'POST',
    `/api/admin/deleted/${encodeURIComponent(type)}/${encodeURIComponent(id)}/restore`,
    body,
  );

export const setReadOnly = (body: Record<string, unknown>) =>
  send('PUT', '/api/admin/read-only', body);
export const runMirrorNow = (body: Record<string, unknown>) =>
  send('POST', '/api/admin/mirror/run', body);

export const EXPORT_ZIP_URL = '/api/admin/export.zip';
export const SNAPSHOT_URL = '/api/admin/snapshot.html';
