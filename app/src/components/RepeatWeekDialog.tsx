/** Repeat this week (T-034, FR-FEED-15): preview with a dry run, optional overwrite, apply. */
import { useEffect, useId, useState } from 'react';
import { postRepeatWeek, type RepeatWeekCounts } from '../feedingApi';
import { strings } from '../strings';
import { Modal } from './Modal';

export function RepeatWeekDialog({
  weekStart,
  month,
  monthLabel,
  onClose,
  onApplied,
}: {
  weekStart: string;
  month: string;
  monthLabel: string;
  onClose: () => void;
  onApplied: (counts: RepeatWeekCounts) => void;
}) {
  const titleId = useId();
  const overwriteId = useId();
  const [overwrite, setOverwrite] = useState(false);
  // The preview that was read for one setting of the checkbox; a different setting means "counting".
  const [preview, setPreview] = useState<{
    overwrite: boolean;
    counts: RepeatWeekCounts | null;
  } | null>(null);
  const [applyFailed, setApplyFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    postRepeatWeek({ weekStart, month, overwrite, dryRun: true })
      .then((counts) => {
        if (!cancelled) setPreview({ overwrite, counts });
      })
      .catch(() => {
        if (!cancelled) setPreview({ overwrite, counts: null });
      });
    return () => {
      cancelled = true;
    };
  }, [weekStart, month, overwrite]);

  const ready = preview?.overwrite === overwrite;
  const counts = ready ? preview.counts : null;
  const failed = applyFailed || (ready && preview.counts === null);

  function apply() {
    setBusy(true);
    postRepeatWeek({ weekStart, month, overwrite, dryRun: false })
      .then(onApplied)
      .catch(() => {
        setApplyFailed(true);
        setBusy(false);
      });
  }

  const previewText =
    counts === null
      ? strings.feedingRepeatChecking
      : counts.replaced > 0
        ? strings.feedingRepeatPreviewReplace(counts.filled, counts.replaced, counts.kept)
        : strings.feedingRepeatPreview(counts.filled, counts.kept);
  return (
    <Modal title={strings.feedingRepeatTitle(weekStart)} titleId={titleId} onClose={onClose} wide>
      <p>{strings.feedingRepeatIntro(monthLabel)}</p>
      <div className="inline-check">
        <input
          id={overwriteId}
          type="checkbox"
          checked={overwrite}
          disabled={busy}
          onChange={(event) => {
            setOverwrite(event.target.checked);
          }}
        />
        <label htmlFor={overwriteId}>{strings.feedingRepeatOverwrite}</label>
      </div>
      <p role="status" data-testid="feeding-repeat-preview">
        {failed ? strings.feedingSaveFailed : previewText}
      </p>
      <div className="dialog__actions">
        <button type="button" onClick={onClose}>
          {strings.cancel}
        </button>
        <button
          type="button"
          className="button--primary"
          disabled={busy || counts === null}
          onClick={apply}
        >
          {strings.feedingRepeatApply}
        </button>
      </div>
    </Modal>
  );
}
