/**
 * Add, edit and remove a cryopreservation record on the Line Detail page (T-015, FR-CRYO-01…03).
 * The dialog runs the same `validateCryoRecord` as the API, suggests the next free Cryo ID
 * (FR-CRYO-03), derives the count from the ID range, and offers the lab's places with "Other…".
 */
import { useEffect, useState } from 'react';
import { cryoRangeCount } from '../../../domain/cryo';
import {
  compressCryoIds,
  exampleVialRange,
  formatCryoId,
  validateCryoRecord,
  validateCryoUse,
} from '../../../domain/cryoEdit';
import { labToday } from '../../../domain/dates';
import {
  addCryo,
  editCryo,
  getNextCryoId,
  removeCryo,
  recordCryoUse,
  undoCryoUse,
} from '../cryoApi';
import type { LineDetailCryoRecord, LineDetailCryoUse, LineDetailDocument } from '../lineDetailApi';
import { getEnumeration } from '../newLineApi';
import { strings } from '../strings';
import { ActivityFrame, NoteField, useActivitySend, type ActivityDone } from './ActivityDialogs';
import { DateField, FieldShell, RadioCards, TextField } from './formFields';

interface DialogProps {
  line: LineDetailDocument;
  onClose: () => void;
  onDone: (result: ActivityDone) => void;
}

const OTHER = '__other__';

type CryoMode = 'add' | 'use';

function ModeSwitch({ mode, onChange }: { mode: CryoMode; onChange: (mode: CryoMode) => void }) {
  return (
    <RadioCards<CryoMode>
      legend={strings.cryoModeLegend}
      name="cd-mode"
      value={mode}
      options={[
        { value: 'add', label: strings.cryoModeAdd },
        { value: 'use', label: strings.cryoModeUse },
      ]}
      onChange={onChange}
    />
  );
}

/**
 * "+ Add record": add vials, or record that vials were used (they leave the list and their IDs are
 * never reused). With `record` it edits that record; `initialMode` lets a row's "Use vials" open the
 * second form directly.
 */
export function CryoDialog({
  initialMode = 'add',
  ...props
}: DialogProps & { record?: LineDetailCryoRecord; initialMode?: CryoMode }) {
  const [mode, setMode] = useState<CryoMode>(initialMode);
  if (props.record === undefined && mode === 'use')
    return <CryoUseDialog {...props} mode={mode} onModeChange={setMode} />;
  return <CryoAddEditDialog {...props} mode={mode} onModeChange={setMode} />;
}

