/**
 * Who is signed in on this page (T-012, ADR-0005): pages show Admin-only controls (Restore) and need
 * the user list for pickers. `AppShell` announces sign-in, sign-out and password changes with
 * `ACTING_USER_CHANGED`; the hook re-reads the session when it hears it.
 */
import { useEffect, useState } from 'react';
import { getSession, getUsers, type SessionUser } from './session';

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
}

export function useActingUser(): ActingUserState {
  const [state, setState] = useState<ActingUserState>({
    role: 'guest',
    users: [],
    name: null,
    id: null,
  });

  useEffect(() => {
    let cancelled = false;
    function load() {
      void Promise.all([getSession(), getUsers().catch(() => [] as SessionUser[])])
        .then(([session, users]) => {
          if (cancelled) return;
          setState({
            role: session.user?.role ?? 'guest',
            users,
            name: session.user?.name ?? 'Guest',
            id: session.user?.id ?? null,
          });
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

  return state;
}
