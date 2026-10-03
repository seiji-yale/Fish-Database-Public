import { AppShell } from './components/AppShell';
import { GuestEntryPage, JoinPage } from './pages/AccountPages';
import { LineDetailPage } from './pages/LineDetailPage';
import { LinesPage } from './pages/LinesPage';
import { NewLinePage } from './pages/NewLinePage';
import { DashboardPage } from './pages/DashboardPage';
import { PrintPage } from './pages/PrintPage';
import { SettingsPage } from './pages/SettingsPage';
import { StyleGuide } from './StyleGuide';
import { strings } from './strings';

function page(path: string) {
  if (path === '/dev/styleguide') return <StyleGuide />;
  if (path === '/') return <DashboardPage />;
  if (path === '/lines') return <LinesPage />;
  if (path === '/lines/new') return <NewLinePage />;
  if (path === '/settings') return <SettingsPage />;
  const printMatch = /^\/lines\/([^/]+)\/print$/.exec(path);
  if (printMatch !== null) return <PrintPage id={decodeURIComponent(printMatch[1] ?? '')} />;
  // `/lines/new` is not a line id; everything else under `/lines/` is.
  const detailMatch = /^\/lines\/([^/]+)$/.exec(path);
  if (detailMatch !== null && detailMatch[1] !== 'new')
    return <LineDetailPage id={decodeURIComponent(detailMatch[1] ?? '')} />;
  return (
    <section className="page-placeholder">
      <h1>{path === '/' ? strings.dashboard : strings.lines}</h1>
      <p>{strings.placeholder}</p>
    </section>
  );
}

export function App() {
  // Invite and Guest links work before anybody is signed in, so they sit outside the app shell.
  const join = /^\/join\/([^/]+)$/.exec(window.location.pathname);
  if (join !== null) return <JoinPage token={decodeURIComponent(join[1] ?? '')} />;
  const guest = /^\/guest\/([^/]+)$/.exec(window.location.pathname);
  if (guest !== null) return <GuestEntryPage token={decodeURIComponent(guest[1] ?? '')} />;
  const currentPage = page(window.location.pathname);
  return window.location.pathname.endsWith('/print') ? (
    currentPage
  ) : (
    <AppShell>{currentPage}</AppShell>
  );
}
