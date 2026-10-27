/**
 * The Day dialog (T-034, FR-FEED-10 … 14, docs/08 §5.4): choose the feeder, add a note, save. A save
 * carries the id of the value the dialog opened with (BR-17); if the day changed meanwhile the server
 * refuses with 409 and the dialog offers to reload that day.
 */
import { useEffect, useId, useState } from 'react';
import { HttpError } from '../api';
import {
  getFeedingHistory,
  putFeedingDay,
  type FeedingDay,
  type FeedingEvent,
  type FeedingHistoryRow,
  type FeedingPerson,
} from '../feedingApi';
import { formatDateTime } from '../dateFormat';
import { strings } from '../strings';
import { FeedingEventRemoveDialog } from './FeedingEventRemoveDialog';
import { FeedingEventsSection } from './FeedingEvents';
import { Modal } from './Modal';
import { ConfirmDialog } from './shared';

const NOTE_MAX = 200;

type Problem = { message: string; conflict: boolean };

function History({ date }: { date: string }) {
  const [rows, setRows] = useState<FeedingHistoryRow[] | 'loading' | 'error'>('loading');
  useEffect(() => {
    let cancelled = false;
    getFeedingHistory(date)
      .then((next) => {
        if (!cancelled) setRows(next);
      })
      .catch(() => {
        if (!cancelled) setRows('error');
      });
    return () => {
      cancelled = true;
    };
  }, [date]);
  if (rows === 'loading') return <p>{strings.feedingHistoryLoading}</p>;
  if (rows === 'error') return <p role="alert">{strings.feedingHistoryError}</p>;
  if (rows.length === 0) return <p>{strings.feedingHistoryEmpty}</p>;
  return (
    <ol className="feeding-history">
      {[...rows].reverse().map((row) => (
        <li key={row.id}>
          <strong>
            {strings.feedingHistoryRow(
              row.userName,
              row.createdByName,
              formatDateTime(row.createdAt),
            )}
          </strong>
          {row.note !== null && row.note !== '' ? <div>{row.note}</div> : null}
          {row.replacedAt !== null ? (
            <div className="feeding-history__replaced">
              {strings.feedingHistoryReplaced(
                row.replacedByName ?? '—',
                formatDateTime(row.replacedAt),
              )}
            </div>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

export function FeedingDayDialog({
  day,
  assignable,
  canWrite,
  onClose,
  onSaved,
  onReload,
  month,
  titles,
  onEventsChanged,
}: {
  day: FeedingDay;
  /** The month on screen (the default last day of a repeat). */
  month: string;
  /** Event titles used before, for the suggestions. */
  titles: readonly string[];
  /** After an event was added, changed or removed: reload the month; the text is the toast. */
  onEventsChanged: (message: string) => void;
  assignable: readonly FeedingPerson[];
  canWrite: boolean;
  onClose: () => void;
  /** The server's answer for the day, and the toast text. */
  onSaved: (day: FeedingDay, message: string) => void;
  /** Reads the day again (after a conflict) and returns its current state. */
  onReload: (date: string) => Promise<FeedingDay | null>;
}) {
  const titleId = useId();
  const selectId = useId();
  const noteId = useId();
  const [current, setCurrent] = useState(day);
  const [userId, setUserId] = useState(day.assignment?.userId ?? '');
  const [note, setNote] = useState(day.assignment?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [removing, setRemoving] = useState<FeedingEvent | null>(null);

  const assigned = current.assignment;
  const currentOption =
    assigned !== null && !assignable.some((person) => person.id === assigned.userId)
      ? assigned
      : null;
  const title = strings.feedingDayTitle(current.weekday, current.date);

  async function send(nextUserId: string) {
    setBusy(true);
    setProblem(null);
    try {
      const saved = await putFeedingDay(current.date, {
        userId: nextUserId === '' ? null : nextUserId,
        note: nextUserId === '' || note.trim() === '' ? null : note.trim(),
        expectedAssignmentId: assigned?.id ?? null,
      });
      onSaved(
        saved,
        nextUserId === ''
          ? strings.feedingCleared(current.date)
          : strings.feedingSaved(current.date),
      );
    } catch (error) {
      setConfirmClear(false);
      if (error instanceof HttpError && error.status === 409)
        setProblem({ message: error.body?.message ?? strings.feedingSaveFailed, conflict: true });
      else if (error instanceof HttpError && error.status === 400)
        setProblem({ message: strings.feedingUserNotAssignable, conflict: false });
      else setProblem({ message: strings.feedingSaveFailed, conflict: false });
      setBusy(false);
    }
  }

  function save() {
    const unchanged = userId === (assigned?.userId ?? '') && note.trim() === (assigned?.note ?? '');
    if (unchanged) {
      onClose();
      return;
    }
    if (userId === '' && assigned !== null) setConfirmClear(true);
    else void send(userId);
  }

  async function reload() {
    setBusy(true);
    const fresh = await onReload(current.date).catch(() => null);
    if (fresh !== null) {
      setCurrent(fresh);
      setUserId(fresh.assignment?.userId ?? '');
      setNote(fresh.assignment?.note ?? '');
      setProblem(null);
    }
    setBusy(false);
  }

  if (removing !== null)
    return (
      <FeedingEventRemoveDialog
        event={removing}
        weekday={current.weekday}
        date={current.date}
        onCancel={() => {
          setRemoving(null);
        }}
        onDone={(message) => {
          setRemoving(null);
          onEventsChanged(message);
        }}
      />
    );

  if (confirmClear)
    return (
      <ConfirmDialog
        title={strings.feedingClearTitle}
        confirmLabel={strings.feedingClearButton}
        confirmDisabled={busy}
        onCancel={() => {
          setConfirmClear(false);
        }}
        onConfirm={() => {
          void send('');
        }}
      >
        <p>
          {strings.feedingClearConfirm(current.weekday, current.date, assigned?.userName ?? '')}
        </p>
      </ConfirmDialog>
    );

  return (
    <Modal
      title={title}
      titleId={titleId}
      onClose={onClose}
      initialFocus={`[id="${selectId}"]`}
      wide
    >
      <div className="feeding-dialog">
        <div className="form-field">
          <label htmlFor={selectId}>{strings.feedingFeeder}</label>
          <select
            id={selectId}
            value={userId}
            disabled={!canWrite || busy}
            onChange={(event) => {
              setUserId(event.target.value);
            }}
          >
            <option value="">{strings.feedingNobody}</option>
            {currentOption === null ? null : (
              <option value={currentOption.userId}>
                {strings.feedingNotActive(currentOption.userName)}
              </option>
            )}
            {assignable.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        </div>
        <div className="form-field">
          <label htmlFor={noteId}>{strings.feedingNote}</label>
          <input
            id={noteId}
            type="text"
            value={note}
            maxLength={NOTE_MAX}
            disabled={!canWrite || busy}
            onChange={(event) => {
              setNote(event.target.value);
            }}
          />
          <span className="form-field__hint">{strings.feedingNoteCount(note.length)}</span>
        </div>
        {problem === null ? null : (
          <div className="feeding-dialog__problem" role="alert">
            <p>{problem.message}</p>
            {problem.conflict ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  void reload();
                }}
              >
                {strings.feedingConflictReload}
              </button>
            ) : null}
          </div>
        )}
        <FeedingEventsSection
          day={day}
          month={month}
          canWrite={canWrite}
          titles={titles}
          onChanged={onEventsChanged}
          onRemove={setRemoving}
        />
        <p className="feeding-dialog__meta">
          {assigned === null
            ? strings.feedingNeverSet
            : strings.feedingChangedBy(assigned.createdByName, formatDateTime(assigned.createdAt))}
        </p>
        <details
          className="feeding-dialog__history"
          onToggle={(event) => {
            setShowHistory(event.currentTarget.open);
          }}
        >
          <summary>{strings.feedingShowHistory}</summary>
          {showHistory ? <History date={current.date} key={assigned?.id ?? 'none'} /> : null}
        </details>
      </div>
      <div className="dialog__actions">
        <button type="button" onClick={onClose}>
          {strings.cancel}
        </button>
        {canWrite ? (
          <button type="button" className="button--primary" disabled={busy} onClick={save}>
            {strings.save}
          </button>
        ) : null}
      </div>
    </Modal>
  );
}
