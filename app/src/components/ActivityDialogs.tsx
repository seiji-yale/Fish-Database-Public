/**
 * The four Change Activity dialogs on the Line Detail page (T-013, FR-ACT-02…07, docs/04-ui-spec.md
 * §5.5): Start Breeding, Update Genotyping Record, Close This Line and Reopen This Line.
 *
 * Each one runs the shared `domain/activity.ts` validation (and, for genotyping, the same
 * `applyGenotyping` the API runs) before sending anything, so the OQ-31 date messages appear inline
 * next to the field. The API repeats every check. A save carries the version the page was loaded
 * with (BR-12);
 */
import { type ReactNode, useRef, useState } from 'react';
import { checkUpload } from '../../../domain/attachments';
import {
  validateClose,
  validateGenotyping,
  validateReopen,
  validateStartBreeding,
} from '../../../domain/activity';
import {
  applyGenotyping,
  InvalidGenotypingInputError,
  InvalidTransitionError,
} from '../../../domain/breeding';
import { labToday } from '../../../domain/dates';
import type { LineDoc } from '../../../domain/types';
import { postActivity } from '../activityApi';
import { HttpError } from '../api';
import type { LineDetailDocument } from '../lineDetailApi';
import { strings } from '../strings';
import { uploadFile } from '../uploadApi';
import { FilePicker } from './FilePicker';
import { DateField, FieldShell, RadioCards, TextField } from './formFields';
import { Modal } from './Modal';

export interface ActivityDone {
  message: string;
}

interface DialogProps {
  line: LineDetailDocument;
  onClose: () => void;
  onDone: (result: ActivityDone) => void;
}

type Errors = Record<string, string>;

function lineDocOf(line: LineDetailDocument): LineDoc {
  return {
    id: line.id,
    name: line.name,
    status: line.status,
    dob: line.dob,
    generationNo: line.generationNo,
    idedNumber: line.idedNumber,
    lastIdDate: line.lastIdDate,
    breedingStartedAt: line.breedingStartedAt,
    closedAt: line.closedAt,
    closedReason: line.closedReason,
    version: line.version,
  };
}

/**
 * Sending, error mapping and the attribution retry shared by all four dialogs. `send` keeps the last
 * payload so choosing a lab member in the attribution dialog repeats exactly the same request.
 */
export function useActivitySend(
  request: (payload: Record<string, unknown>) => Promise<{ version: number }>,
  doneLabel: string,
  onDone: (result: ActivityDone) => void,
) {
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [banner, setBanner] = useState<{ message: string; reload: boolean } | null>(null);
  const last = useRef<Record<string, unknown>>({});

  function show(raw: Errors, idPrefix: string) {
    // Protocol field errors arrive as `fields.<name>`; the inputs are named after the field.
    const all = Object.fromEntries(
      Object.entries(raw).map(([key, message]) => [key.replace(/^fields\./, ''), message]),
    );
    setErrors(all);
    setBanner(all['form'] === undefined ? null : { message: all['form'], reload: false });
    window.setTimeout(() => {
      const first = Object.keys(all).find((key) => key !== 'form');
      document.getElementById(first === undefined ? '' : `${idPrefix}${first}`)?.focus();
    }, 0);
  }

  async function send(payload: Record<string, unknown>, idPrefix: string) {
    last.current = payload;
    setBanner(null);
    setSaving(true);
    try {
      const result = await request(payload);
      onDone({ message: strings.activityDone(doneLabel, result.version) });
    } catch (cause: unknown) {
      if (!(cause instanceof HttpError) || cause.body === null) {
        setBanner({ message: strings.activityFailed, reload: false });
        return;
      }
      const { code, message, details } = cause.body;
      if (code === 'VERSION_CONFLICT') setBanner({ message, reload: true });
      else if (code === 'INVALID_INPUT' && details?.['fields'] !== undefined)
        show(details['fields'] as Errors, idPrefix);
      else setBanner({ message, reload: false });
    } finally {
      setSaving(false);
    }
  }

  return { saving, errors, setErrors, banner, send, last, show };
}

