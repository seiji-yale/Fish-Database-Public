import { type ReactNode, useId } from 'react';
import { Modal } from './Modal';
import { strings } from '../strings';
export type Status = 'Current' | 'Breeding' | 'Closed';
/** A label/value row, used anywhere a page shows a flat list of fields (Line Detail's Summary and
 * Protocol cards). */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <p className="detail-field">
      <strong>{label}</strong>
      <span>{children}</span>
    </p>
  );
}
export function StatusBadge({ status }: { status: Status }) {
  const icons: Record<Status, string> = { Current: '●', Breeding: '◐', Closed: '■' };
  return (
    <span className={`status-badge status-badge--${status.toLowerCase()}`}>
      <span aria-hidden="true">{icons[status]}</span>
      {strings[status.toLowerCase() as 'current' | 'breeding' | 'closed']}
    </span>
  );
}
export function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="toast" role="status">
      <span>{message}</span>
      <button type="button" aria-label={strings.toastClose} onClick={onClose}>
        {strings.dismissIcon}
      </button>
    </div>
  );
}
export function ConfirmDialog({
  title,
  children,
  onCancel,
  onConfirm,
  confirmLabel = strings.confirm,
  confirmDisabled = false,
}: {
  title: string;
  children: ReactNode;
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel?: string;
  confirmDisabled?: boolean;
}) {
  const titleId = useId();
  return (
    <Modal title={title} titleId={titleId} onClose={onCancel} wide>
      <div>{children}</div>
      <div className="dialog__actions">
        <button type="button" onClick={onCancel}>
          {strings.cancel}
        </button>
        <button
          type="button"
          className="button--primary"
          disabled={confirmDisabled}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
export function EmptyState({ message = strings.empty }: { message?: string }) {
  return (
    <div className="empty-state" role="status">
      {message}
    </div>
  );
}
export function SegmentedControl({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly string[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="segmented-control" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          type="button"
          key={option}
          className={option === value ? 'is-selected' : ''}
          aria-pressed={option === value}
          onClick={() => {
            onChange(option);
          }}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
export interface DataColumn<Row> {
  key: keyof Row & string;
  label: string;
  /** Custom cell content; defaults to `String(row[key])`. Used for badges, links, lists, ... */
  render?: (row: Row) => ReactNode;
}
export interface DataTableSort {
  key: string;
  dir: 'asc' | 'desc';
}
function cellContent<Row>(row: Row, column: DataColumn<Row>): ReactNode {
  return column.render ? column.render(row) : String(row[column.key]);
}
/**
 * Enter/Space activate a clickable row the same way a click does (keyboard-operable, FR-GLB).
 * `role: 'button'` is only for a plain `<article>` card: on a `<tr>` it would override the row's
 * implicit table semantics (and disconnect its `<td>`s from the table) for no benefit, since the
 * click/keydown handlers work regardless of the announced role.
 */
function rowActivation<Row>(
  row: Row,
  onRowClick: (row: Row) => void,
  options: { role?: 'button' } = {},
) {
  return {
    tabIndex: 0,
    ...(options.role === undefined ? {} : { role: options.role }),
    onClick: () => {
      onRowClick(row);
    },
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      onRowClick(row);
    },
  };
}
export function DataTable<Row extends { id: string }>({
  columns,
  rows,
  sort,
  onSort,
  onRowClick,
  renderCard,
}: {
  columns: readonly DataColumn<Row>[];
  rows: readonly Row[];
  /** Current sort, for the arrow indicator on the active column header. */
  sort?: DataTableSort | undefined;
  /** Present only on columns that can be sorted; clicking the header calls this with its key. */
  onSort?: ((key: string) => void) | undefined;
  onRowClick?: ((row: Row) => void) | undefined;
  /** Overrides the phone card's default label/value list with a custom layout for one row. */
  renderCard?: ((row: Row) => ReactNode) | undefined;
}) {
  return (
    <>
      <div className="data-table">
        <table>
          <thead>
            <tr>
              {columns.map((column) => {
                const active = sort?.key === column.key;
                return (
                  <th
                    key={column.key}
                    scope="col"
                    aria-sort={
                      active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined
                    }
                  >
                    {onSort ? (
                      <button
                        type="button"
                        className="th-sort"
                        onClick={() => {
                          onSort(column.key);
                        }}
                      >
                        {column.label}
                        <span aria-hidden="true">
                          {active ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                        </span>
                      </button>
                    ) : (
                      column.label
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} {...(onRowClick ? rowActivation(row, onRowClick) : {})}>
                {columns.map((column) => (
                  <td key={column.key}>{cellContent(row, column)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <CardList columns={columns} rows={rows} onRowClick={onRowClick} renderCard={renderCard} />
    </>
  );
}
export function CardList<Row extends { id: string }>({
  columns,
  rows,
  onRowClick,
  renderCard,
}: {
  columns: readonly DataColumn<Row>[];
  rows: readonly Row[];
  onRowClick?: ((row: Row) => void) | undefined;
  renderCard?: ((row: Row) => ReactNode) | undefined;
}) {
  return (
    <div className="card-list">
      {rows.map((row) => (
        <article
          className="data-card"
          key={row.id}
          {...(onRowClick ? rowActivation(row, onRowClick, { role: 'button' }) : {})}
        >
          {renderCard ? (
            renderCard(row)
          ) : (
            <>
              {columns.map((column) => (
                <p key={column.key}>
                  <strong>{column.label}</strong>
                  <span>{cellContent(row, column)}</span>
                </p>
              ))}
            </>
          )}
        </article>
      ))}
    </div>
  );
}
export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="skeleton" aria-label={strings.loading}>
      {Array.from({ length: lines }, (_, index) => (
        <span key={index} />
      ))}
    </div>
  );
}