function CryoAddEditDialog({
  line,
  record,
  mode,
  onModeChange,
  onClose,
  onDone,
}: DialogProps & {
  record?: LineDetailCryoRecord;
  mode: CryoMode;
  onModeChange: (mode: CryoMode) => void;
}) {
  const editing = record !== undefined;
  const [places, setPlaces] = useState<string[]>([]);
  const [nextId, setNextId] = useState<string | null>(null);
  // The ID inputs appear once the suggestion is known, so it can never land in a half-typed ID.
  const [idsReady, setIdsReady] = useState(editing);
  const [cryoDate, setCryoDate] = useState(record?.cryoDate ?? labToday());
  const [placeChoice, setPlaceChoice] = useState(record?.place ?? '');
  const [placeOther, setPlaceOther] = useState('');
  const [boxName, setBoxName] = useState(record?.boxName ?? '');
  const [start, setStart] = useState(record?.cryoIdStart ?? '');
  const [end, setEnd] = useState(record?.cryoIdEnd ?? '');
  const [count, setCount] = useState(
    record?.count === null || record === undefined ? '' : String(record.count),
  );
  const [detailsUnknown, setDetailsUnknown] = useState(record?.detailsUnknown ?? false);
  const [notes, setNotes] = useState(record?.notes ?? '');
  const [note, setNote] = useState('');

  useEffect(() => {
    void getEnumeration('cryo_place')
      .then((result) => {
        setPlaces(result.values);
      })
      .catch(() => undefined);
    if (editing) return;
    void getNextCryoId()
      .then((result) => {
        setNextId(result.nextId);
        setStart(result.nextId);
      })
      .catch(() => undefined)
      .finally(() => {
        setIdsReady(true);
      });
  }, [editing]);

  const state = useActivitySend(
    (payload) => (editing ? editCryo(line.id, record.id, payload) : addCryo(line.id, payload)),
    editing ? strings.cryoDoneUpdated : strings.cryoDoneAdded,
    onDone,
  );

  // A place that is not one of the lab's list (older records) shows as "Other…" with its text.
  const knownPlace = placeChoice === '' || places.includes(placeChoice);
  const usingOther = placeChoice === OTHER || (!knownPlace && places.length > 0);
  const place = usingOther ? (placeChoice === OTHER ? placeOther : placeChoice) : placeChoice;
  const derived = cryoRangeCount(start.trim().toUpperCase(), end.trim().toUpperCase());

  const payload = () => ({
    expectedVersion: line.version,
    cryoDate,
    place,
    boxName,
    cryoIdStart: start,
    cryoIdEnd: end,
    count,
    detailsUnknown,
    notes,
    note,
  });

  function submit() {
    const check = validateCryoRecord(payload(), labToday());
    if (!check.ok) {
      state.show(check.errors, 'cd-');
      return;
    }
    state.setErrors({});
    void state.send(payload(), 'cd-');
  }

  return (
    <ActivityFrame
      title={editing ? strings.cryoEditTitle : strings.cryoAddTitle}
      titleId="cryo-dialog-title"
      submitLabel={editing ? strings.save : strings.cryoAddSubmit}
      state={state}
      onClose={onClose}
      onSubmit={() => {
        submit();
      }}
      initialFocus="#cd-cryoDate"
    >
      {editing ? null : <ModeSwitch mode={mode} onChange={onModeChange} />}
      <DateField
        id="cd-cryoDate"
        label={strings.cryoDateField}
        max={labToday()}
        value={cryoDate}
        error={state.errors['cryoDate']}
        onChange={setCryoDate}
      />
      <FieldShell id="cd-place" label={strings.cryoPlaceField} error={state.errors['place']}>
        <select
          id="cd-place"
          value={usingOther ? OTHER : placeChoice}
          onChange={(event) => {
            setPlaceChoice(event.target.value);
          }}
        >
          <option value="">{strings.cryoPlaceChoose}</option>
          {places.map((entry) => (
            <option key={entry} value={entry}>
              {entry}
            </option>
          ))}
          <option value={OTHER}>{strings.cryoPlaceOther}</option>
        </select>
      </FieldShell>
      {usingOther ? (
        <TextField
          id="cd-placeOther"
          hint={strings.cryoPlaceOtherHint}
          label={strings.cryoPlaceOtherField}
          value={placeChoice === OTHER ? placeOther : placeChoice}
          onChange={(value) => {
            setPlaceOther(value);
            setPlaceChoice(OTHER);
          }}
        />
      ) : null}
      <TextField
        id="cd-boxName"
        label={strings.cryoBoxField}
        value={boxName}
        error={state.errors['boxName']}
        onChange={setBoxName}
      />
      {nextId === null ? null : (
        <p className="form-field__hint" data-testid="cryo-next-free">
          <strong>{strings.cryoNextFree(nextId)}</strong>
          {` · ${strings.cryoNextFreeHint}`}
        </p>
      )}
      {idsReady ? (
        <div className="form-grid">
          <TextField
            id="cd-cryoIdStart"
            label={strings.cryoIdStartField}
            value={start}
            error={state.errors['cryoIdStart']}
            onChange={setStart}
          />
          <TextField
            id="cd-cryoIdEnd"
            label={strings.cryoIdEndField}
            value={end}
            error={state.errors['cryoIdEnd']}
            onChange={setEnd}
          />
        </div>
      ) : (
        <p className="form-field__hint">{strings.loading}</p>
      )}
      {derived === null ? (
        <TextField
          id="cd-count"
          label={strings.cryoCountField}
          inputMode="numeric"
          value={count}
          error={state.errors['count']}
          onChange={setCount}
        />
      ) : (
        <p className="form-field__hint" data-testid="cryo-derived-count">
          {strings.cryoCountFromRange(derived)}
        </p>
      )}
      {editing ? (
        <div className="inline-check">
          <input
            id="cd-details-unknown"
            type="checkbox"
            checked={detailsUnknown}
            onChange={(event) => {
              setDetailsUnknown(event.target.checked);
            }}
          />
          <label htmlFor="cd-details-unknown">{strings.cryoDetailsUnknownField}</label>
        </div>
      ) : null}
      <TextField
        id="cd-notes"
        label={strings.cryoNotesField}
        multiline
        value={notes}
        error={state.errors['notes']}
        onChange={setNotes}
      />
      <NoteField id="cd-note" value={note} error={state.errors['note']} onChange={setNote} />
    </ActivityFrame>
  );
}

