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
import { Icon } from './Icons';
import { RowMenu } from './RowMenu';
import { ConfirmDialog } from './shared';
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
  /** An image or sequence file waiting for the "Remove this file?" answer. */
  const [removingFile, setRemovingFile] = useState<LineDetailAttachment | null>(null);
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
      attachment.kind === 'sequence_result'
        ? strings.sequenceFileRemoved
        : strings.uploadRemoveDone,
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
        onRemoveImage={canEdit ? setRemovingFile : undefined}
        renderUpload={
          canEdit
            ? (protocol) => (
                <FilePicker
                  label={strings.uploadImage}
                  iconOnly
                  imagesOnly
                  multiple
                  camera
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
            ? (protocol) => (
                <FilePicker
                  label={strings.uploadSequenceFile}
                  iconOnly
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
                    className="protocol-actions__edit"
                    onClick={() => {
                      setEditing(protocol);
                    }}
                  >
                    <Icon name="pencil" />
                    {strings.protocolActionEdit}
                  </button>
                  <RowMenu
                    label={strings.protocolMoreActions(protocol.label)}
                    items={[
                      {
                        label: protocol.isCurrent
                          ? strings.protocolUnsetCurrent
                          : strings.protocolSetCurrent,
                        onSelect: () => {
                          void quick(
                            () =>
                              setCurrentProtocol(line.id, protocol.id, {
                                expectedVersion: line.version,
                                current: !protocol.isCurrent,
                              }),
                            strings.protocolDoneCurrent,
                          );
                        },
                      },
                      ...(index === 0
                        ? []
                        : [
                            {
                              label: strings.protocolMoveUp,
                              onSelect: () => {
                                move(protocol, -1);
                              },
                            },
                          ]),
                      ...(index === count - 1
                        ? []
                        : [
                            {
                              label: strings.protocolMoveDown,
                              onSelect: () => {
                                move(protocol, 1);
                              },
                            },
                          ]),
                      {
                        label: strings.protocolRemoveAction,
                        danger: true,
                        onSelect: () => {
                          setRemoving(protocol);
                        },
                      },
                    ]}
                  />
                </div>
              )
            : undefined
        }
      />
      {removingFile === null ? null : (
        <ConfirmDialog
          title={strings.attachmentRemoveTitle}
          confirmLabel={strings.attachmentRemoveConfirm}
          onCancel={() => {
            setRemovingFile(null);
          }}
          onConfirm={() => {
            const file = removingFile;
            setRemovingFile(null);
            removeImage(file);
          }}
        >
          <p>
            {strings.attachmentRemoveBody(
              removingFile.caption ?? removingFile.fileName ?? strings.imageFallbackName,
            )}
          </p>
        </ConfirmDialog>
      )}
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
