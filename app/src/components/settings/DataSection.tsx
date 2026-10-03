/** Data & Backup tab (FR-ADM-04): export, Dropbox mirror status, usage card, deleted items with Restore. */
import { useCallback, useEffect, useState } from 'react';
import {
  EXPORT_ZIP_URL,
  getDeleted,
  restoreDeleted,
  runMirrorNow,
  setReadOnly,
  SNAPSHOT_URL,
  type DeletedItem,
} from '../../adminApi';
import { READ_ONLY_CHANGED } from '../../adminEvents';
import { formatDateTime } from '../../dateFormat';
import { strings } from '../../strings';
import { EmptyState } from '../shared';
import type { SectionProps } from './types';

export function DataSection({ overview, admin, reload }: SectionProps) {
  const [items, setItems] = useState<DeletedItem[] | null>(null);

  const loadDeleted = useCallback(() => {
    void getDeleted()
      .then((result) => {
        setItems(result.items);
      })
      .catch(() => {
        setItems([]);
      });
  }, []);
  useEffect(() => {
    loadDeleted();
  }, [loadDeleted]);

  const { mirror } = overview;
  return (
    <div className="settings-section">
      <h2>{strings.dataExportHeading}</h2>
      <p>{strings.dataExportBody}</p>
      <p className="settings-buttons">
        <button
          type="button"
          className="button--primary"
          disabled={admin.busy}
          onClick={() => {
            void admin.write(() => runMirrorNow({}), {
              doneMessage: (result) =>
                strings.dataExportNowDone((result as { filesWritten: number }).filesWritten),
              onSuccess: reload,
            });
          }}
        >
          {admin.busy ? strings.dataExportNowBusy : strings.dataExportNow}
        </button>
        <a href={EXPORT_ZIP_URL} download>
          {strings.dataDownloadZip}
        </a>
        <a href={SNAPSHOT_URL} download>
          {strings.dataDownloadSnapshot}
        </a>
      </p>

      <h2>{strings.dataMirrorHeading}</h2>
      {!mirror.connected ? <p>{strings.dataMirrorNotConnected}</p> : null}
      {mirror.lastOkAt === null && mirror.lastError === null ? (
        <p>{strings.dataMirrorNone}</p>
      ) : (
        <>
          {mirror.lastOkAt === null ? null : (
            <p>{strings.dataMirrorOk(formatDateTime(mirror.lastOkAt))}</p>
          )}
          {mirror.lastError === null ? null : (
            <p className="form-field__error">{strings.dataMirrorError(mirror.lastError)}</p>
          )}
        </>
      )}
      {mirror.connected ? (
        <>
          <p>{strings.dataMirrorFolder(mirror.folder)}</p>
          <p>
            {mirror.lastTickAt === null
              ? strings.dataMirrorTickNone
              : strings.dataMirrorTick(formatDateTime(mirror.lastTickAt))}
          </p>
          <p>{mirror.pending ? strings.dataMirrorPending : strings.dataMirrorUpToDate}</p>
        </>
      ) : null}
      {mirror.runs.length === 0 ? null : (
        <>
          <h3>{strings.dataMirrorRuns}</h3>
          <ul className="settings-list">
            {mirror.runs.map((run) => (
              <li key={run.startedAt} className="settings-row">
                <span className="settings-row__main">
                  <span className="chip">{strings.dataMirrorRunKind[run.kind]}</span>
                  <time dateTime={run.startedAt}>{formatDateTime(run.startedAt)}</time>
                  <span className={run.status === 'ok' ? undefined : 'form-field__error'}>
                    {run.status === 'ok'
                      ? strings.dataMirrorRunOk(run.filesWritten)
                      : strings.dataMirrorRunFailed(run.error ?? '')}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      <h2>{strings.readOnlyHeading}</h2>
      <p>{strings.readOnlyBody}</p>
      <p className={overview.readOnly ? 'form-field__error' : undefined}>
        {overview.readOnly ? strings.readOnlyIsOn : strings.readOnlyIsOff}
      </p>
      <p className="settings-buttons">
        <button
          type="button"
          disabled={admin.busy}
          onClick={() => {
            const enabled = !overview.readOnly;
            void admin.write(() => setReadOnly({ enabled }), {
              doneMessage: strings.readOnlyDone(enabled),
              onSuccess: () => {
                reload();
                window.dispatchEvent(new Event(READ_ONLY_CHANGED));
              },
            });
          }}
        >
          {overview.readOnly ? strings.readOnlyTurnOff : strings.readOnlyTurnOn}
        </button>
      </p>

      <h2>{strings.dataUsageHeading}</h2>
      <p>{strings.dataUsageNone}</p>

      <h2>{strings.deletedHeading}</h2>
      <p>{strings.deletedIntro}</p>
      {items === null ? (
        <p>{strings.loading}</p>
      ) : items.length === 0 ? (
        <EmptyState message={strings.deletedEmpty} />
      ) : (
        <ul className="settings-list deleted-list">
          {items.map((item) => (
            <li key={`${item.type}-${item.id}`} className="settings-row">
              <span className="settings-row__main">
                <span className="chip">{strings.deletedType[item.type]}</span>
                <strong>{item.label}</strong>
                <span>{item.lineName ?? strings.deletedLabLine}</span>
                <time dateTime={item.deletedAt}>{formatDateTime(item.deletedAt)}</time>
              </span>
              {item.notRestorable === null ? (
                <button
                  type="button"
                  aria-label={strings.deletedRestoreFor(item.label)}
                  disabled={admin.busy}
                  onClick={() => {
                    void admin.write(() => restoreDeleted(item.type, item.id, {}), {
                      doneMessage: strings.deletedDone,
                      onSuccess: loadDeleted,
                    });
                  }}
                >
                  {strings.deletedRestore}
                </button>
              ) : (
                <span className="form-field__hint">
                  {strings.deletedNotRestorable(item.notRestorable)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
