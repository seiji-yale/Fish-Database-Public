/**
 * Add, edit and remove an ID protocol on the Line Detail page (T-014, FR-ID-01…09). The fields come
 * from the same `ProtocolForm*` components and the same `validateProtocol` rules as the New Line
 * form; the API repeats every check. A protocol keeps its type once created (to change the type,
 * add a new protocol and remove the old one). The image slot stays out until attachments (T-016).
 */
import { useEffect, useState } from 'react';
import { validateProtocolRequest } from '../../../domain/protocolEdit';
import {
  NEW_LINE_PROTOCOL_TYPES,
  PROTOCOL_TYPE_LABELS,
  type NewLineProtocolType,
} from '../../../domain/newLine';
import type { LineDetailDocument, LineDetailProtocol } from '../lineDetailApi';
import { protocolDraftFrom, newProtocolDraft, protocolPayload } from '../newLineForm';
import { getEnumeration } from '../newLineApi';
import { protocolDefaults } from '../protocolDefaults';
import { addProtocol, editProtocol, removeProtocol } from '../protocolsApi';
import { strings } from '../strings';
import { ActivityFrame, NoteField, useActivitySend, type ActivityDone } from './ActivityDialogs';
import { RadioCards, TextField } from './formFields';
import { ProtocolForm } from './ProtocolForm';

interface DialogProps {
  line: LineDetailDocument;
  onClose: () => void;
  onDone: (result: ActivityDone) => void;
}

const TYPE_OPTIONS = NEW_LINE_PROTOCOL_TYPES.map((type) => ({
  value: type,
  label: PROTOCOL_TYPE_LABELS[type],
}));

function scoped(errors: Record<string, string>, prefix: string): Record<string, string> {
  return Object.fromEntries(
    Object.entries(errors)
      .filter(([key]) => key.startsWith(`${prefix}.`))
      .map(([key, message]) => [key.slice(prefix.length + 1), message]),
  );
}

/** Add (no `protocol`) or edit (`protocol` given) one ID method. */
export function ProtocolDialog({
  line,
  protocol,
  onClose,
  onDone,
}: DialogProps & { protocol?: LineDetailProtocol }) {
  const editing = protocol !== undefined;
  const [draft, setDraft] = useState(() =>
    editing ? protocolDraftFrom(protocol) : newProtocolDraft('pcr'),
  );
  const [setCurrent, setSetCurrent] = useState(line.protocols.every((entry) => !entry.isCurrent));
  const [note, setNote] = useState('');
  const [fluorophores, setFluorophores] = useState<string[]>([]);
  useEffect(() => {
    void getEnumeration('fluorophore')
      .then((result) => {
        setFluorophores(result.values);
      })
      .catch(() => undefined);
  }, []);

  const state = useActivitySend(
    (payload) =>
      editing ? editProtocol(line.id, protocol.id, payload) : addProtocol(line.id, payload),
    editing ? strings.protocolDoneUpdated : strings.protocolDoneAdded,
    onDone,
  );

  const otherLabels = line.protocols
    .filter((entry) => entry.id !== protocol?.id)
    .map((entry) => entry.label);
  const payload = () => ({
    expectedVersion: line.version,
    ...protocolPayload(draft),
    ...(editing ? {} : { setCurrent }),
    note,
  });
  // The same check the API runs, on every render: it also yields the warnings shown as the person types.
  const check = validateProtocolRequest(
    payload(),
    otherLabels,
    protocol?.protocolType,
    protocolDefaults(),
  );
  const warnings = check.ok ? check.value.warnings : {};
  const fieldWarnings = scoped(warnings, 'fields');

  function submit() {
    if (!check.ok) {
      state.show(check.errors, 'pd-');
      return;
    }
    state.setErrors({});
    void state.send(payload(), 'pd-');
  }

  const idPrefix = 'pd';
  return (
    <ActivityFrame
      title={editing ? strings.protocolEditTitle(protocol.label) : strings.protocolAddTitle}
      titleId="protocol-dialog-title"
      submitLabel={editing ? strings.save : strings.protocolAddSubmit}
      state={state}
      onClose={onClose}
      onSubmit={() => {
        submit();
      }}
      initialFocus={editing ? '#pd-label' : 'input[type="radio"]:checked'}
    >
      {editing ? (
        <p className="form-field__hint">{`${PROTOCOL_TYPE_LABELS[draft.type]}. ${strings.protocolTypeFixed}`}</p>
      ) : (
        <RadioCards<NewLineProtocolType>
          legend={strings.idMethodType}
          name="pd-type"
          value={draft.type}
          options={TYPE_OPTIONS}
          onChange={(type) => {
            setDraft({ ...draft, type });
          }}
        />
      )}
      <TextField
        id="pd-label"
        label={strings.protocolLabel}
        hint={strings.protocolLabelHint}
        value={draft.label}
        error={state.errors['label']}
        warning={warnings['label']}
        onChange={(label) => {
          setDraft({ ...draft, label });
        }}
      />
      <ProtocolForm
        draft={draft}
        idPrefix={idPrefix}
        fluorophores={fluorophores}
        errors={state.errors}
        warnings={fieldWarnings}
        onChange={setDraft}
      />
      {draft.type === 'none' || draft.type === 'tails' ? null : (
        <p className="form-field__hint">{strings.protocolImageLater}</p>
      )}
      {editing ? null : (
        <div className="inline-check">
          <input
            id="pd-set-current"
            type="checkbox"
            checked={setCurrent}
            aria-describedby="pd-set-current-hint"
            onChange={(event) => {
              setSetCurrent(event.target.checked);
            }}
          />
          <label htmlFor="pd-set-current">{strings.protocolMakeCurrent}</label>
          <span id="pd-set-current-hint" className="form-field__hint">
            {strings.protocolMakeCurrentHint}
          </span>
        </div>
      )}
      <NoteField id="pd-note" value={note} error={state.errors['note']} onChange={setNote} />
    </ActivityFrame>
  );
}

export function RemoveProtocolDialog({
  line,
  protocol,
  onClose,
  onDone,
}: DialogProps & { protocol: LineDetailProtocol }) {
  const [note, setNote] = useState('');
  const state = useActivitySend(
    (payload) => removeProtocol(line.id, protocol.id, payload),
    strings.protocolDoneRemoved,
    onDone,
  );
  const payload = () => ({ expectedVersion: line.version, note });
  return (
    <ActivityFrame
      title={strings.protocolRemoveTitle(protocol.label)}
      titleId="remove-protocol-title"
      submitLabel={strings.protocolRemoveSubmit}
      danger
      state={state}
      onClose={onClose}
      onSubmit={() => {
        void state.send(payload(), 'rp-');
      }}
      initialFocus="#rp-note"
    >
      <p>{strings.protocolRemoveBody}</p>
      {protocol.isCurrent && line.protocols.filter((entry) => entry.isCurrent).length === 1 ? (
        <p role="note">{strings.protocolRemoveCurrent}</p>
      ) : null}
      <NoteField id="rp-note" value={note} error={state.errors['note']} onChange={setNote} />
    </ActivityFrame>
  );
}
