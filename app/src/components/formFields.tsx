/**
 * Form building blocks shared by the New Line page (T-011) and the protocol forms (reused by
 * T-012/T-014): every input has a visible label, a `*` for required fields, and an inline error
 * that is tied to the input with `aria-describedby` and never relies on color alone (the message
 * text is always shown, and the input gets `aria-invalid`).
 */
import { type KeyboardEvent, type ReactNode, useId, useState } from 'react';
import { labToday } from '../../../domain/dates';
import { strings } from '../strings';

interface BaseFieldProps {
  label: string;
  required?: boolean | undefined;
  hint?: string | undefined;
  error?: string | undefined;
  /** A problem that does not block saving (FR-ID-08): shown as text with a "Warning:" prefix. */
  warning?: string | undefined;
  /** The DOM id; also the target of the error summary's "go to" link. */
  id?: string;
}

function describedBy(
  id: string,
  hint: string | undefined,
  error: string | undefined,
  warning?: string,
) {
  const ids = [
    hint === undefined ? null : `${id}-hint`,
    error === undefined ? null : `${id}-error`,
    warning === undefined ? null : `${id}-warning`,
  ];
  const joined = ids.filter((entry) => entry !== null).join(' ');
  return joined === '' ? undefined : joined;
}

export function FieldShell({
  id,
  label,
  required,
  hint,
  error,
  warning,
  children,
}: BaseFieldProps & { id: string; children: ReactNode }) {
  return (
    <div className={`form-field${error === undefined ? '' : ' form-field--error'}`}>
      {/* The `*` is drawn by CSS (`.is-required::after`), so it is not part of the accessible name;
          the input carries `aria-required` for assistive technology. */}
      <label htmlFor={id} className={required === true ? 'is-required' : undefined}>
        {label}
      </label>
      {hint === undefined ? null : (
        <p className="form-field__hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      {children}
      {error === undefined ? null : (
        <p className="form-field__error" id={`${id}-error`}>
          {error}
        </p>
      )}
      {warning === undefined ? null : (
        <p className="form-field__warning" id={`${id}-warning`}>
          {`${strings.warningPrefix} ${warning}`}
        </p>
      )}
    </div>
  );
}

export function TextField({
  label,
  required,
  hint,
  error,
  warning,
  id,
  value,
  onChange,
  onBlur,
  multiline = false,
  type = 'text',
  inputMode,
  maxLength,
  list,
  autoComplete = 'off',
}: BaseFieldProps & {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  multiline?: boolean;
  type?: 'text' | 'url' | 'number' | 'password';
  inputMode?: 'numeric' | 'decimal' | 'text';
  maxLength?: number;
  list?: string;
  autoComplete?: string;
}) {
  const generated = useId();
  const fieldId = id ?? generated;
  const shared = {
    id: fieldId,
    value,
    required: false,
    'aria-required': required === true ? true : undefined,
    'aria-invalid': error === undefined ? undefined : true,
    'aria-describedby': describedBy(fieldId, hint, error, warning),
    onBlur,
    maxLength,
    autoComplete,
  };
  return (
    <FieldShell
      id={fieldId}
      label={label}
      required={required}
      hint={hint}
      error={error}
      warning={warning}
    >
      {multiline ? (
        <textarea
          {...shared}
          rows={3}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
      ) : (
        <input
          {...shared}
          type={type}
          inputMode={inputMode}
          list={list}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
      )}
    </FieldShell>
  );
}

export function SelectField({
  label,
  required,
  hint,
  error,
  id,
  value,
  onChange,
  options,
  emptyLabel,
}: BaseFieldProps & {
  value: string;
  onChange: (value: string) => void;
  options: readonly string[];
  emptyLabel?: string;
}) {
  const generated = useId();
  const fieldId = id ?? generated;
  return (
    <FieldShell id={fieldId} label={label} required={required} hint={hint} error={error}>
      <select
        id={fieldId}
        value={value}
        aria-required={required === true ? true : undefined}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={describedBy(fieldId, hint, error)}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      >
        {emptyLabel === undefined ? null : <option value="">{emptyLabel}</option>}
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}

/** A date input (`YYYY-MM-DD`) with a "Today" shortcut that fills the lab's calendar date. */
export function DateField({
  label,
  required,
  hint,
  error,
  warning,
  id,
  value,
  onChange,
  max,
}: BaseFieldProps & { value: string; onChange: (value: string) => void; max?: string }) {
  const generated = useId();
  const fieldId = id ?? generated;
  return (
    <FieldShell
      id={fieldId}
      label={label}
      required={required}
      hint={hint}
      error={error}
      warning={warning}
    >
      <div className="date-field">
        <input
          id={fieldId}
          type="date"
          value={value}
          max={max}
          aria-required={required === true ? true : undefined}
          aria-invalid={error === undefined ? undefined : true}
          aria-describedby={describedBy(fieldId, hint, error, warning)}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
        <button
          type="button"
          onClick={() => {
            onChange(labToday());
          }}
        >
          {strings.dobToday}
        </button>
      </div>
    </FieldShell>
  );
}

/**
 * The phenotype chip input: type and press Enter (or the Add button) to add a chip; Backspace in the
 * empty box removes the last chip; every chip has its own Remove button. Enter never submits the form.
 */
export function ChipInput({
  label,
  hint,
  id,
  values,
  onChange,
}: {
  label: string;
  hint: string;
  id: string;
  values: readonly string[];
  onChange: (values: string[]) => void;
}) {
  const [draft, setDraft] = useState('');

  function add() {
    const text = draft.trim();
    if (text === '') return;
    if (!values.some((value) => value.toLowerCase() === text.toLowerCase()))
      onChange([...values, text]);
    setDraft('');
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      add();
    } else if (event.key === 'Backspace' && draft === '' && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  }

  return (
    <FieldShell id={id} label={label} hint={hint}>
      {values.length === 0 ? null : (
        <ul className="chip-row chip-row--editable" aria-label={strings.phenotypeList}>
          {values.map((value) => (
            <li className="chip" key={value}>
              <span>{value}</span>
              <button
                type="button"
                className="chip__remove"
                aria-label={strings.phenotypeRemove(value)}
                onClick={() => {
                  onChange(values.filter((entry) => entry !== value));
                }}
              >
                {strings.dismissIcon}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="chip-input">
        <input
          id={id}
          type="text"
          value={draft}
          aria-describedby={`${id}-hint`}
          autoComplete="off"
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          onKeyDown={onKeyDown}
          onBlur={add}
        />
        <button type="button" onClick={add}>
          {strings.phenotypeAdd}
        </button>
      </div>
    </FieldShell>
  );
}

/** Radio "cards": one visible choice per option, real radio inputs underneath (arrow keys work). */
export function RadioCards<T extends string>({
  legend,
  name,
  value,
  options,
  onChange,
}: {
  legend: string;
  name: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="radio-cards">
      <legend>{legend}</legend>
      <div className="radio-cards__grid">
        {options.map((option) => (
          <label
            key={option.value}
            className={`radio-card${option.value === value ? ' is-selected' : ''}`}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={option.value === value}
              onChange={() => {
                onChange(option.value);
              }}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** A form section: heading always shown; on a phone the body can be collapsed with a toggle. */
export function FormSection({
  id,
  title,
  step,
  children,
}: {
  id: string;
  title: string;
  step: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <section id={id} className={`form-section${open ? '' : ' form-section--collapsed'}`}>
      <h2>
        <span className="form-section__step" aria-hidden="true">
          {step}
        </span>
        {title}
        <button
          type="button"
          className="form-section__toggle"
          aria-expanded={open}
          aria-controls={`${id}-body`}
          aria-label={strings.sectionToggle(title, open)}
          onClick={() => {
            setOpen(!open);
          }}
        >
          {strings.dropdownIcon}
        </button>
      </h2>
      <div className="form-section__body" id={`${id}-body`}>
        {children}
      </div>
    </section>
  );
}
