/**
 * Sequence files on an ID protocol (T-038): Sanger traces (.ab1, .abi), FASTA and .seq files. They are
 * listed with name, size and a download link (never displayed). An editor gets an upload icon in the
 * heading and a remove icon on each row.
 */
import type { ReactNode } from 'react';
import type { LineDetailAttachment } from '../lineDetailApi';
import { formatFileSize } from '../lineDetailFormat';
import { strings } from '../strings';
import { IconButton } from './Icons';
import { attachmentUrl } from './Images';

const nameOf = (attachment: LineDetailAttachment): string =>
  attachment.fileName ?? strings.imageFallbackName;

export function SequenceFiles({
  attachments,
  onRemove,
  onEditNote,
  uploader,
}: {
  attachments: readonly LineDetailAttachment[];
  onRemove?: ((attachment: LineDetailAttachment) => void) | undefined;
  /** Given to people who may edit: a pencil on each row opens the note of that file. */
  onEditNote?: ((attachment: LineDetailAttachment) => void) | undefined;
  /** The upload control for editors (shown in the heading row); told whether the list has files. */
  uploader?: ((hasFiles: boolean) => ReactNode) | undefined;
}) {
  // Nothing to show to a reader when no file was attached.
  if (attachments.length === 0 && uploader === undefined) return null;
  return (
    <div className="detail-field detail-field--block sequence-files">
      <div className="field-head">
        <strong>{strings.sequenceFilesHeading}</strong>
        {uploader === undefined ? null : (
          <span className="field-head__actions">{uploader(attachments.length > 0)}</span>
        )}
      </div>
      {attachments.length === 0 ? (
        <span className="form-field__hint">{strings.sequenceFilesEmpty}</span>
      ) : (
        <ul className="file-list">
          {attachments.map((attachment) => (
            <li key={attachment.id}>
              <span className="file-list__main">
                <a
                  href={attachmentUrl(attachment.id)}
                  download={attachment.fileName ?? true}
                  aria-label={strings.sequenceFileDownload(nameOf(attachment))}
                >
                  {nameOf(attachment)}
                </a>
                {attachment.sizeBytes === null ? null : (
                  <span className="file-list__size">{formatFileSize(attachment.sizeBytes)}</span>
                )}
                {attachment.caption === null ? null : (
                  <span className="file-list__note">{attachment.caption}</span>
                )}
              </span>
              {onEditNote === undefined ? null : (
                <IconButton
                  icon="pencil"
                  label={strings.sequenceNoteEdit(nameOf(attachment))}
                  onClick={() => {
                    onEditNote(attachment);
                  }}
                />
              )}
              {onRemove === undefined ? null : (
                <IconButton
                  icon="trash"
                  danger
                  label={strings.sequenceFileRemove(nameOf(attachment))}
                  onClick={() => {
                    onRemove(attachment);
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {uploader === undefined ? null : (
        <span className="form-field__hint">{strings.sequenceFilesHint}</span>
      )}
    </div>
  );
}
