/**
 * The two dialogs for sequence-file notes (T-038): one before uploading (a note per chosen file) and
 * one to edit the note of a file that is already attached.
 */
import { useId, useState } from 'react';
import { MAX_NOTE_LENGTH, uploadMessages } from '../../../domain/attachments';
import type { LineDetailAttachment } from '../lineDetailApi';
import { strings } from '../strings';
import { TextField } from './formFields';
import { Modal } from './Modal';

const tooLong = (note: string) => note.trim().length > MAX_NOTE_LENGTH;

/** Chosen files, each with an optional note, then Upload. */
export function SequenceUploadDialog({
  files,
  onCancel,
  onUpload,
}: {
  files: readonly File[];
  onCancel: () => void;
  /** The notes, in the order of `files` (an empty string means no note). */
  onUpload: (notes: string[]) => void;
}) {
  const titleId = useId();
  const [notes, setNotes] = useState<string[]>(() => files.map(() => ''));
  const invalid = notes.some(tooLong);
  return (
    <Modal
      title={strings.sequenceUploadTitle(files.length)}
      titleId={titleId}
      onClose={onCancel}
      initialFocus="#sq-note-0"
      wide
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!invalid) onUpload(notes.map((note) => note.trim()));
        }}
      >
        {files.map((file, index) => (
          <TextField
            key={`${file.name}-${String(file.size)}-${String(index)}`}
            id={`sq-note-${String(index)}`}
            label={strings.sequenceNoteFor(file.name)}
            {...(index === 0 ? { hint: strings.sequenceNoteHint } : {})}
            value={notes[index] ?? ''}
            error={tooLong(notes[index] ?? '') ? uploadMessages.noteTooLong : undefined}
            onChange={(value) => {
              setNotes((current) => current.map((note, at) => (at === index ? value : note)));
            }}
          />
        ))}
        <div className="dialog__actions">
          <button type="button" onClick={onCancel}>
            {strings.cancel}
          </button>
          <button type="submit" className="button--primary" disabled={invalid}>
            {strings.sequenceUploadSubmit}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** Edit the note of one attached file; saving an empty note clears it. */
export function SequenceNoteDialog({
  attachment,
  busy,
  onCancel,
  onSave,
}: {
  attachment: LineDetailAttachment;
  busy: boolean;
  onCancel: () => void;
  onSave: (note: string) => void;
}) {
  const titleId = useId();
  const [note, setNote] = useState(attachment.caption ?? '');
  const name = attachment.fileName ?? strings.imageFallbackName;
  return (
    <Modal
      title={strings.sequenceNoteFor(name)}
      titleId={titleId}
      onClose={onCancel}
      initialFocus="#sq-note"
      wide
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!tooLong(note)) onSave(note.trim());
        }}
      >
        <TextField
          id="sq-note"
          label={strings.sequenceNoteLabel}
          hint={strings.sequenceNoteHint}
          value={note}
          error={tooLong(note) ? uploadMessages.noteTooLong : undefined}
          onChange={setNote}
        />
        <div className="dialog__actions">
          <button type="button" onClick={onCancel}>
            {strings.cancel}
          </button>
          <button type="submit" className="button--primary" disabled={busy || tooLong(note)}>
            {strings.sequenceNoteSave}
          </button>
        </div>
      </form>
    </Modal>
  );
}
