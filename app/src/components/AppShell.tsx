import { type ReactNode, useEffect, useState } from 'react';
import {
  APP_NAME_CHANGED,
  getSession,
  SESSION_CHANGED,
  LOGIN_REQUIRED,
  type SessionState,
} from '../session';
import { READ_ONLY_CHANGED } from '../adminEvents';
import { setAppName, strings } from '../strings';
import { ACTING_USER_CHANGED } from '../useActingUser';
import { loadProtocolDefaults } from '../protocolDefaults';
import { ChangePasswordPage, SignInPage } from '../pages/AccountPages';
import { AccountMenu } from './AccountMenu';
import { HeaderSearch } from './HeaderSearch';
import { installSlashShortcut } from '../slashShortcut';
import { Toast } from './shared';
import { CHAT_STATE_CHANGED, getChatCounts } from '../chatApi';
const navigation = [
  { href: '/', label: strings.dashboard },
  { href: '/lines', label: strings.lines },
  { href: '/lines/new', label: strings.newLine },
  // The phone tab opens Lines with its search box focused (there is no separate search page).
  { href: '/lines#search', label: strings.search },
];
export function AppShell({ children }: { children: ReactNode }) {
  /** undefined = not read yet; the sign-in page shows when `user` is null. */
  const [session, setSession] = useState<SessionState | undefined>(undefined);
  const [expired, setExpired] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const user = session?.user ?? null;

  function loadSession(): void {
    void getSession()
      .then((next) => {
        if (typeof next.appName === 'string' && next.appName !== '') {
          setAppName(next.appName);
          document.title = next.appName;
        }
        setSession(next);
        setExpired(false);
        window.dispatchEvent(new Event(ACTING_USER_CHANGED));
        if (next.user !== null) void loadProtocolDefaults();
      })
      .catch(() => {
        // Offline: keep what is shown.
      });
  }
  useEffect(loadSession, []);
  useEffect(() => {
    window.addEventListener(APP_NAME_CHANGED, loadSession);
    return () => {
      window.removeEventListener(APP_NAME_CHANGED, loadSession);
    };
  }, []);
  // `/` focuses the search box (T-026).
  useEffect(installSlashShortcut, []);
  // Signing in or out, or a password change: read the session again. A request that finds the
  // session ended (signed out elsewhere, user removed) brings the sign-in page back.
  useEffect(() => {
    const onChanged = () => {
      setChangingPassword(false);
      loadSession();
    };
    const onExpired = () => {
      setExpired(true);
      setSession((current) => (current === undefined ? current : { ...current, user: null }));
    };
    window.addEventListener(SESSION_CHANGED, onChanged);
    window.addEventListener(LOGIN_REQUIRED, onExpired);
    return () => {
      window.removeEventListener(SESSION_CHANGED, onChanged);
      window.removeEventListener(LOGIN_REQUIRED, onExpired);
    };
  }, []);
  // The read-only banner is for everyone: re-read it now and then, on focus, and when Settings switches it.
  useEffect(() => {
    const refresh = () => {
      void getSession()
        .then((fresh) => {
          if (typeof fresh.appName === 'string' && fresh.appName !== '') {
            setAppName(fresh.appName);
            document.title = fresh.appName;
          }
          setSession((current) => {
            if (current === undefined) return current;
            if (current.user === null) return { ...current, appName: fresh.appName };
            return {
              ...current,
              appName: fresh.appName,
              readOnly: fresh.readOnly,
              mirrorStale: fresh.mirrorStale,
            };
          });
        })
        .catch(() => undefined);
    };
    const interval = window.setInterval(refresh, 60_000);
    window.addEventListener(READ_ONLY_CHANGED, refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener(READ_ONLY_CHANGED, refresh);
      window.removeEventListener('focus', refresh);
    };
  }, []);
  const userId = user?.id ?? null;
  useEffect(() => {
    if (userId === null) return;
    const refreshUnread = () => {
      void getChatCounts()
        .then((counts) => {
          setUnreadMessages(counts.unread);
        })
        .catch(() => undefined);
    };
    refreshUnread();
    const interval = window.setInterval(refreshUnread, 30_000);
    window.addEventListener(CHAT_STATE_CHANGED, refreshUnread);
    window.addEventListener('focus', refreshUnread);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener(CHAT_STATE_CHANGED, refreshUnread);
      window.removeEventListener('focus', refreshUnread);
    };
  }, [userId]);

  if (session === undefined) return <main className="account-screen" aria-busy="true" />;
  if (user === null) return <SignInPage notice={expired ? strings.loginExpired : undefined} />;
  if (session.mustChangePassword || changingPassword)
    return <ChangePasswordPage forced={session.mustChangePassword} />;
  return (
    <div className="app-shell">
      <a className="skip-link" href="#content">
        {strings.search}
      </a>
      <header className={`app-header ${user.role === 'admin' ? 'app-header--admin' : ''}`}>
        <a className="app-brand" href="/">
          {strings.appName}
        </a>
        <nav className="top-nav" aria-label={strings.appName}>
          {navigation.slice(0, 3).map((item) => (
            <a key={item.href} href={item.href}>
              {item.label}
            </a>
          ))}
        </nav>
        <HeaderSearch />
        <a
          className="chat-header-link"
          href="/#unread-messages"
          aria-label={strings.chatUnreadBadge(unreadMessages)}
        >
          {strings.labChat}
          {unreadMessages > 0 ? <span className="chat-header-badge">{unreadMessages}</span> : null}
        </a>
        <AccountMenu
          user={user}
          onChangePassword={() => {
            setChangingPassword(true);
          }}
          onMessage={setToast}
        />
        {user.role === 'admin' ? (
          <a className="settings-link" href="/settings" aria-label={strings.settings}>
            {strings.settingsIcon}
          </a>
        ) : null}
      </header>
      {user.role === 'guest' ? (
        <aside className="guest-banner" role="status">
          {strings.guestView}
        </aside>
      ) : null}
      {session.readOnly ? (
        <aside className="admin-banner" role="alert">
          <span>{strings.readOnlyBanner}</span>
        </aside>
      ) : null}
      {user.role === 'admin' && session.mirrorStale ? (
        <aside className="admin-banner" role="alert">
          <span>{strings.mirrorStaleBanner}</span>
          <a className="admin-banner__link" href="/settings#data">
            {strings.mirrorStaleBannerLink}
          </a>
        </aside>
      ) : null}
      <main id="content" className="content-container">
        {children}
      </main>
      <nav className="bottom-tabs" aria-label={strings.appName}>
        {navigation.map((item) => (
          <a key={item.href} href={item.href}>
            {item.label}
          </a>
        ))}
      </nav>
      {toast === null ? null : (
        <Toast
          message={toast}
          onClose={() => {
            setToast(null);
          }}
        />
      )}
    </div>
  );
}
