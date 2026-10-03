/** The signed-in person's menu in the header (ADR-0005): change password, copy the guest link, sign out. */
import { useEffect, useRef, useState } from 'react';
import { getGuestLink, guestUrl, signOut, SESSION_CHANGED, type SessionUser } from '../session';
import { strings } from '../strings';

export function AccountMenu({
  user,
  onChangePassword,
  onMessage,
}: {
  user: SessionUser;
  onChangePassword: () => void;
  onMessage: (message: string) => void;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    function close(event: Event) {
      const menu = ref.current;
      if (menu === null || !menu.open) return;
      if (event.type === 'click' && menu.contains(event.target as Node)) return;
      menu.open = false;
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') close(event);
    }
    document.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  function close() {
    if (ref.current !== null) ref.current.open = false;
  }
  function leave() {
    close();
    setBusy(true);
    void signOut()
      .catch(() => undefined)
      .finally(() => {
        window.dispatchEvent(new Event(SESSION_CHANGED));
        setBusy(false);
      });
  }
  function copyGuestLink() {
    close();
    void getGuestLink()
      .then(async ({ token }) => {
        if (token === null) return;
        await navigator.clipboard.writeText(guestUrl(token));
        onMessage(strings.guestLinkCopied);
      })
      .catch(() => {
        onMessage(strings.requestFailed);
      });
  }
  const isGuest = user.role === 'guest';
  return (
    <details className="account-menu acting-as" ref={ref}>
      <summary aria-label={strings.menuFor(user.name)}>
        <span className="account-menu__name">{user.name}</span>
        {user.role === 'admin' ? <span className="chip">{strings.roleAdmin}</span> : null}
        {isGuest ? <span className="chip">{strings.roleGuest}</span> : null}
      </summary>
      <ul className="account-menu__list">
        {isGuest ? null : (
          <>
            <li>
              <button
                type="button"
                onClick={() => {
                  close();
                  onChangePassword();
                }}
              >
                {strings.changePassword}
              </button>
            </li>
            <li>
              <button type="button" onClick={copyGuestLink}>
                {strings.shareGuestLink}
              </button>
            </li>
          </>
        )}
        <li>
          <button type="button" onClick={leave} disabled={busy}>
            {strings.signOut}
          </button>
        </li>
      </ul>
    </details>
  );
}
