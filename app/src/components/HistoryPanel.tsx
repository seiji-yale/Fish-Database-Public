/**
 * History panel, read view (T-009 Step 5, FR-HIST-01, docs/04-ui-spec.md §5.7): versions newest
 * first as `2026-06-30 14:02 · Bob · summary`, with `Show changes` opening a
 * Field | Before | After table in glossary wording. T-012: Admin (and only Admin) sees `Restore this
 * version` on every version but the newest; it opens a confirmation that shows the changes the
 * restore would make, and creates a new version (nothing is overwritten).
 */
import { useEffect, useState } from 'react';
import { HttpError } from '../api';
import { formatDateTime } from '../dateFormat';
import { diffFieldLabel, formatDiffValue } from '../lineDetailFormat';
import type { LineDetailProtocol, LineDetailVersion } from '../lineDetailApi';
import {
  getRestorePreview,
  restoreVersion,
  type EditResult,
  type RestorePreview,
} from '../lineEditApi';
import { strings } from '../strings';
import { EmptyState, ConfirmDialog } from './shared';

export function DiffTable({
  diff,
  protocols,
}: {
  diff: LineDetailVersion['diff'];
  protocols: readonly LineDetailProtocol[];
}) {
  if (diff.length === 0) return <p>{strings.noFieldChanges}</p>;
  const labels = new Map(protocols.map((protocol) => [protocol.id, protocol.label]));
  return (
    <table className="diff-table">
      <thead>
        <tr>
          <th scope="col">{strings.diffField}</th>
          <th scope="col">{strings.diffBefore}</th>
          <th scope="col">{strings.diffAfter}</th>
        </tr>
      </thead>
      <tbody>
        {diff.map((change) => (
          <tr key={change.path}>
            <th scope="row">{diffFieldLabel(change.path)}</th>
            <td>{formatDiffValue(change.path, change.before, labels)}</td>
            <td>{formatDiffValue(change.path, change.after, labels)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function VersionItem({
  version,
  protocols,
  onRestore,
}: {
  version: LineDetailVersion;
  protocols: readonly LineDetailProtocol[];
  /** Present only when the viewer may restore this version (Admin, not the newest version). */
  onRestore?: ((versionNo: number) => void) | undefined;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className="history-item">
      <p>
        <strong>{formatDateTime(version.createdAt)}</strong>
        {` · ${version.createdByName} · ${version.summary}`}
      </p>
      {version.note === null ? null : <p>{version.note}</p>}
      <div className="history-item__actions">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => {
            setOpen((current) => !current);
          }}
        >
          {open ? strings.hideChanges : strings.showChanges}
        </button>
        {onRestore === undefined ? null : (
          <button
            type="button"
            onClick={() => {
              onRestore(version.versionNo);
            }}
          >
            {strings.restoreVersion}
          </button>
        )}
      </div>
      {open ? <DiffTable diff={version.diff} protocols={protocols} /> : null}
    </li>
  );
}

/** The Admin's restore flow for one version: preview -> confirm -> (who?) -> POST. */
function RestoreFlow({
  lineId,
  versionNo,
  currentVersion,
  protocols,
  onDone,
  onCancel,
}: {
  lineId: string;
  versionNo: number;
  currentVersion: number;
  protocols: readonly LineDetailProtocol[];
  onDone: (result: EditResult, versionNo: number) => void;
  onCancel: () => void;
}) {
  const [preview, setPreview] = useState<RestorePreview | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getRestorePreview(lineId, versionNo)
      .then((result) => {
        if (!cancelled) setPreview(result);
      })
      .catch((cause: unknown) => {
        if (!cancelled)
          setMessage(
            cause instanceof HttpError && cause.body !== null
              ? cause.body.message
              : strings.restoreLoadFailed,
          );
      });
    return () => {
      cancelled = true;
    };
  }, [lineId, versionNo]);

  async function restore() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await restoreVersion(lineId, versionNo, { expectedVersion: currentVersion });
      onDone(result, versionNo);
    } catch (cause: unknown) {
      setMessage(
        cause instanceof HttpError && cause.body !== null
          ? cause.body.message
          : strings.restoreFailed,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <ConfirmDialog
        title={strings.restoreTitle(versionNo)}
        confirmLabel={strings.restoreConfirm}
        confirmDisabled={busy || preview === null || preview.changes.length === 0}
        onCancel={onCancel}
        onConfirm={() => {
          void restore();
        }}
      >
        <p>{strings.restoreIntro}</p>
        {preview === null ? (
          message === null ? (
            <p>{strings.loading}</p>
          ) : null
        ) : preview.changes.length === 0 ? (
          <p>{strings.restoreNoDifference}</p>
        ) : (
          <DiffTable diff={preview.changes} protocols={protocols} />
        )}
        {message === null ? null : <p role="alert">{message}</p>}
      </ConfirmDialog>
    </>
  );
}

export function HistoryPanel({
  versions,
  protocols,
  restore,
}: {
  versions: readonly LineDetailVersion[];
  protocols: readonly LineDetailProtocol[];
  /** Given only to Admin: the line, its current version, the user list, and what to do afterwards. */
  restore?: {
    lineId: string;
    onRestored: (result: EditResult, versionNo: number) => void;
  };
}) {
  const [restoring, setRestoring] = useState<number | null>(null);
  if (versions.length === 0) return <EmptyState />;
  const newestFirst = [...versions].sort((a, b) => b.versionNo - a.versionNo);
  const newest = newestFirst[0]?.versionNo ?? 0;
  return (
    <>
      <ul className="history-list scroll-list" tabIndex={0} aria-label={strings.history}>
        {newestFirst.map((version) => (
          <VersionItem
            key={version.id}
            version={version}
            protocols={protocols}
            onRestore={
              restore === undefined || version.versionNo === newest ? undefined : setRestoring
            }
          />
        ))}
      </ul>
      {restore === undefined || restoring === null ? null : (
        <RestoreFlow
          lineId={restore.lineId}
          versionNo={restoring}
          currentVersion={newest}
          protocols={protocols}
          onCancel={() => {
            setRestoring(null);
          }}
          onDone={(result, versionNo) => {
            setRestoring(null);
            restore.onRestored(result, versionNo);
          }}
        />
      )}
    </>
  );
}
