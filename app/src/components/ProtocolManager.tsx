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

  /** An image for one ID protocol (gel, fluorescence, ...): checked here, then uploaded. */
  function uploadImage(protocol: LineDetailProtocol, file: File) {
    const check = checkUpload({ name: file.name, type: file.type, size: file.size }, true);
    if (!check.ok) {
      onChanged(check.message);
      return;
    }
    const kind =
      protocol.protocolType === 'fluorescence'
        ? 'fluorescence_image'
        : protocol.protocolType === 'pcr' || protocol.protocolType === 'pcr_sequence'
          ? 'gel_image'
          : 'other';
    setProgress(0);
    void quick(async () => {
      try {
        return (await uploadFile(line.id, {
          file,
          kind,
          protocolId: protocol.id,
          expectedVersion: line.version,
          onProgress: setProgress,
        })) as ProtocolWriteResult;
      } finally {
        setProgress(null);
      }
    }, strings.uploadDone);
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
          {strings.uploadProgress(progress)}
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
                  camera
                  primary
                  disabled={busy}
                  onPick={(file) => {
                    uploadImage(protocol, file);
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