export function RemoveCryoDialog({
  line,
  record,
  onClose,
  onDone,
}: DialogProps & { record: LineDetailCryoRecord }) {
  const [note, setNote] = useState('');
  const state = useActivitySend(
    (payload) => removeCryo(line.id, record.id, payload),
    strings.cryoDoneRemoved,
    onDone,
  );
  return (
    <ActivityFrame
      title={strings.cryoRemoveTitle}
      titleId="remove-cryo-title"
      submitLabel={strings.cryoRemoveSubmit}
      danger
      state={state}
      onClose={onClose}
      onSubmit={() => {
        void state.send({ expectedVersion: line.version, note }, 'rc-');
      }}
      initialFocus="#rc-note"
    >
      <p>{strings.cryoRemoveBody}</p>
      <NoteField id="rc-note" value={note} error={state.errors['note']} onChange={setNote} />
    </ActivityFrame>
  );
}

/** Undo one recorded vial use (T-028, OQ-38): a warning first, then History records who did it. */
export function UndoCryoUseDialog({
  line,
  use,
  onClose,
  onDone,
}: DialogProps & { use: LineDetailCryoUse }) {
  const [note, setNote] = useState('');
  const state = useActivitySend(
    (payload) => undoCryoUse(line.id, use.id, payload),
    strings.cryoDoneUndone,
    onDone,
  );
  const what = use.cryoId ?? strings.cryoUsedQuantity(use.quantity);
  return (
    <ActivityFrame
      title={strings.cryoUndoTitle}
      titleId="undo-cryo-use-title"
      submitLabel={strings.cryoUndoSubmit}
      danger
      state={state}
      onClose={onClose}
      onSubmit={() => {
        void state.send({ expectedVersion: line.version, note }, 'uc-');
      }}
      initialFocus="#uc-note"
    >
      <p>{strings.cryoUndoBody(what, use.place)}</p>
      <NoteField
        id="uc-note"
        label={strings.cryoUndoNoteLabel}
        value={note}
        error={state.errors['note']}
        onChange={setNote}
      />
    </ActivityFrame>
  );
}

/**
 * The vials that can still be used, as people read them: every ID of the line's records without the
 * IDs already used, folded into ranges (`C0637–C0639, C0641–C0644`), plus records without IDs as
 * `External storage (10)`.
 */
/** The IDs of the line's records that can still be used (not used yet), in order. */
export function availableVialIds(line: LineDetailDocument): string[] {
  const used = new Set(line.cryoUses.flatMap((use) => (use.cryoId === null ? [] : [use.cryoId])));
  const ids: string[] = [];
  for (const record of line.cryoRecords) {
    if (record.cryoIdStart === null || record.cryoIdEnd === null) continue;
    for (
      let n = Number(record.cryoIdStart.slice(1));
      n <= Number(record.cryoIdEnd.slice(1));
      n += 1
    ) {
      const id = formatCryoId(n);
      if (!used.has(id)) ids.push(id);
    }
  }
  return ids;
}

