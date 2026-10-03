/**
 * "More attributes": repeatable key/value rows (OQ-20, FR-NEW-01). The name field suggests the
 * Admin-editable `attribute_key` list (e.g. Source) but accepts any name. T-012 reuses it in the edit form.
 */
import { strings } from '../strings';
import { TextField } from './formFields';

export interface AttributeDraft {
  key: string;
  value: string;
}

export function AttributeRows({
  idPrefix,
  rows,
  suggestions,
  errors,
  onChange,
}: {
  idPrefix: string;
  rows: readonly AttributeDraft[];
  suggestions: readonly string[];
  /** Errors keyed `N.key` / `N.value`. */
  errors: Record<string, string>;
  onChange: (rows: AttributeDraft[]) => void;
}) {
  const listId = `${idPrefix}-suggestions`;
  function update(index: number, change: Partial<AttributeDraft>) {
    onChange(rows.map((row, position) => (position === index ? { ...row, ...change } : row)));
  }
  return (
    <div className="repeat-rows">
      <datalist id={listId}>
        {suggestions.map((suggestion) => (
          <option key={suggestion} value={suggestion} />
        ))}
      </datalist>
      {rows.map((row, index) => (
        <div className="repeat-row" key={index}>
          <TextField
            id={`${idPrefix}-${String(index)}-key`}
            label={strings.attributeKey}
            list={listId}
            value={row.key}
            error={errors[`${String(index)}.key`]}
            onChange={(key) => {
              update(index, { key });
            }}
          />
          <TextField
            id={`${idPrefix}-${String(index)}-value`}
            label={strings.attributeValue}
            value={row.value}
            error={errors[`${String(index)}.value`]}
            onChange={(value) => {
              update(index, { value });
            }}
          />
          <button
            type="button"
            className="repeat-row__remove"
            aria-label={strings.attributeRemove(index + 1)}
            onClick={() => {
              onChange(rows.filter((_, position) => position !== index));
            }}
          >
            {strings.dismissIcon}
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => {
          onChange([...rows, { key: '', value: '' }]);
        }}
      >
        {strings.attributeAdd}
      </button>
    </div>
  );
}
