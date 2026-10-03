import { request } from './api';
export interface SessionUser {
  id: string;
  name: string;
  role: 'admin' | 'member' | 'guest';
}
export interface SessionState {
  /** Database display name configured by an Admin. */
  appName: string;
  /** Who is signed in on this browser (ADR-0005); null = nobody, the sign-in page shows. */
  user: SessionUser | null;
  /** The Admin gave this user an initial password: they must choose their own first. */
  mustChangePassword: boolean;
  /** An Admin is restoring the database: nobody can change data (T-021). */
  readOnly: boolean;
  /** Only sent to a signed-in Admin: the Dropbox copy failed or is more than a day old. */
  mirrorStale: boolean;
}
const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

/** Fired after signing in or out and after a password change: the shell and pages re-read the session. */
export const SESSION_CHANGED = 'session-changed';
export const APP_NAME_CHANGED = 'app-name-changed';
/** Fired by `request` when the API says nobody is signed in (a session that ended elsewhere). */
export const LOGIN_REQUIRED = 'login-required';

export const getSession = () => request<SessionState>('/api/session');
export const getUsers = () => request<SessionUser[]>('/api/users');
export const signIn = (name: string, password: string) =>
  request('/api/session/login', json('POST', { name, password }));
export const signOut = () => request('/api/session/logout', json('POST', {}));
export const changeOwnPassword = (currentPassword: string, newPassword: string) =>
  request('/api/session/password', json('POST', { currentPassword, newPassword }));
export const getInvite = (token: string) =>
  request<{ name: string; role: SessionUser['role'] }>(`/api/join/${encodeURIComponent(token)}`);
export const acceptInvite = (token: string, initialPassword: string, newPassword: string) =>
  request(`/api/join/${encodeURIComponent(token)}`, json('POST', { initialPassword, newPassword }));
export const enterAsGuest = (token: string) =>
  request(`/api/guest/${encodeURIComponent(token)}`, json('POST', {}));
export const getGuestLink = () => request<{ token: string | null }>('/api/guest-link');
export const guestUrl = (token: string) => `${window.location.origin}/guest/${token}`;
export const inviteUrl = (token: string) => `${window.location.origin}/join/${token}`;