export function availableVials(line: LineDetailDocument): string {
  const ids = availableVialIds(line);
  const countOnly: string[] = [];
  for (const record of line.cryoRecords)
    if (record.cryoIdStart === null && (record.count ?? 0) > 0)
      countOnly.push(`${record.place ?? strings.cryoPlace} (${String(record.count)})`);
  return [...(ids.length > 0 ? [compressCryoIds(ids)] : []), ...countOnly].join(', ');
}

function CryoUseDialog({
  line,
  mode,
  onModeChange,
  onClose,
  onDone,
}: DialogProps & { mode: CryoMode; onModeChange: (mode: CryoMode) => void }) {
  const today = labToday();
  const [vialIds, setVialIds] = useState('');
  const [recordId, setRecordId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [usedAt, setUsedAt] = useState(today);
  const [note, setNote] = useState('');
  const state = useActivitySend(
    (payload) => recordCryoUse(line.id, payload),
    strings.cryoDoneUsed,
    onDone,
  );
  // Records that have no vial IDs can only be used by number.
  const countOnly = line.cryoRecords.filter(
    (record) => record.cryoIdStart === null && (record.count ?? 0) > 0,
  );
  const available = availableVials(line);
  const availableIds = availableVialIds(line);

  const payload = () => ({
    expectedVersion: line.version,
    vialIds,
    recordId,
    quantity,
    usedAt,
    note,
  });

  function submit() {
    const check = validateCryoUse(payload(), today);
    if (!check.ok) {
      state.show(check.errors, 'cu-');
      return;
    }
    state.setErrors({});
    void state.send(payload(), 'cu-');
  }

  return (
    <ActivityFrame
      title={strings.cryoUseTitle}
      titleId="cryo-use-title"
      submitLabel={strings.cryoUseSubmit}
      danger
      state={state}
      onClose={onClose}
      onSubmit={() => {
        submit();
      }}
      initialFocus="#cu-vialIds"
    >
      <ModeSwitch mode={mode} onChange={onModeChange} />
      <p className="form-field__hint" data-testid="cryo-available">
        {available === '' ? strings.cryoUseNoVials : strings.cryoUseAvailable(available)}
      </p>
      <TextField
        id="cu-vialIds"
        label={strings.cryoUseIds}
        hint={strings.cryoUseIdsHint(
          exampleVialRange(availableIds),
          availableIds.slice(0, 2).join(', '),
        )}
        value={vialIds}
        error={state.errors['vialIds']}
        onChange={setVialIds}
      />
      {countOnly.length === 0 ? null : (
        <>
          <h3>{strings.cryoUseNoIdsTitle}</h3>
          <FieldShell id="cu-recordId" label={strings.cryoUseRecord}>
            <select
              id="cu-recordId"
              value={recordId}
              onChange={(event) => {
                setRecordId(event.target.value);
              }}
            >
              <option value="">{strings.cryoUseRecordChoose}</option>
              {countOnly.map((record) => (
                <option key={record.id} value={record.id}>
                  {`${record.place ?? strings.cryoPlace} (${String(record.count)})`}
                </option>
              ))}
            </select>
          </FieldShell>
          <TextField
            id="cu-quantity"
            label={strings.cryoUseQuantity}
            inputMode="numeric"
            value={quantity}
            error={state.errors['quantity']}
            onChange={setQuantity}
          />
        </>
      )}
      <DateField
        id="cu-usedAt"
        label={strings.cryoUseDate}
        max={today}
        value={usedAt}
        error={state.errors['usedAt']}
        onChange={setUsedAt}
      />
      <NoteField
        id="cu-note"
        label={strings.cryoUseNote}
        value={note}
        error={state.errors['note']}
        onChange={setNote}
      />
      <p className="form-field__warning">{strings.cryoUseWarning}</p>
    </ActivityFrame>
  );
}
