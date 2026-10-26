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
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const staged = useRef<Map<File, string>>(new Map());
  /** Files already turned into references (a retry after a failure skips them) and the version after them. */
  const created = useRef<{ files: Set<File>; version: number | null }>({
    files: new Set(),
    version: null,
  });
  const hasFile = reference?.attachment != null;
  // Several files at once make one reference each, titled with the file name (add only).
  const many = !editing && files.length > 1;
  const file = files.length === 1 ? (files[0] ?? null) : null;

  async function stage(picked: File): Promise<string> {
    const known = staged.current.get(picked);
    if (known !== undefined) return known;
    setProgress(0);
    try {
      const uploaded = await uploadFile(line.id, {
        file: picked,
        kind: 'reference_file',
        onProgress: setProgress,
      });
      staged.current.set(picked, uploaded.attachmentId);
      return uploaded.attachmentId;
    } finally {
      setProgress(null);
    }
  }

  const state = useActivitySend(
    async (payload) => {
      if (many) {
        let version = created.current.version ?? line.version;
        for (const picked of files) {
          if (created.current.files.has(picked)) continue;
          const attachmentId = await stage(picked);
          const result = await addReference(line.id, {
            expectedVersion: version,
            title: picked.name,
            url: '',
            note,
            attachmentId,
          });
          version = result.version;
          created.current = { files: created.current.files.add(picked), version };
        }
        return { version };
      }
      const attachmentId = file === null ? undefined : await stage(file);
      const body = attachmentId === undefined ? payload : { ...payload, attachmentId };
      return editing ? editReference(line.id, reference.id, body) : addReference(line.id, body);
    },
    editing
      ? strings.referenceDoneUpdated
      : many
        ? strings.referenceDoneAddedMany(files.length)
        : strings.referenceDoneAdded,
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
    if (many) {
      if (url.trim() !== '') {
        state.show({ url: strings.referenceManyNoLink }, 'rf-');
        return;
      }
      state.setErrors({});
      void state.send({}, 'rf-');
      return;
    }
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
      {many ? (
        <p className="form-field__hint">{strings.referenceManyFiles(files.length)}</p>
      ) : (
        <TextField
          id="rf-title"
          label={strings.referenceTitleField}
          required
          value={title}
          error={state.errors['title']}
          onChange={setTitle}
        />
      )}
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
          multiple={!editing}
          onPick={() => undefined}
          onPickMany={(picked) => {
            const problems: string[] = [];
            const usable = picked.filter((candidate) => {
              const check = checkUpload({
                name: candidate.name,
                type: candidate.type,
                size: candidate.size,
              });
              if (!check.ok) problems.push(`${candidate.name}: ${check.message}`);
              return check.ok;
            });
            state.setErrors(problems.length === 0 ? {} : { file: problems.join(' ') });
            if (usable.length === 0) return;
            setFiles(usable);
            // One file: its name (with the extension) is the title unless a title is typed already.
            const only = usable.length === 1 ? usable[0] : undefined;
            if (only !== undefined && title.trim() === '') setTitle(only.name);
          }}
          onError={(message) => {
            state.setErrors({ file: message });
          }}
        />
        {files.length === 0 ? null : (
          <div className="gel-chosen">
            <ul className="attribute-list">
              {files.map((chosen) => (
                <li key={`${chosen.name}-${String(chosen.size)}-${String(chosen.lastModified)}`}>
                  {strings.gelImageChosen(chosen.name)}
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => {
                setFiles([]);
              }}
            >
              {strings.gelImageRemove}
            </button>
          </div>
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
