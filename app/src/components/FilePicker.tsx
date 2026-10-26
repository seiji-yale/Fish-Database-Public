/**
 * A file picker (T-016, FR-REF-02): a normal button that opens the file chooser, and — on phones —
 * a second "Take photo" button that opens the camera (`capture="environment"`). The real `<input>`
 * stays in the page (visually hidden) with its own label, so screen readers and tests reach it.
 */
import { useId, useRef } from 'react';
import {
  ACCEPT_ATTRIBUTE,
  IMAGE_ACCEPT_ATTRIBUTE,
  SEQUENCE_ACCEPT_ATTRIBUTE,
  uploadMessages,
} from '../../../domain/attachments';
import { convertHeicToJpeg, isHeic } from '../thumbnail';
import { strings } from '../strings';

export function FilePicker({
  label = strings.uploadChoose,
  imagesOnly = false,
  sequenceOnly = false,
  camera = false,
  primary = false,
  disabled = false,
  multiple = false,
  onPick,
  onPickMany,
  onError,
}: {
  label?: string;
  imagesOnly?: boolean;
  /** Sequence files only (.ab1, .fasta, .seq, ...). */
  sequenceOnly?: boolean;
  /** Also offer "Take photo" (shown on touch screens only). */
  camera?: boolean;
  /** A prominent (blue) button, for the main upload spot under an image. */
  primary?: boolean;
  disabled?: boolean;
  /** Choose several files at once; `onPick` is then called once per file, in the order chosen. */
  multiple?: boolean;
  onPick: (file: File) => void;
  /** With `multiple`: all chosen files in one call (instead of `onPick` once per file). */
  onPickMany?: ((files: File[]) => void) | undefined;
  /** Called instead of `onPick` when the file cannot be used (HEIC on a browser that cannot convert it). */
  onError?: ((message: string) => void) | undefined;
}) {
  const id = useId();
  const chooser = useRef<HTMLInputElement>(null);
  const photo = useRef<HTMLInputElement>(null);
  const accept = sequenceOnly
    ? SEQUENCE_ACCEPT_ATTRIBUTE
    : imagesOnly
      ? IMAGE_ACCEPT_ATTRIBUTE
      : ACCEPT_ATTRIBUTE;
  function picked(input: HTMLInputElement) {
    const chosen = multiple ? [...(input.files ?? [])] : [...(input.files ?? [])].slice(0, 1);
    input.value = '';
    if (chosen.length === 0) return;
    // HEIC (iPhone) does not display in most browsers: convert it to JPEG here, or say it cannot be used.
    void Promise.all(
      chosen.map(async (file) => {
        if (!isHeic(file)) return file;
        const converted = await convertHeicToJpeg(file);
        if (converted === null) onError?.(uploadMessages.heicUnsupported);
        return converted;
      }),
    ).then((files) => {
      const usable = files.filter((file): file is File => file !== null);
      if (usable.length === 0) return;
      if (onPickMany !== undefined) onPickMany(usable);
      else for (const file of usable) onPick(file);
    });
  }
  return (
    <span className="file-picker">
      <input
        ref={chooser}
        id={id}
        className="sr-only"
        type="file"
        multiple={multiple}
        accept={accept}
        aria-label={label}
        tabIndex={-1}
        disabled={disabled}
        onChange={(event) => {
          picked(event.target);
        }}
      />
      <button
        type="button"
        className={primary ? 'button--primary' : undefined}
        disabled={disabled}
        onClick={() => {
          chooser.current?.click();
        }}
      >
        {label}
      </button>
      {camera ? (
        <>
          <input
            ref={photo}
            id={`${id}-camera`}
            className="sr-only"
            type="file"
            accept={IMAGE_ACCEPT_ATTRIBUTE}
            capture="environment"
            aria-label={strings.uploadTakePhoto}
            tabIndex={-1}
            disabled={disabled}
            onChange={(event) => {
              picked(event.target);
            }}
          />
          <button
            type="button"
            className="file-picker__camera"
            disabled={disabled}
            onClick={() => {
              photo.current?.click();
            }}
          >
            {strings.uploadTakePhoto}
          </button>
        </>
      ) : null}
    </span>
  );
}
