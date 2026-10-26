/**
 * Sequence files on an ID protocol (T-038): Sanger traces (.ab1, .abi), FASTA and .seq files. They are
 * listed with name, size and a download link (never displayed), and an editor can remove one.
 */
import type { ReactNode } from 'react';
import type { LineDetailAttachment } from '../lineDetailApi';
import { formatFileSize } from '../lineDetailFormat';
import { strings } from '../strings';
import { attachmentUrl } from './Images';

const nameOf = (attachment: LineDetailAttachment): string =>
  attachment.caption ?? attachment.fileName ?? strings.imageFallbackName;

export function SequenceFiles({
  attachments,
  onRemove,
  uploader,
}: {
  attachments: readonly LineDetailAttachment[];
  onRemove?: ((attachment: LineDetailAttachment) => void) | undefined;
  /** The upload control for editors; told whether the list already has files. */
  uploader?: ((hasFiles: boolean) => ReactNode) | undefined;
}) {
  // Nothing to show to a reader when no file was attached.
  if (attachments.length === 0 && uploader === undefined) return null;
  return (
    <div className="detail-field detail-field--block sequence-files">
      <strong>{strings.sequenceFilesHeading}</strong>
      {attachments.length === 0 ? (
        <span>{strings.sequenceFilesEmpty}</span>
      ) : (
        <ul className="attribute-list">
          {attachments.map((attachment) => (
            <li key={attachment.id}>
              <a
                href={attachmentUrl(attachment.id)}
                download={attachment.fileName ?? true}
                aria-label={strings.sequenceFileDownload(nameOf(attachment))}
              >
                {nameOf(attachment)}
              </a>
              {attachment.sizeBytes === null ? '' : ` (${formatFileSize(attachment.sizeBytes)})`}
              {onRemove === undefined ? null : (
                <button
                  type="button"
                  aria-label={strings.sequenceFileRemove(nameOf(attachment))}
                  onClick={() => {
                    onRemove(attachment);
                  }}
                >
                  {strings.sequenceFileRemoveButton}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {uploader === undefined ? null : (
        <div className="image-upload">
          {uploader(attachments.length > 0)}
          <span className="form-field__hint">{strings.sequenceFilesHint}</span>
        </div>
      )}
    </div>
  );
}
