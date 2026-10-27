/** Remove a schedule event (T-037, FR-FEED-21): one confirmation, or two actions for a repeating event. */
import { useId, useState } from 'react';
import { deleteFeedingEvent, type FeedingEvent } from '../feedingApi';
import { HttpError } from '../api';
import { strings } from '../strings';
import { Modal } from './Modal';

export function FeedingEventRemoveDialog({
  event,
  weekday,
  date,
  onCancel,
  onDone,
}: {
  event: FeedingEvent;
  weekday: string;
  date: string;
  onCancel: () => void;
  /** The toast text. */
  onDone: (message: string) => void;
}) {
  const titleId = useId();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const series = event.seriesId !== null && event.followingCount > 1;

  function remove(scope: 'this' | 'following') {
    setBusy(true);
    setFailed(false);
    deleteFeedingEvent(event.id, scope)
      .then((result) => {
        onDone(strings.feedingEventRemoved(result.deleted));
      })
      .catch((error: unknown) => {
        if (error instanceof HttpError && error.status === 404) {
          onDone(strings.feedingEventGone);
          return;
        }
        setFailed(true);
        setBusy(false);
      });
  }

  return (
    <Modal
      title={strings.feedingEventRemoveTitle(event.title)}
      titleId={titleId}
      onClose={onCancel}
      wide
    >
      <p>{strings.feedingEventRemoveBody(weekday, date)}</p>
      {failed ? <p role="alert">{strings.feedingEventFailed}</p> : null}
      <div className="dialog__actions feeding-event-remove__actions">
        <button type="button" disabled={busy} onClick={onCancel}>
          {strings.cancel}
        </button>
        <button
          type="button"
          className="button--primary"
          disabled={busy}
          onClick={() => {
            remove('this');
          }}
        >
          {strings.feedingEventDelete}
        </button>
        {series ? (
          <button
            type="button"
            className="button--primary"
            disabled={busy}
            onClick={() => {
              remove('following');
            }}
          >
            {strings.feedingEventDeleteFollowing(event.followingCount)}
          </button>
        ) : null}
      </div>
    </Modal>
  );
}
