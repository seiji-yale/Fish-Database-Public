/** A one-field dialog (rename a user, rename a list entry): title, a text field, Cancel / Save. */
import { useState } from 'react';
import { strings } from '../../strings';
import { TextField } from '../formFields';
import { Modal } from '../Modal';

export function PromptDialog({
  title,
  label,
  initial,
  error,
  secret = false,
  submitLabel = strings.save,
  onSubmit,
  onCancel,
}: {
  title: string;
  label: string;
  initial: string;
  error?: string | undefined;
  /** A password: typed characters are hidden. */
  secret?: boolean;
  submitLabel?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <Modal title={title} titleId="prompt-title" onClose={onCancel} initialFocus="#prompt-value">
      <form
        noValidate
        className="activity-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(value);
        }}
      >
        <TextField
          id="prompt-value"
          label={label}
          value={value}
          error={error}
          {...(secret ? { type: 'password' as const, autoComplete: 'new-password' } : {})}
          onChange={setValue}
        />
        <div className="dialog__actions">
          <button type="button" onClick={onCancel}>
            {strings.cancel}
          </button>
          <button type="submit" className="button--primary">
            {submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
