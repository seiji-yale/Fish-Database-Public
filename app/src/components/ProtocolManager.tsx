/**
 * The ID Protocols section with its edit controls (T-014, FR-ID-01/02/09): "+ Add ID method", and
 * per protocol Edit, Set as current, Move up/down and Remove. Add/Edit/Remove open a dialog; Set as
 * current and Move act at once. The quick actions are handled here and the dialogs inside `ActivityFrame`.
 */
import { useState } from 'react';
import { checkUpload } from '../../../domain/attachments';
import { HttpError } from '../api';
import type {
  LineDetailAttachment,
  LineDetailDocument,
  LineDetailProtocol,
} from '../lineDetailApi';
import { reorderProtocols, setCurrentProtocol, type ProtocolWriteResult } from '../protocolsApi';
import { strings } from '../strings';
import { removeAttachment, uploadFile } from '../uploadApi';
import { FilePicker } from './FilePicker';
import { ProtocolDialog, RemoveProtocolDialog } from './ProtocolDialogs';
import { ProtocolsSection } from './ProtocolCards';

export function ProtocolManager({
  line,
  canEdit,
  adding,
  onAddingChange,
  onChanged,
}: {
  line: LineDetailDocument;
  canEdit: boolean;
  /** Controlled so the Change Activity menu can open the Add dialog. */
  adding: boolean;
  onAddingChange: (adding: boolean) => void;
  /** A message for the toast; the page reloads the line afterwards. */
  onChanged: (message: string) => void;
}) {
  const [editing, setEditing] = useState<LineDetailProtocol | null>(null);
  const [removing, setRemoving] = useState<LineDetailProtocol | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [progressFile, setProgressFile] = useState<{ number: number; of: number } | null>(null);

  /** Runs one immediate write and tells the page the outcome. */
  async function quick(run: () => Promise<ProtocolWriteResult>, label: string) {
    setBusy(true);
    try {
      const result = await run();
      onChanged(strings.activityDone(label, result.version));
    } catch (cause: unknown) {
      onChanged(
        cause instanceof HttpError && cause.body !== null
          ? cause.body.message
          : strings.activityFailed,
      );
    } finally {
      setBusy(false);
    }
  }

  /**
   * Files for one ID protocol, one after the other (each upload is a line version, so the next one
   * starts from the version the last one returned). Images take the protocol's image kind; sequence
   * files (.ab1, .fasta, .seq) are sequence results. A file that fails is named in the message and
   * the rest still go up.
   */
  async function uploadMany(
    protocol: LineDetailProtocol,
    files: File[],
    scope: 'images' | 'sequence',
  ) {
    const kind =
      scope === 'sequence'
        ? 'sequence_result'
        : protocol.protocolType === 'fluorescence'
          ? 'fluorescence_image'
          : protocol.protocolType === 'pcr' || protocol.protocolType === 'pcr_sequence'
            ? 'gel_image'
            : 'other';
    setBusy(true);
    let version = line.version;
    let uploaded = 0;
    const failed: string[] = [];
    for (const [index, file] of files.entries()) {
      const check = checkUpload({ name: file.name, type: file.type, size: file.size }, scope);
      if (!check.ok) {
        failed.push(`${file.name}: ${check.message}`);
        continue;
      }
      setProgress(0);
      setProgressFile(files.length > 1 ? { number: index + 1, of: files.length } : null);
      try {
        const result = await uploadFile(line.id, {
          file,
          kind,
          protocolId: protocol.id,
          expectedVersion: version,
          onProgress: setProgress,
        });
        version = result.version ?? version;
        uploaded += 1;
      } catch (cause: unknown) {
        const reason =
          cause instanceof HttpError && cause.body !== null
            ? cause.body.message
            : strings.uploadFailed;
        failed.push(`${file.name}: ${reason}`);
        // A newer version of the line makes every later upload fail the same way: stop and reload.
        if (cause instanceof HttpError && cause.body?.code === 'VERSION_CONFLICT') break;
      }
    }
    setProgress(null);
    setProgressFile(null);
    setBusy(false);
    const label = scope === 'sequence' ? strings.sequenceFileUploaded : strings.uploadDone;
    const done =
      uploaded === 0
        ? ''
        : uploaded === 1
          ? strings.activityDone(label, version)
          : strings.activityDone(strings.uploadManyDone(uploaded), version);
    onChanged([done, ...failed].filter((part) => part !== '').join(' '));
  }

  function removeImage(attachment: LineDetailAttachment) {
    void quick(
      () =>
        removeAttachment(line.id, attachment.id, {
          expectedVersion: line.version,
        }) as Promise<ProtocolWriteResult>,
      strings.uploadRemoveDone,
    );
  }

  function move(protocol: LineDetailProtocol, delta: -1 | 1) {
    const order = line.protocols.map((entry) => entry.id);
    const from = order.indexOf(protocol.id);
    order.splice(from, 1);
    order.splice(from + delta, 0, protocol.id);
    void quick(
      () => reorderProtocols(line.id, { expectedVersion: line.version, order }),
      strings.protocolDoneMoved,
    );
  }

  const done = (result: { message: string }) => {
    setEditing(null);
    setRemoving(null);
    onAddingChange(false);
    onChanged(result.message);
  };
  const shared = { line, onDone: done };

  return (
    <>
      {canEdit ? (
        <p>
          <button
            type="button"
            onClick={() => {
              onAddingChange(true);
            }}
          >
            {strings.protocolAddButton}
          </button>
        </p>
      ) : null}
      {progress === null ? null : (
        <p className="upload-status" role="status">
          {progressFile === null
            ? strings.uploadProgress(progress)
            : strings.uploadProgressOf(progress, progressFile.number, progressFile.of)}
        </p>
      )}
      <ProtocolsSection
        protocols={line.protocols}
        onRemoveImage={canEdit ? removeImage : undefined}
        renderUpload={
          canEdit
            ? (protocol, hasImages) => (
                <FilePicker
                  label={hasImages ? strings.uploadAnotherImage : strings.uploadImage}
                  imagesOnly
                  multiple
                  camera
                  primary
                  disabled={busy}
                  onPick={() => undefined}
                  onPickMany={(files) => {
                    void uploadMany(protocol, files, 'images');
                  }}
                  onError={onChanged}
                />
              )
            : undefined
        }
        renderSequenceUpload={
          canEdit
            ? (protocol, hasFiles) => (
                <FilePicker
                  label={hasFiles ? strings.uploadAnotherSequenceFile : strings.uploadSequenceFile}
                  sequenceOnly
                  multiple
                  disabled={busy}
                  onPick={() => undefined}
                  onPickMany={(files) => {
                    void uploadMany(protocol, files, 'sequence');
                  }}
                  onError={onChanged}
                />
              )
            : undefined
        }
        renderActions={
          canEdit
            ? (protocol, index, count) => (
                <div
                  className="protocol-actions"
                  role="group"
                  aria-label={strings.protocolActionsLabel(protocol.label)}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(protocol);
                    }}
                  >
                    {strings.protocolActionEdit}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      void quick(
                        () =>
                          setCurrentProtocol(line.id, protocol.id, {
                            expectedVersion: line.version,
                            current: !protocol.isCurrent,
                          }),
                        strings.protocolDoneCurrent,
                      );
                    }}
                  >
                    {protocol.isCurrent ? strings.protocolUnsetCurrent : strings.protocolSetCurrent}
                  </button>
                  <button
                    type="button"
                    disabled={busy || index === 0}
                    onClick={() => {
                      move(protocol, -1);
                    }}
                  >
                    {strings.protocolMoveUp}
                  </button>
                  <button
                    type="button"
                    disabled={busy || index === count - 1}
                    onClick={() => {
                      move(protocol, 1);
                    }}
                  >
                    {strings.protocolMoveDown}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRemoving(protocol);
                    }}
                  >
                    {strings.protocolRemoveAction}
                  </button>
                </div>
              )
            : undefined
        }
      />
      {adding ? (
        <ProtocolDialog
          {...shared}
          onClose={() => {
            onAddingChange(false);
          }}
        />
      ) : null}
      {editing === null ? null : (
        <ProtocolDialog
          {...shared}
          protocol={editing}
          onClose={() => {
            setEditing(null);
          }}
        />
      )}
      {removing === null ? null : (
        <RemoveProtocolDialog
          {...shared}
          protocol={removing}
          onClose={() => {
            setRemoving(null);
          }}
        />
      )}
    </>
  );
}
