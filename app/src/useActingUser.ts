/**
 * Who is signed in on this page (T-012, ADR-0005): pages show Admin-only controls (Restore) and need
 * the user list for pickers. `AppShell` announces sign-in, sign-out and password changes with
 * `ACTING_USER_CHANGED`; the hook re-reads the session when it hears it.
 */
import { useEffect, useState } from 'react';
import type { Capability } from '../../domain/permissions';
import { getSession, getUsers, type SessionState, type SessionUser } from './session';

export const ACTING_USER_CHANGED = 'acting-user-changed';
/** Settings adds, renames or removes a person: every user list re-reads. */
export const USERS_CHANGED = 'users-changed';

export interface ActingUserState {
  role: SessionUser['role'];
  users: SessionUser[];
  /** The signed-in person's name; null until the session is read. */
  name: string | null;
  /** The signed-in person's id (null for nobody). */
  id: string | null;
  /** What this role may do; the API enforces the same table (BR-15). */
  capabilities: Capability[];
}

export type ActingUser = ActingUserState & { can: (capability: Capability) => boolean };

const NOBODY: ActingUserState = {
  role: 'guest',
  users: [],
  name: null,
  id: null,
  capabilities: [],
};
/** The last session read, so a page that mounts after the shell starts with the right capabilities. */
let known: ActingUserState = NOBODY;

/** `AppShell` calls this with each session it reads, before it renders the page. */
export function rememberSession(session: SessionState): void {
  known = {
    role: session.user?.role ?? 'guest',
    users: known.users,
    name: session.user?.name ?? 'Guest',
    id: session.user?.id ?? null,
    capabilities: session.capabilities,
  };
}

export function useActingUser(): ActingUser {
  const [state, setState] = useState<ActingUserState>(known);

  useEffect(() => {
    let cancelled = false;
    function load() {
      void Promise.all([getSession(), getUsers().catch(() => [] as SessionUser[])])
        .then(([session, users]) => {
          if (cancelled) return;
          known = {
            role: session.user?.role ?? 'guest',
            users,
            name: session.user?.name ?? 'Guest',
            id: session.user?.id ?? null,
            capabilities: session.capabilities,
          };
          setState(known);
        })
        .catch(() => undefined);
    }
    load();
    window.addEventListener(ACTING_USER_CHANGED, load);
    window.addEventListener(USERS_CHANGED, load);
    return () => {
      cancelled = true;
      window.removeEventListener(ACTING_USER_CHANGED, load);
      window.removeEventListener(USERS_CHANGED, load);
    };
  }, []);

  return { ...state, can: (capability) => state.capabilities.includes(capability) };
}
