/**
 * The Events section of the Day dialog (T-037, FR-FEED-20 … 22): the day's schedule events with Edit and
 * Remove, and `+ Add event` with an optional weekly repeat. Every action is its own request (it does not wait
 * for the dialog's Save); removing is confirmed by the dialog (`FeedingEventRemoveDialog`).
 */
import { useEffect, useId, useState } from 'react';
import { monthBounds, weekdayName } from '../../../domain/feeding';
import { HttpError } from '../api';
import {
  patchFeedingEvent,
  postFeedingEvent,
  type FeedingDay,
  type FeedingEvent,
} from '../feedingApi';
import { strings } from '../strings';

const TITLE_MAX = 60;
const NOTE_MAX = 200;

type Preview = { key: string; text: string; failed: boolean };

function failureText(error: unknown): string {
  if (error instanceof HttpError && error.status === 400) {
    const fields = error.body?.details?.['fields'];
    if (fields !== null && typeof fields === 'object') {
      const first = Object.values(fields as Record<string, unknown>).find(
        (value): value is string => typeof value === 'string',
      );
      if (first !== undefined) return first;
    }
  }
  return strings.feedingEventFailed;
}

function EventForm({
  day,
  month,
  event,
  titles,
  onDone,
  onCancel,
}: {
  day: FeedingDay;
  month: string;
  /** The event being edited; null when adding. */
  event: FeedingEvent | null;
  titles: readonly string[];
  /** The toast text; the section's owner reloads the month. */
  onDone: (message: string) => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const noteId = useId();
  const repeatId = useId();
  const untilId = useId();
  const listId = useId();
  const [title, setTitle] = useState(event?.title ?? '');
  const [note, setNote] = useState(event?.note ?? '');
  const [repeat, setRepeat] = useState(false);
  const [until, setUntil] = useState(monthBounds(month).last);
  const [scope, setScope] = useState<'this' | 'following'>('this');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const adding = event === null;
  const hasFollowing = event !== null && event.seriesId !== null && event.followingCount > 1;
  const previewKey = `${day.date}|${until}`;

  useEffect(() => {
    if (!adding || !repeat) return;
    let cancelled = false;
    postFeedingEvent({
      date: day.date,
      title: 'x',
      note: null,
      repeatUntil: until,
      dryRun: true,
    })
      .then((result) => {
        if (cancelled) return;
        const last = result.dates[result.dates.length - 1] ?? day.date;
        setPreview({
          key: previewKey,
          text: strings.feedingEventPreview(result.count, weekdayName(day.date), last),
          failed: false,
        });
      })
      .catch((error: unknown) => {
        if (!cancelled) setPreview({ key: previewKey, text: failureText(error), failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [adding, repeat, day.date, until, previewKey]);

  const previewReady = preview?.key === previewKey ? preview : null;
  const canSave =
    !busy &&
    title.trim() !== '' &&
    (!adding || !repeat || (previewReady !== null && !previewReady.failed));

  function save() {
    setBusy(true);
    setProblem(null);
    const trimmedNote = note.trim() === '' ? null : note.trim();
    const request =
      event === null
        ? postFeedingEvent({
            date: day.date,
            title: title.trim(),
            note: trimmedNote,
            ...(repeat ? { repeatUntil: until } : {}),
          }).then((result) => strings.feedingEventAdded(result.count))
        : patchFeedingEvent(event.id, {
            title: title.trim(),
            note: trimmedNote,
            scope: hasFollowing ? scope : 'this',
          }).then((result) => strings.feedingEventUpdated(result.updated));
    request.then(onDone).catch((error: unknown) => {
      if (error instanceof HttpError && error.status === 404) {
        onDone(strings.feedingEventGone);
        return;
      }
      setProblem(failureText(error));
      setBusy(false);
    });
  }

  return (
    <div className="feeding-event-form">
      <div className="form-field">
        <label htmlFor={titleId}>{strings.feedingEventTitle}</label>
        <input
          id={titleId}
          type="text"
          value={title}
          maxLength={TITLE_MAX}
          list={listId}
          disabled={busy}
          onChange={(changed) => {
            setTitle(changed.target.value);
          }}
        />
        <datalist id={listId}>
          {titles.map((known) => (
            <option key={known} value={known} />
          ))}
        </datalist>
      </div>
      <div className="form-field">
        <label htmlFor={noteId}>{strings.feedingEventNote}</label>
        <input
          id={noteId}
          type="text"
          value={note}
          maxLength={NOTE_MAX}
          disabled={busy}
          onChange={(changed) => {
            setNote(changed.target.value);
          }}
        />
      </div>
      {adding ? (
        <>
          <div className="inline-check">
            <input
              id={repeatId}
              type="checkbox"
              checked={repeat}
              disabled={busy}
              onChange={(changed) => {
                setRepeat(changed.target.checked);
              }}
            />
            <label htmlFor={repeatId}>{strings.feedingEventRepeat}</label>
          </div>
          {repeat ? (
            <div className="form-field">
              <label htmlFor={untilId}>{strings.feedingEventUntil}</label>
              <input
                id={untilId}
                type="date"
                value={until}
                min={day.date}
                max="2100-12-31"
                disabled={busy}
                onChange={(changed) => {
                  setUntil(changed.target.value);
                }}
              />
              <p
                className={previewReady?.failed === true ? 'form-field__error' : 'form-field__hint'}
                role="status"
                data-testid="feeding-event-preview"
              >
                {previewReady === null ? strings.feedingEventChecking : previewReady.text}
              </p>
            </div>
          ) : null}
        </>
      ) : null}
      {hasFollowing ? (
        <fieldset className="feeding-event-form__scope" disabled={busy}>
          <legend>{strings.feedingEventScope}</legend>
          <label>
            <input
              type="radio"
              name="feeding-event-scope"
              checked={scope === 'this'}
              onChange={() => {
                setScope('this');
              }}
            />
            {strings.feedingEventThis}
          </label>
          <label>
            <input
              type="radio"
              name="feeding-event-scope"
              checked={scope === 'following'}
              onChange={() => {
                setScope('following');
              }}
            />
            {strings.feedingEventFollowing(event.followingCount)}
          </label>
        </fieldset>
      ) : null}
      {problem === null ? null : (
        <p className="form-field__error" role="alert">
          {problem}
        </p>
      )}
      <div className="feeding-event-form__actions">
        <button type="button" disabled={busy} onClick={onCancel}>
          {strings.cancel}
        </button>
        <button type="button" className="button--primary" disabled={!canSave} onClick={save}>
          {strings.feedingEventSave}
        </button>
      </div>
    </div>
  );
}

export function FeedingEventsSection({
  day,
  month,
  canWrite,
  titles,
  onChanged,
  onRemove,
}: {
  day: FeedingDay;
  month: string;
  canWrite: boolean;
  /** Titles used before, for the suggestions. */
  titles: readonly string[];
  onChanged: (message: string) => void;
  onRemove: (event: FeedingEvent) => void;
}) {
  const headingId = useId();
  const [form, setForm] = useState<{ mode: 'none' | 'add' | 'edit'; id: string }>({
    mode: 'none',
    id: '',
  });
  const editing =
    form.mode === 'edit' ? day.events.find((event) => event.id === form.id) : undefined;

  function done(message: string) {
    setForm({ mode: 'none', id: '' });
    onChanged(message);
  }

  return (
    <section className="feeding-events" aria-labelledby={headingId}>
      <h3 id={headingId}>{strings.feedingEvents}</h3>
      {day.events.length === 0 ? <p>{strings.feedingEventsNone}</p> : null}
      <ul>
        {day.events.map((event) =>
          editing?.id === event.id ? (
            <li key={event.id}>
              <EventForm
                day={day}
                month={month}
                event={event}
                titles={titles}
                onDone={done}
                onCancel={() => {
                  setForm({ mode: 'none', id: '' });
                }}
              />
            </li>
          ) : (
            <li key={event.id} className="feeding-events__item">
              <span className="feeding-events__text">
                <strong>{event.title}</strong>
                {event.seriesId === null ? null : (
                  <span className="feeding-events__series">{strings.feedingEventRepeatsNote}</span>
                )}
                {event.note === null || event.note === '' ? null : <span>{event.note}</span>}
              </span>
              {canWrite ? (
                <span className="feeding-events__actions">
                  <button
                    type="button"
                    aria-label={`${strings.feedingEventEdit}: ${event.title}`}
                    onClick={() => {
                      setForm({ mode: 'edit', id: event.id });
                    }}
                  >
                    {strings.feedingEventEdit}
                  </button>
                  <button
                    type="button"
                    aria-label={`${strings.feedingEventRemove}: ${event.title}`}
                    onClick={() => {
                      onRemove(event);
                    }}
                  >
                    {strings.feedingEventRemove}
                  </button>
                </span>
              ) : null}
            </li>
          ),
        )}
      </ul>
      {canWrite && form.mode === 'none' ? (
        <button
          type="button"
          onClick={() => {
            setForm({ mode: 'add', id: '' });
          }}
        >
          {strings.feedingEventAdd}
        </button>
      ) : null}
      {form.mode === 'add' ? (
        <EventForm
          day={day}
          month={month}
          event={null}
          titles={titles}
          onDone={done}
          onCancel={() => {
            setForm({ mode: 'none', id: '' });
          }}
        />
      ) : null}
    </section>
  );
}
