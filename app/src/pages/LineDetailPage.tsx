/**
 * `/lines/:id` (T-009, FR-LINE-01, §5.1 of docs/04-ui-spec.md): read-only Line Detail. This step
 * builds the page shell (title row, disabled Change Activity/Edit, phone section-jump bar, desktop
 * two-column layout with a Chat placeholder in the side panel — T-017) and the Summary section
 * (grid of label/value pairs, phenotype chips, More attributes, Last Update/Created). The other
 * sections are their own components: ID Protocols (`ProtocolCards`), Cryopreservation
 * (`CryoTable`), References (`ReferenceList`), Activity (`GenerationTimeline`) and History
 * (`HistoryPanel`). Everything here is read-only; Edit/Change Activity arrive with T-012/T-013.
 */
import { useEffect, useState } from 'react';
import { EmptyState, Field, Skeleton, StatusBadge, Toast } from '../components/shared';
import {
  CloseLineDialog,
  GenotypingDialog,
  ReopenLineDialog,
  StartBreedingDialog,
} from '../components/ActivityDialogs';
import {
  ChangeActivityMenu,
  menuItems,
  type ActivityChoice,
} from '../components/ChangeActivityMenu';
import { timelineEvents } from '../activityEvents';
import { CryoManager } from '../components/CryoManager';
import { GenerationTimeline } from '../components/GenerationTimeline';
import { EditLineDialog } from '../components/EditLineDialog';
import { HistoryPanel } from '../components/HistoryPanel';
import { ProtocolManager } from '../components/ProtocolManager';
import { ReferenceManager } from '../components/ReferenceManager';
import { ChatPanel } from '../components/ChatPanel';
import { formatDate, formatDateTime } from '../dateFormat';
import { HttpError } from '../api';
import { takeFlash } from '../flash';
import { getLineDetail, type LineDetailDocument } from '../lineDetailApi';
import type { EditResult } from '../lineEditApi';
import { strings } from '../strings';
import { useActingUser } from '../useActingUser';

const SECTIONS = [
  { id: 'summary', label: strings.sectionSummary },
  { id: 'protocols', label: strings.jumpIdProtocols },
  { id: 'cryo', label: strings.jumpCryo },
  { id: 'refs', label: strings.jumpReferences },
  { id: 'activity', label: strings.sectionActivity },
  { id: 'chat', label: strings.chat },
  { id: 'history', label: strings.history },
] as const;

