/**
 * Cryopreservation section, read view (T-009 Step 4, FR-CRYO-01/02, docs/04-ui-spec.md §5.3).
 * The header's Yes/No comes from the API (`isCryopreserved`, BR-6 in `domain/cryo.ts`) and the
 * straw total from the API's sum of record counts; nothing is re-derived here.
 */
import type { ReactNode } from 'react';
import { formatDate } from '../dateFormat';
import { formatCryoIds } from '../lineDetailFormat';
import type { LineDetailCryoRecord, LineDetailCryoUse } from '../lineDetailApi';
import { strings } from '../strings';
import { DataTable, EmptyState, type DataColumn } from './shared';

function textOrDash(value: string | null) {
  return value ?? strings.emptyValue;
}

function columns(
  renderActions: ((record: LineDetailCryoRecord) => ReactNode) | undefined,
): readonly DataColumn<LineDetailCryoRecord>[] {
  return renderActions === undefined
    ? COLUMNS
    : [...COLUMNS, { key: 'id', label: strings.cryoActionsLabel, render: renderActions }];
}

const COLUMNS: readonly DataColumn<LineDetailCryoRecord>[] = [
  {
    key: 'cryoDate',
    label: strings.cryoDate,
    render: (record) =>
      record.detailsUnknown ? (
        <span className="cryo-unknown">{strings.detailsUnknown}</span>
      ) : record.cryoDate === null ? (
        strings.emptyValue
      ) : (
        formatDate(record.cryoDate)
      ),
  },
  { key: 'place', label: strings.cryoPlace, render: (record) => textOrDash(record.place) },
  { key: 'boxName', label: strings.cryoBox, render: (record) => textOrDash(record.boxName) },
  {
    key: 'cryoIdStart',
    label: strings.cryoIds,
    render: (record) => (
      <span className="nowrap">
        {formatCryoIds(record.cryoIdStart, record.cryoIdEnd, record.count)}
        {record.usedCount > 0 ? ` · ${strings.cryoUsedCount(record.usedCount)}` : ''}
      </span>
    ),
  },
  { key: 'notes', label: strings.columnNotes, render: (record) => textOrDash(record.notes) },
];

export function CryoTable({
  records,
  isCryopreserved,
  strawCount,
  uses = [],
  renderActions,
  renderUseActions,
}: {
  records: readonly LineDetailCryoRecord[];
  isCryopreserved: boolean;
  strawCount: number;
  /** Vials that were used (they are off the list, kept here for good). */
  uses?: readonly LineDetailCryoUse[];
  /** Row buttons (Edit, Remove); omitted for read-only views. */
  renderActions?: ((record: LineDetailCryoRecord) => ReactNode) | undefined;
  /** The "Undo…" button next to a used vial; omitted for Guests (T-028). */
  renderUseActions?: ((use: LineDetailCryoUse) => ReactNode) | undefined;
}) {
  return (
    <>
      <p className="cryo-header">
        <strong>
          {isCryopreserved ? strings.cryoHeader(records.length, strawCount) : strings.cryoNone}
        </strong>
      </p>
      {records.length === 0 ? (
        <EmptyState />
      ) : (
        <DataTable columns={columns(renderActions)} rows={records} />
      )}
      {uses.length === 0 ? null : (
        <details className="cryo-used">
          <summary>{strings.cryoUsedHeading(uses.length)}</summary>
          <ul>
            {uses.map((use) => (
              <li key={use.id}>
                <strong>{use.cryoId ?? strings.cryoUsedQuantity(use.quantity)}</strong>
                {` · ${strings.cryoUsedOn} ${formatDate(use.usedAt)}`}
                {use.place === null ? '' : ` · ${use.place}`}
                {` · ${use.usedByName}`}
                {use.note === null ? '' : ` — ${use.note}`}
                {renderUseActions === undefined ? null : <> {renderUseActions(use)}</>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
