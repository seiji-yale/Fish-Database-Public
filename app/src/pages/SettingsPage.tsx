/**
 * `/settings` (T-018, FR-ADM-01…05, docs/04-ui-spec.md §7): the Admin's page — Users, Lists,
 * Preferences (with Access and the Admin password), Data & Backup (export, deleted items) and the
 * Import report. Everything here is Admin only: anyone else sees how to become Admin, and the API
 * refuses them anyway.
 */
import { useCallback, useEffect, useState } from 'react';
import { getOverview, type AdminOverview } from '../adminApi';
import { DataSection } from '../components/settings/DataSection';
import { ListsSection } from '../components/settings/ListsSection';
import { PreferencesSection } from '../components/settings/PreferencesSection';
import { UsersSection } from '../components/settings/UsersSection';
import { EmptyState, Skeleton, Toast } from '../components/shared';
import { strings } from '../strings';
import { useActingUser } from '../useActingUser';
import { useAdminWrite } from '../useAdminWrite';

const TABS = [
  { id: 'users', label: strings.tabUsers },
  { id: 'lists', label: strings.tabLists },
  { id: 'preferences', label: strings.tabPreferences },
  { id: 'data', label: strings.tabData },
  { id: 'import', label: strings.tabImportReport },
] as const;
type TabId = (typeof TABS)[number]['id'];

function initialTab(): TabId {
  const hash = window.location.hash.slice(1);
  return TABS.find((tab) => tab.id === hash)?.id ?? 'users';
}

export function SettingsPage() {
  const acting = useActingUser();
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<TabId>(initialTab);
  const admin = useAdminWrite();

  const reload = useCallback(() => {
    void getOverview()
      .then((next) => {
        setOverview(next);
        setFailed(false);
      })
      .catch(() => {
        setFailed(true);
      });
  }, []);

  useEffect(() => {
    if (acting.role === 'admin') reload();
  }, [acting.role, reload]);

  if (acting.name === null) return <Skeleton lines={4} />;
  if (acting.role !== 'admin') {
    return (
      <section className="settings-page">
        <h1>{strings.settingsTitle}</h1>
        <EmptyState message={strings.settingsAdminOnly} />
      </section>
    );
  }
  if (failed) return <p role="alert">{strings.settingsLoadFailed}</p>;
  if (overview === null) return <Skeleton lines={6} />;

  const shared = { overview, admin, reload };
  return (
    <section className="settings-page">
      <h1>{strings.settingsTitle}</h1>
      {admin.message === null ? null : (
        <Toast
          message={admin.message}
          onClose={() => {
            admin.setMessage(null);
          }}
        />
      )}
      <div className="settings-tabs" role="tablist" aria-label={strings.settingsTabs}>
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={tab === entry.id}
            className={tab === entry.id ? 'is-selected' : ''}
            onClick={() => {
              setTab(entry.id);
              window.history.replaceState(null, '', `#${entry.id}`);
            }}
          >
            {entry.label}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === 'users' ? <UsersSection {...shared} /> : null}
        {tab === 'lists' ? <ListsSection {...shared} /> : null}
        {tab === 'preferences' ? <PreferencesSection {...shared} /> : null}
        {tab === 'data' ? <DataSection {...shared} /> : null}
        {tab === 'import' ? (
          overview.importReport === null ? (
            <EmptyState message={strings.importReportNone} />
          ) : (
            <pre className="import-report">{overview.importReport}</pre>
          )
        ) : null}
      </div>
      {admin.dialog}
    </section>
  );
}
