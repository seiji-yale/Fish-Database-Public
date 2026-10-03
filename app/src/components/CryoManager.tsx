/**
 * The Cryopreservation section with its edit controls (T-015): "+ Add record" and Edit / Remove per
 * record. Add is controlled so the Change Activity menu ("Update Cryopreservation Info") can open it.
 */
import { useState } from 'react';
import type { LineDetailCryoRecord, LineDetailCryoUse, LineDetailDocument } from '../lineDetailApi';
import { strings } from '../strings';
import { CryoDialog, RemoveCryoDialog, UndoCryoUseDialog } from './CryoDialogs';
import { CryoTable } from './CryoTable';
import { RowMenu } from './RowMenu';

export function CryoManager({
  line,
  canEdit,
  adding,
  onAddingChange,
  onChanged,
}: {
  line: LineDetailDocument;
  canEdit: boolean;
  adding: boolean;
  onAddingChange: (adding: boolean) => void;
  /** A message for the toast; the page reloads the line afterwards. */
  onChanged: (message: string) => void;
}) {
  const [editing, setEditing] = useState<LineDetailCryoRecord | null>(null);
  const [removing, setRemoving] = useState<LineDetailCryoRecord | null>(null);
  const [using, setUsing] = useState(false);
  const [undoing, setUndoing] = useState<LineDetailCryoUse | null>(null);
  const shared = {
    line,
    onDone: (result: { message: string }) => {
      setEditing(null);
      setRemoving(null);
      setUsing(false);
      setUndoing(null);
      onAddingChange(false);
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
              onAddingChange(true);
            }}
          >
            {strings.cryoAddButton}
          </button>
        </p>
      ) : null}
      <CryoTable
        records={line.cryoRecords}
        isCryopreserved={line.isCryopreserved}
        strawCount={line.cryoStrawCount}
        uses={line.cryoUses}
        renderUseActions={
          canEdit
            ? (use) => (
                <button
                  type="button"
                  className="button--link"
                  aria-label={strings.cryoUndoFor(
                    use.cryoId ?? strings.cryoUsedQuantity(use.quantity),
                  )}
                  onClick={() => {
                    setUndoing(use);
                  }}
                >
                  {strings.cryoUndoAction}
                </button>
              )
            : undefined
        }
        renderActions={
          canEdit
            ? (record) => (
                <RowMenu
                  label={strings.cryoActionsFor(
                    record.cryoIdStart === null
                      ? (record.place ?? strings.sectionCryopreservation)
                      : record.cryoIdStart,
                  )}
                  items={[
                    {
                      label: strings.cryoActionEdit,
                      onSelect: () => {
                        setEditing(record);
                      },
                    },
                    {
                      label: strings.cryoActionUse,
                      onSelect: () => {
                        setUsing(true);
                      },
                    },
                    {
                      label: strings.cryoActionRemove,
                      onSelect: () => {
                        setRemoving(record);
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
        <CryoDialog
          {...shared}
          onClose={() => {
            onAddingChange(false);
          }}
        />
      ) : null}
      {using ? (
        <CryoDialog
          {...shared}
          initialMode="use"
          onClose={() => {
            setUsing(false);
          }}
        />
      ) : null}
      {editing === null ? null : (
        <CryoDialog
          {...shared}
          record={editing}
          onClose={() => {
            setEditing(null);
          }}
        />
      )}
      {undoing === null ? null : (
        <UndoCryoUseDialog
          {...shared}
          use={undoing}
          onClose={() => {
            setUndoing(null);
          }}
        />
      )}
      {removing === null ? null : (
        <RemoveCryoDialog
          {...shared}
          record={removing}
          onClose={() => {
            setRemoving(null);
          }}
        />
      )}
    </>
  );
}