function SummarySection({ line }: { line: LineDetailDocument }) {
  const currentMethods = line.protocols
    .filter((protocol) => protocol.isCurrent)
    .map((protocol) => protocol.label)
    .join(', ');
  return (
    <section id="summary" className="detail-section">
      <h2>{strings.sectionSummary}</h2>
      <div className="detail-grid">
        <Field label={strings.dob}>
          {line.dob === null ? strings.emptyValue : formatDate(line.dob)}
        </Field>
        <Field label={strings.age}>
          {line.ageMonths === null ? strings.emptyValue : strings.ageMonths(line.ageMonths)}
        </Field>
        <Field label={strings.idedNumber}>{line.idedNumber}</Field>
        <Field label={strings.lastIdDate}>
          {line.lastIdDate === null ? strings.emptyValue : formatDate(line.lastIdDate)}
        </Field>
        <Field label={strings.currentIdMethod}>
          {currentMethods === '' ? strings.idMethodNone : currentMethods}
        </Field>
        <Field label={strings.cryopreserved}>
          {line.isCryopreserved
            ? `${strings.yes} (${strings.cryoSummaryCount(line.cryoRecords.length, line.cryoStrawCount)})`
            : strings.no}
        </Field>
        {line.status === 'Breeding' && line.breedingStartedAt !== null ? (
          <Field label={strings.breedingSince}>{formatDate(line.breedingStartedAt)}</Field>
        ) : null}
        {line.status === 'Closed' && line.closedAt !== null ? (
          <Field label={strings.closedOn}>{formatDate(line.closedAt)}</Field>
        ) : null}
        {line.status === 'Closed' && line.closedReason !== null ? (
          <Field label={strings.closedReasonLabel}>{line.closedReason}</Field>
        ) : null}
        <Field label={strings.columnNotes}>{line.notes ?? strings.emptyValue}</Field>
        <Field label={strings.columnLastUpdate}>
          {`${formatDateTime(line.updatedAt)} (${line.updatedByName})`}
        </Field>
        <Field
          label={strings.created}
        >{`${formatDateTime(line.createdAt)} (${line.createdByName})`}</Field>
      </div>
      <div className="detail-field detail-field--block">
        <strong>{strings.phenotypes}</strong>
        {line.phenotypes.length === 0 ? (
          <span>{strings.emptyValue}</span>
        ) : (
          <span className="chip-row">
            {line.phenotypes.map((phenotype) => (
              <span className="chip" key={phenotype.id}>
                {phenotype.description}
              </span>
            ))}
          </span>
        )}
      </div>
      {line.attributes.length > 0 ? (
        <div className="detail-field detail-field--block">
          <strong>{strings.moreAttributes}</strong>
          <ul className="attribute-list">
            {line.attributes.map((attribute) => (
              <li
                key={attribute.id}
              >{`${attribute.key}: ${attribute.value ?? strings.emptyValue}`}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

/** `?action=` deep links from the Dashboard (T-010 / T-013): open the matching dialog directly. */
function choiceFromUrl(): ActivityChoice | null {
  const action = new URLSearchParams(window.location.search).get('action');
  if (action === 'start-breeding') return 'start-breeding';
  if (action === 'update-genotyping') return 'genotyping';
  return null;
}

/** Drops `?action=` once it has been read, so a reload does not open the dialog again. */
function forgetActionInUrl(): void {
  const params = new URLSearchParams(window.location.search);
  if (!params.has('action')) return;
  params.delete('action');
  const rest = params.toString();
  window.history.replaceState(
    null,
    '',
    `${window.location.pathname}${rest === '' ? '' : `?${rest}`}${window.location.hash}`,
  );
}

export function LineDetailPage({ id }: { id: string }) {
  const [line, setLine] = useState<LineDetailDocument | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A one-shot confirmation left by the page that sent us here (e.g. "Line X was created", T-011).
  const [flash, setFlash] = useState<string | null>(takeFlash);

  const [editing, setEditing] = useState(false);
  const [addingProtocol, setAddingProtocol] = useState(false);
  const [addingCryo, setAddingCryo] = useState(false);
  const [activity, setActivity] = useState<ActivityChoice | null>(choiceFromUrl);
  const acting = useActingUser();
  useEffect(forgetActionInUrl, []);

  // `id` is set once from the URL at mount and never changes without a full page reload (this app
  // has no client router), so the initial `useState` values above are the only "reset" this needs.
  // `reloadKey` refetches after a save or a restore.
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    let cancelled = false;
    getLineDetail(id)
      .then((document) => {
        if (!cancelled) setLine(document);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        if (cause instanceof HttpError && cause.status === 404) setNotFound(true);
        else setError(strings.requestFailed);
      });
    return () => {
      cancelled = true;
    };
  }, [id, reloadKey]);

  if (notFound) {
    return (
      <section className="line-detail-page">
        <EmptyState message={strings.lineNotFound} />
        <a className="button--primary" href="/lines">
          {strings.backToLines}
        </a>
      </section>
    );
  }
  if (error !== null) return <p role="alert">{error}</p>;
  if (line === null) return <Skeleton lines={8} />;

  return (
    <section className="line-detail-page">
      {flash === null ? null : (
        <Toast
          message={flash}
          onClose={() => {
            setFlash(null);
          }}
        />
      )}
      <nav className="section-jump" aria-label={strings.appName}>
        {SECTIONS.map((section) => (
          <a key={section.id} href={`#${section.id}`}>
            {section.label}
          </a>
        ))}
      </nav>
      <header className="detail-title">
        <h1>{line.name}</h1>
        <StatusBadge status={line.status} />
        <span>{`${strings.gene}: ${line.gene ?? strings.emptyValue}`}</span>
        {acting.role === 'guest' ? null : (
          <button
            type="button"
            onClick={() => {
              setEditing(true);
            }}
          >
            {strings.edit}
          </button>
        )}
        <details className="export-menu">
          <summary>{`${strings.exportMenu} ${strings.dropdownIcon}`}</summary>
          <div className="export-menu__items">
            <a href={`/lines/${encodeURIComponent(id)}/print`}>{strings.exportPdf}</a>
            <a href={`/api/lines/${encodeURIComponent(id)}.csv`}>{strings.exportCsv}</a>
          </div>
        </details>
      </header>
      <ChangeActivityMenu
        status={line.status}
        canEdit={acting.role === 'admin' || acting.role === 'member'}
        onChoose={(choice) => {
          if (choice === 'edit-details') setEditing(true);
          else if (choice === 'cryo') {
            setAddingCryo(true);
            document.getElementById('cryo')?.scrollIntoView();
          } else if (choice === 'id-method') {
            setAddingProtocol(true);
            document.getElementById('protocols')?.scrollIntoView();
          } else setActivity(choice);
        }}
      />
      <div className="detail-layout">
        <div className="detail-main">
          <SummarySection line={line} />
          <section id="protocols" className="detail-section">
            <h2>{strings.sectionIdProtocols}</h2>
            <ProtocolManager
              line={line}
              canEdit={acting.role === 'admin' || acting.role === 'member'}
              adding={addingProtocol}
              onAddingChange={setAddingProtocol}
              onChanged={(message) => {
                setFlash(message);
                setReloadKey((key) => key + 1);
              }}
            />
          </section>
          <section id="cryo" className="detail-section">
            <h2>{strings.sectionCryopreservation}</h2>
            <CryoManager
              line={line}
              canEdit={acting.role === 'admin' || acting.role === 'member'}
              adding={addingCryo}
              onAddingChange={setAddingCryo}
              onChanged={(message) => {
                setFlash(message);
                setReloadKey((key) => key + 1);
              }}
            />
          </section>
          <section id="refs" className="detail-section">
            <h2>{strings.references}</h2>
            <ReferenceManager
              line={line}
              canEdit={acting.role === 'admin' || acting.role === 'member'}
              onChanged={(message) => {
                setFlash(message);
                setReloadKey((key) => key + 1);
              }}
            />
          </section>
          <section id="activity" className="detail-section">
            <h2>{strings.sectionActivity}</h2>
            <GenerationTimeline
              generations={line.generations}
              events={timelineEvents(line.versions, line.generationNo)}
              currentGenerationNo={line.generationNo}
              currentDob={line.dob}
            />
          </section>
        </div>
        <aside className="detail-side">
          <section id="chat" className="detail-section">
            <h2>{strings.chat}</h2>
            <ChatPanel scope={{ lineId: line.id }} />
          </section>
          <section id="history" className="detail-section">
            <h2>{strings.history}</h2>
            <HistoryPanel
              versions={line.versions}
              protocols={line.protocols}
              {...(acting.role === 'admin'
                ? {
                    restore: {
                      lineId: line.id,
                      onRestored: (result: EditResult, versionNo: number) => {
                        setFlash(strings.restoreDone(versionNo, result.version));
                        setReloadKey((key) => key + 1);
                      },
                    },
                  }
                : {})}
            />
          </section>
        </aside>
      </div>
      {activityDialog(line, activity, {
        onClose: () => {
          setActivity(null);
        },
        onDone: (result) => {
          setActivity(null);
          setFlash(result.message);
          setReloadKey((key) => key + 1);
        },
      })}
      {editing ? (
        <EditLineDialog
          line={line}
          onClose={() => {
            setEditing(false);
          }}
          onSaved={(result) => {
            setEditing(false);
            setFlash(
              result.unchanged ? strings.lineUnchanged : strings.lineUpdated(result.version),
            );
            setReloadKey((key) => key + 1);
          }}
        />
      ) : null}
    </section>
  );
}

/**
 * The open Change Activity dialog, or the reason it cannot open (a Dashboard link for a line whose
 * status has changed since: e.g. Start Breeding on a line that is already breeding).
 */
function activityDialog(
  line: LineDetailDocument,
  choice: ActivityChoice | null,
  handlers: Pick<Parameters<typeof StartBreedingDialog>[0], 'onClose' | 'onDone'>,
) {
  if (choice === null || choice === 'edit-details' || choice === 'id-method' || choice === 'cryo')
    return null;
  const reason = menuItems(line.status, true).find((item) => item.choice === choice)?.reason;
  if (reason !== null && reason !== undefined)
    return <Toast message={reason} onClose={handlers.onClose} />;
  const props = { line, ...handlers };
  if (choice === 'start-breeding') return <StartBreedingDialog {...props} />;
  if (choice === 'genotyping') return <GenotypingDialog {...props} />;
  if (choice === 'close') return <CloseLineDialog {...props} />;
  return <ReopenLineDialog {...props} />;
}