/** The shell every dialog shares: title, banners, the form body, and Cancel / submit. */
export function ActivityFrame({
  title,
  titleId,
  submitLabel,
  danger = false,
  state,
  onClose,
  onSubmit,
  initialFocus,
  children,
}: {
  title: string;
  titleId: string;
  submitLabel: string;
  danger?: boolean;
  state: ReturnType<typeof useActivitySend>;
  onClose: () => void;
  onSubmit: () => void;
  initialFocus?: string;
  children: ReactNode;
}) {
  const problemCount = Object.keys(state.errors).filter((key) => key !== 'form').length;
  return (
    <>
      <Modal
        title={title}
        titleId={titleId}
        onClose={onClose}
        {...(initialFocus === undefined ? {} : { initialFocus })}
        wide
      >
        <form
          noValidate
          className="activity-form"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          {state.banner === null ? null : (
            <div className="form-error-summary" role="alert">
              <p>{state.banner.message}</p>
              {state.banner.reload ? (
                <button
                  type="button"
                  onClick={() => {
                    window.location.reload();
                  }}
                >
                  {strings.reload}
                </button>
              ) : null}
            </div>
          )}
          {problemCount > 0 ? (
            <div className="form-error-summary" role="alert">
              <p>{strings.formErrorSummary(problemCount)}</p>
            </div>
          ) : null}
          {children}
          <div className="dialog__actions">
            <button type="button" onClick={onClose}>
              {strings.cancel}
            </button>
            <button
              type="submit"
              className={danger ? 'button--danger' : 'button--primary'}
              disabled={state.saving}
            >
              {state.saving ? strings.activitySaving : submitLabel}
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function NoteField({
  id,
  value,
  error,
  label = strings.activityNote,
  hint = strings.activityNoteHint,
  onChange,
}: {
  id: string;
  value: string;
  error: string | undefined;
  label?: string;
  hint?: string;
  onChange: (value: string) => void;
}) {
  return (
    <TextField id={id} label={label} hint={hint} value={value} error={error} onChange={onChange} />
  );
}

export function StartBreedingDialog({ line, onClose, onDone }: DialogProps) {
  const [crossDate, setCrossDate] = useState(labToday());
  const [note, setNote] = useState('');
  const state = useActivitySend(
    (payload) => postActivity(line.id, 'start-breeding', payload),
    strings.activityDoneBreeding,
    onDone,
  );
  const payload = () => ({ expectedVersion: line.version, crossDate, note });

  function submit() {
    const check = validateStartBreeding(payload(), labToday());
    if (!check.ok) {
      state.show(check.errors, 'sb-');
      return;
    }
    state.setErrors({});
    void state.send(payload(), 'sb-');
  }

  return (
    <ActivityFrame
      title={strings.startBreedingTitle(line.name)}
      titleId="start-breeding-title"
      submitLabel={strings.start}
      state={state}
      onClose={onClose}
      onSubmit={() => {
        submit();
      }}
      initialFocus="#sb-crossDate"
    >
      <DateField
        id="sb-crossDate"
        label={strings.crossDate}
        required
        max={labToday()}
        value={crossDate}
        error={state.errors['crossDate']}
        onChange={setCrossDate}
      />
      <NoteField id="sb-note" value={note} error={state.errors['note']} onChange={setNote} />
    </ActivityFrame>
  );
}

export function GenotypingDialog({ line, onClose, onDone }: DialogProps) {
  const today = labToday();
  const [recordDate, setRecordDate] = useState(today);
  const [protocolId, setProtocolId] = useState(
    line.protocols.find((protocol) => protocol.isCurrent)?.id ?? '',
  );
  const [positiveCount, setPositiveCount] = useState('');
  const [screenedCount, setScreenedCount] = useState('');
  // FR-ACT-03: the person must choose; nothing is pre-selected.
  const [generation, setGeneration] = useState<'same' | 'new' | ''>('');
  // FR-ACT-05: the new DOB starts as the cross date of a breeding line, otherwise today.
  const [newDob, setNewDob] = useState(
    line.status === 'Breeding' && line.breedingStartedAt !== null ? line.breedingStartedAt : today,
  );
  const [note, setNote] = useState('');
  // A gel image chosen here is uploaded just before the record is saved (staged) and linked by the
  // same write, so the record, its image and its history entry arrive together (T-016).
  const [gelFile, setGelFile] = useState<File | null>(null);
  const [gelProgress, setGelProgress] = useState<number | null>(null);
  const staged = useRef<{ file: File; attachmentId: string } | null>(null);
  const state = useActivitySend(
    async (payload) => {
      // Reuse the upload when the save is repeated (a fixed field): once is enough.
      let attachmentId =
        staged.current !== null && staged.current.file === gelFile
          ? staged.current.attachmentId
          : undefined;
      if (gelFile !== null && attachmentId === undefined) {
        setGelProgress(0);
        try {
          const uploaded = await uploadFile(line.id, {
            file: gelFile,
            kind: 'gel_image',
            onProgress: setGelProgress,
          });
          staged.current = { file: gelFile, attachmentId: uploaded.attachmentId };
          attachmentId = uploaded.attachmentId;
        } finally {
          setGelProgress(null);
        }
      }
      return postActivity(
        line.id,
        'genotyping',
        attachmentId === undefined ? payload : { ...payload, attachmentId },
      );
    },
    strings.activityDoneGenotyping,
    onDone,
  );

  const isNew = generation === 'new';
  const payload = () => ({
    expectedVersion: line.version,
    recordDate,
    protocolId,
    positiveCount,
    screenedCount,
    ...(generation === '' ? {} : { isNewGeneration: isNew }),
    ...(isNew ? { newDob } : {}),
    note,
  });

  /** The shared shape check, then the very same BR-2 function the API runs (OQ-31 messages). */
  function problems(): Errors | null {
    const check = validateGenotyping(payload(), today);
    if (!check.ok) return check.errors;
    try {
      applyGenotyping(
        lineDocOf(line),
        {
          recordDate: check.value.recordDate,
          positiveCount: check.value.positiveCount,
          isNewGeneration: check.value.isNewGeneration,
          newDob: check.value.newDob,
        },
        today,
      );
    } catch (error) {
      if (error instanceof InvalidGenotypingInputError)
        return { [error.field ?? 'form']: error.message };
      if (error instanceof InvalidTransitionError) return { form: error.message };
      throw error;
    }
    return null;
  }

  function submit() {
    const found = problems();
    if (found !== null) {
      state.show(found, 'gt-');
      return;
    }
    state.setErrors({});
    void state.send(payload(), 'gt-');
  }

  const positive = /^\d+$/.test(positiveCount.trim()) ? Number(positiveCount) : null;
  const preview =
    positive === null || generation === ''
      ? null
      : isNew
        ? strings.newGenerationPreview(positive, line.generationNo)
        : strings.sameGenerationPreview(positive, line.idedNumber + positive);
  const chosenProtocol = line.protocols.find((protocol) => protocol.id === protocolId);
  const isPcr =
    chosenProtocol?.protocolType === 'pcr' || chosenProtocol?.protocolType === 'pcr_sequence';

  return (
    <ActivityFrame
      title={strings.genotypingTitle(line.name)}
      titleId="genotyping-title"
      submitLabel={strings.genotypingSave}
      state={state}
      onClose={onClose}
      onSubmit={() => {
        submit();
      }}
      initialFocus="#gt-recordDate"
    >
      <DateField
        id="gt-recordDate"
        label={strings.genotypingDate}
        required
        max={today}
        value={recordDate}
        error={state.errors['recordDate']}
        onChange={setRecordDate}
      />
      <FieldShell
        id="gt-protocolId"
        label={strings.genotypingProtocol}
        error={state.errors['protocolId']}
      >
        <select
          id="gt-protocolId"
          value={protocolId}
          onChange={(event) => {
            setProtocolId(event.target.value);
          }}
        >
          <option value="">{strings.genotypingProtocolNone}</option>
          {line.protocols.map((protocol) => (
            <option key={protocol.id} value={protocol.id}>
              {protocol.label}
            </option>
          ))}
        </select>
      </FieldShell>
      <TextField
        id="gt-positiveCount"
        label={strings.positiveNumber}
        required
        inputMode="numeric"
        value={positiveCount}
        error={state.errors['positiveCount']}
        onChange={setPositiveCount}
      />
      <TextField
        id="gt-screenedCount"
        label={strings.totalScreened}
        inputMode="numeric"
        value={screenedCount}
        error={state.errors['screenedCount']}
        onChange={setScreenedCount}
      />
      <div className="form-field">
        <strong>{strings.gelImageField}</strong>
        <p className="form-field__hint">{strings.gelImageHint}</p>
        {gelFile === null ? (
          <FilePicker
            label={isPcr ? strings.uploadImage : strings.uploadChoose}
            imagesOnly
            camera
            onPick={(file) => {
              const check = checkUpload(
                { name: file.name, type: file.type, size: file.size },
                true,
              );
              if (check.ok) {
                state.setErrors({});
                setGelFile(file);
              } else state.setErrors({ gelImage: check.message });
            }}
            onError={(message) => {
              state.setErrors({ gelImage: message });
            }}
          />
        ) : (
          <p className="gel-chosen">
            <span>{strings.gelImageChosen(gelFile.name)}</span>
            <button
              type="button"
              onClick={() => {
                setGelFile(null);
              }}
            >
              {strings.gelImageRemove}
            </button>
          </p>
        )}
        {state.errors['gelImage'] === undefined ? null : (
          <p className="form-field__error" role="alert">
            {state.errors['gelImage']}
          </p>
        )}
        {gelProgress === null ? null : (
          <p className="upload-status" role="status">
            {strings.uploadProgress(gelProgress)}
          </p>
        )}
      </div>
      <RadioCards<'same' | 'new' | ''>
        legend={strings.generationChoiceLegend}
        name="gt-generation"
        value={generation}
        options={[
          { value: 'same', label: strings.generationSame },
          { value: 'new', label: strings.generationNew },
        ]}
        onChange={setGeneration}
      />
      {state.errors['isNewGeneration'] === undefined ? null : (
        <p className="form-field__error" role="alert">
          {state.errors['isNewGeneration']}
        </p>
      )}
      {isNew ? (
        <DateField
          id="gt-newDob"
          label={strings.newDobField}
          required
          max={today}
          hint={
            line.status === 'Breeding' && line.breedingStartedAt !== null
              ? strings.newDobHintBreeding
              : strings.newDobHintToday
          }
          value={newDob}
          error={state.errors['newDob']}
          onChange={setNewDob}
        />
      ) : null}
      {preview === null ? null : (
        <p className="activity-preview" role="status" data-testid="genotyping-preview">
          {preview}
        </p>
      )}
      <NoteField id="gt-note" value={note} error={state.errors['note']} onChange={setNote} />
    </ActivityFrame>
  );
}

export function CloseLineDialog({ line, onClose, onDone }: DialogProps) {
  const [reason, setReason] = useState('');
  const state = useActivitySend(
    (payload) => postActivity(line.id, 'close', payload),
    strings.activityDoneClosed,
    onDone,
  );
  const payload = () => ({ expectedVersion: line.version, reason });

  function submit() {
    const check = validateClose(payload());
    if (!check.ok) {
      state.show(check.errors, 'cl-');
      return;
    }
    state.setErrors({});
    void state.send(payload(), 'cl-');
  }

  return (
    <ActivityFrame
      title={strings.closeTitle(line.name)}
      titleId="close-line-title"
      submitLabel={strings.closeSubmit}
      danger
      state={state}
      onClose={onClose}
      onSubmit={() => {
        submit();
      }}
      initialFocus="#cl-reason"
    >
      <p>{strings.closeConfirm(line.name)}</p>
      <NoteField
        id="cl-reason"
        label={strings.closeReason}
        hint={strings.closeReasonHint}
        value={reason}
        error={state.errors['reason']}
        onChange={setReason}
      />
    </ActivityFrame>
  );
}

export function ReopenLineDialog({ line, onClose, onDone }: DialogProps) {
  const state = useActivitySend(
    (payload) => postActivity(line.id, 'reopen', payload),
    strings.activityDoneReopened,
    onDone,
  );
  const payload = () => ({ expectedVersion: line.version });

  function submit() {
    const check = validateReopen(payload());
    if (!check.ok) {
      state.show(check.errors, 'ro-');
      return;
    }
    void state.send(payload(), 'ro-');
  }

  return (
    <ActivityFrame
      title={strings.reopenTitle(line.name)}
      titleId="reopen-line-title"
      submitLabel={strings.reopenConfirm}
      state={state}
      onClose={onClose}
      onSubmit={() => {
        submit();
      }}
    >
      <p>{strings.reopenBody(line.name)}</p>
    </ActivityFrame>
  );
}
