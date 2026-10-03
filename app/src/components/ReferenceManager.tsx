/**
 * The References section with its edit controls (T-016, FR-REF-01): "+ Add reference" (a title and a
 * link, or an uploaded PDF/DOCX/image) and a "⋯" menu per reference (Edit, Remove). A file chosen
 * here is uploaded first (staged) and linked by the write that creates the reference.
 */
import { useRef, useState } from 'react';
import { checkUpload } from '../../../domain/attachments';
import { validateReference } from '../../../domain/referenceEdit';
import type { LineDetailDocument, LineDetailReference } from '../lineDetailApi';
import { addReference, editReference, removeReference } from '../referencesApi';
import { strings } from '../strings';
import { uploadFile } from '../uploadApi';
import { ActivityFrame, NoteField, useActivitySend, type ActivityDone } from './ActivityDialogs';
import { FilePicker } from './FilePicker';
import { TextField } from './formFields';
import { ReferenceList } from './ReferenceList';
import { RowMenu } from './RowMenu';

interface DialogProps {
  line: LineDetailDocument;
  onClose: () => void;
  onDone: (result: ActivityDone) => void;
}

/** Add (no `reference`) or edit (`reference` given) one reference. */
function ReferenceDialog({
  line,
  reference,
  onClose,
  onDone,
}: DialogProps & { reference?: LineDetailReference }) {
  const editing = reference !== undefined;
  const [title, setTitle] = useState(reference?.title ?? '');
  const [url, setUrl] = useState(reference?.url ?? '');
  const [note, setNote] = useState(reference?.note ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const staged = useRef<{ file: File; attachmentId: string } | null>(null);
  const hasFile = reference?.attachment != null;

  const state = useActivitySend(
    async (payload) => {
      let attachmentId =
        staged.current !== null && staged.current.file === file
          ? staged.current.attachmentId
          : undefined;
      if (file !== null && attachmentId === undefined) {
        setProgress(0);
        try {
          const uploaded = await uploadFile(line.id, {
            file,
            kind: 'reference_file',
            onProgress: setProgress,
          });
          staged.current = { file, attachmentId: uploaded.attachmentId };
          attachmentId = uploaded.attachmentId;
        } finally {
          setProgress(null);
        }
      }
      const body = attachmentId === undefined ? payload : { ...payload, attachmentId };
      return editing ? editReference(line.id, reference.id, body) : addReference(line.id, body);
    },
    editing ? strings.referenceDoneUpdated : strings.referenceDoneAdded,
    onDone,
  );

  // The shared check sees the file as "a staged upload" (its id is only known after uploading).
  const payload = () => ({
    expectedVersion: line.version,
    title,
    url,
    note,
    ...(file === null ? {} : { attachmentId: 'pending' }),
  });

  function submit() {
    const check = validateReference(payload(), hasFile);
    if (!check.ok) {
      state.show(check.errors, 'rf-');
      return;
    }
    state.setErrors({});
    void state.send({ expectedVersion: line.version, title, url, note }, 'rf-');
  }

  return (
    <ActivityFrame
      title={editing ? strings.referenceEditTitle : strings.referenceAddTitle}
      titleId="reference-dialog-title"
      submitLabel={editing ? strings.save : strings.referenceAddSubmit}
      state={state}
      onClose={onClose}
      onSubmit={() => {
        submit();
      }}
      initialFocus="#rf-title"
    >
      <TextField
        id="rf-title"
        label={strings.referenceTitleField}
        required
        value={title}
        error={state.errors['title']}
        onChange={setTitle}
      />
      <TextField
        id="rf-url"
        label={strings.referenceUrlField}
        hint={strings.referenceUrlHint}
        value={url}
        error={state.errors['url']}
        onChange={setUrl}
      />
      <div className="form-field">
        <strong>{strings.referenceFileField}</strong>
        <p className="form-field__hint">
          {hasFile && file === null
            ? strings.referenceFileKeep(reference.attachment?.fileName ?? strings.imageFallbackName)
            : strings.referenceFileHint}
        </p>
        <FilePicker
          onPick={(picked) => {
            const check = checkUpload({ name: picked.name, type: picked.type, size: picked.size });
            if (check.ok) {
              state.setErrors({});
              setFile(picked);
            } else state.setErrors({ file: check.message });
          }}
          onError={(message) => {
            state.setErrors({ file: message });
          }}
        />
        {file === null ? null : (
          <p className="gel-chosen">
            <span>{strings.gelImageChosen(file.name)}</span>
            <button
              type="button"
              onClick={() => {
                setFile(null);
              }}
            >
              {strings.gelImageRemove}
            </button>
          </p>
        )}
        {state.errors['file'] === undefined ? null : (
          <p className="form-field__error" role="alert">
            {state.errors['file']}
          </p>
        )}
        {progress === null ? null : (
          <p className="upload-status" role="status">
            {strings.uploadProgress(progress)}
          </p>
        )}
      </div>
      <NoteField
        id="rf-note"
        label={strings.referenceNoteField}
        value={note}
        error={state.errors['note']}
        onChange={setNote}
      />
    </ActivityFrame>
  );
}

function RemoveReferenceDialog({
  line,
  reference,
  onClose,
  onDone,
}: DialogProps & { reference: LineDetailReference }) {
  const [note, setNote] = useState('');
  const state = useActivitySend(
    (payload) => removeReference(line.id, reference.id, payload),
    strings.referenceDoneRemoved,
    onDone,
  );
  return (
    <ActivityFrame
      title={strings.referenceRemoveTitle(reference.title)}
      titleId="remove-reference-title"
      submitLabel={strings.referenceRemoveSubmit}
      danger
      state={state}
      onClose={onClose}
      onSubmit={() => {
        void state.send({ expectedVersion: line.version, note }, 'rr-');
      }}
      initialFocus="#rr-note"
    >
      <p>{strings.referenceRemoveBody}</p>
      <NoteField id="rr-note" value={note} error={state.errors['note']} onChange={setNote} />
    </ActivityFrame>
  );
}

export function ReferenceManager({
  line,
  canEdit,
  onChanged,
}: {
  line: LineDetailDocument;
  canEdit: boolean;
  /** A message for the toast; the page reloads the line afterwards. */
  onChanged: (message: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<LineDetailReference | null>(null);
  const [removing, setRemoving] = useState<LineDetailReference | null>(null);
  const shared = {
    line,
    onDone: (result: { message: string }) => {
      setAdding(false);
      setEditing(null);
      setRemoving(null);
      onChanged(result.message);
    },
  };
  return (
    <>
      {canEdit ? (
        <p>
          <button
            type="button"
            onClick={() => {
              setAdding(true);
            }}
          >
            {strings.referenceAddButton}
          </button>
        </p>
      ) : null}
      <ReferenceList
        references={line.references}
        renderActions={
          canEdit
            ? (reference) => (
                <RowMenu
                  label={strings.referenceActionsFor(reference.title)}
                  items={[
                    {
                      label: strings.referenceActionEdit,
                      onSelect: () => {
                        setEditing(reference);
                      },
                    },
                    {
                      label: strings.referenceActionRemove,
                      onSelect: () => {
                        setRemoving(reference);
                      },
                      danger: true,
                    },
                  ]}
                />
              )
            : undefined
        }
      />
      {adding ? (
        <ReferenceDialog
          {...shared}
          onClose={() => {
            setAdding(false);
          }}
        />
      ) : null}
      {editing === null ? null : (
        <ReferenceDialog
          {...shared}
          reference={editing}
          onClose={() => {
            setEditing(null);
          }}
        />
      )}
      {removing === null ? null : (
        <RemoveReferenceDialog
          {...shared}
          reference={removing}
          onClose={() => {
            setRemoving(null);
          }}
        />
      )}
    </>
  );
}
