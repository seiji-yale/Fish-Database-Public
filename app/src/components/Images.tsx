/**
 * Attachment images for Line Detail (T-009 Step 3, FR-ID-03/05, docs/04-ui-spec.md §5.2): the
 * latest image as a thumbnail that opens a full-screen `ImageLightbox`, with older images behind a
 * "Other images (n)" expander. Bytes come from `GET /api/attachments/:id/file` (read-only;
 * uploading is T-016). Non-image attachments (PDF, ...) are listed as "Open" links instead.
 */
import { type ReactNode, useEffect, useRef, useState } from 'react';
import type { LineDetailAttachment } from '../lineDetailApi';
import { strings } from '../strings';

export const attachmentUrl = (id: string, thumb = false): string =>
  `/api/attachments/${encodeURIComponent(id)}/file${thumb ? '?thumb=1' : ''}`;

const isImage = (attachment: LineDetailAttachment): boolean =>
  attachment.mimeType?.startsWith('image/') === true;

const displayName = (attachment: LineDetailAttachment): string =>
  attachment.caption ?? attachment.fileName ?? strings.imageFallbackName;

/** Full-screen image viewer: Escape or the button closes it; focus is held on the Close button
 * while open (the only control) and returned to the thumbnail that opened it. */
export function ImageLightbox({
  attachment,
  onClose,
}: {
  attachment: LineDetailAttachment;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  // Zoom: 100 % fits the screen; the buttons (and a pinch on a phone) enlarge it inside the scroller.
  const [zoom, setZoom] = useState(100);
  useEffect(() => {
    closeRef.current?.focus();
  }, []);
  return (
    <div
      className="dialog-backdrop lightbox"
      onClick={onClose}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
        // Keep Tab inside the dialog: it cycles through the toolbar buttons only.
        if (event.key === 'Tab') {
          const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
          const first = buttons[0];
          const last = buttons.at(-1);
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }
      }}
    >
      <div
        className="lightbox__panel"
        onClick={(event) => {
          // The toolbar buttons (zoom) must not count as a click on the backdrop, which closes.
          event.stopPropagation();
        }}
        role="dialog"
        aria-modal="true"
        aria-label={displayName(attachment)}
      >
        <button
          ref={closeRef}
          type="button"
          className="lightbox__close"
          aria-label={strings.closeImage}
          title={strings.closeImage}
          onClick={onClose}
        >
          {strings.closeIcon}
        </button>
        <div className="lightbox__tools">
          <button
            type="button"
            onClick={() => {
              setZoom((current) => Math.min(400, current + 50));
            }}
          >
            {strings.uploadZoomIn}
          </button>
          <button
            type="button"
            onClick={() => {
              setZoom((current) => Math.max(50, current - 50));
            }}
          >
            {strings.uploadZoomOut}
          </button>
          <button
            type="button"
            onClick={() => {
              setZoom(100);
            }}
          >
            {strings.uploadZoomFit}
          </button>
        </div>
        <div className="lightbox__scroller">
          <img
            src={attachmentUrl(attachment.id)}
            alt={displayName(attachment)}
            style={{
              maxWidth: zoom === 100 ? '100%' : 'none',
              width: zoom === 100 ? undefined : `${String(zoom)}%`,
            }}
            onClick={(event) => {
              event.stopPropagation();
            }}
          />
        </div>
      </div>
    </div>
  );
}

function Thumbnail({
  attachment,
  onRemove,
}: {
  attachment: LineDetailAttachment;
  onRemove?: ((attachment: LineDetailAttachment) => void) | undefined;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <span className="thumb-wrap">
        <button
          ref={buttonRef}
          type="button"
          className="thumb-button"
          aria-label={strings.viewImage(displayName(attachment))}
          onClick={() => {
            setOpen(true);
          }}
        >
          <img src={attachmentUrl(attachment.id, true)} alt="" loading="lazy" />
        </button>
        {onRemove === undefined ? null : (
          <button
            type="button"
            className="thumb-remove"
            aria-label={`${strings.uploadRemoveImage}: ${displayName(attachment)}`}
            title={strings.uploadRemoveImage}
            onClick={() => {
              onRemove(attachment);
            }}
          >
            {strings.closeIcon}
          </button>
        )}
      </span>
      {open ? (
        <ImageLightbox
          attachment={attachment}
          onClose={() => {
            setOpen(false);
            // Restore focus after the dialog unmounts.
            setTimeout(() => buttonRef.current?.focus(), 0);
          }}
        />
      ) : null}
    </>
  );
}

/**
 * `showEmptyHint`: protocol types that expect an image (PCR, PCR + Sequence, Fluorescence) say so
 * when none exists yet; others render nothing for an empty list.
 */
export function AttachmentImages({
  attachments,
  showEmptyHint = false,
  onRemove,
  uploader,
}: {
  attachments: readonly LineDetailAttachment[];
  showEmptyHint?: boolean;
  /** Given to people who may edit: the upload control shown right under the images (T-016). */
  uploader?: ((hasImages: boolean) => ReactNode) | undefined;
  /** Given to people who may edit: shows a "Remove image" button under each image. */
  onRemove?: ((attachment: LineDetailAttachment) => void) | undefined;
}) {
  const images = attachments
    .filter(isImage)
    // The newest image is the latest: a protocol card also shows the gel images of the genotyping
    // records done with it (T-016), so `isLatest` alone (per owner) cannot decide.
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const files = attachments.filter((attachment) => !isImage(attachment));
  const [latest, ...previous] = images;

  if (latest === undefined && files.length === 0)
    return showEmptyHint ? (
      <>
        <p className="image-empty">{strings.noImageYet}</p>
        {uploader === undefined ? null : <div className="image-upload">{uploader(false)}</div>}
      </>
    ) : null;
  return (
    <div className="detail-field detail-field--block">
      <strong>{latest === undefined ? strings.imagesHeading : strings.latestImage}</strong>
      {latest === undefined ? null : <Thumbnail attachment={latest} onRemove={onRemove} />}
      {previous.length > 0 ? (
        <details>
          <summary>{strings.previousImages(previous.length)}</summary>
          <div className="thumb-row">
            {previous.map((attachment) => (
              <Thumbnail key={attachment.id} attachment={attachment} onRemove={onRemove} />
            ))}
          </div>
        </details>
      ) : null}
      {uploader === undefined ? null : (
        <div className="image-upload">{uploader(latest !== undefined)}</div>
      )}
      {files.map((attachment) => (
        <a key={attachment.id} href={attachmentUrl(attachment.id)} target="_blank" rel="noreferrer">
          {`${strings.openFile}: ${displayName(attachment)}`}
        </a>
      ))}
    </div>
  );
}
