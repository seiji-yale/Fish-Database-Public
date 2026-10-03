/**
 * The Edit dialog on the Line Detail summary card (T-012, FR-LINE-02): name, gene, DOB (with a
 * warning), phenotype chips, notes, More attributes and an optional reason. Validation is the
 * shared `domain/lineEdit.ts`; the API repeats it. A save carries the version the page was loaded
 * with (BR-12): if someone else saved first, the dialog shows the API's message and a Reload button
 * instead of overwriting.
 */
import { useEffect, useState } from 'react';
import { labToday } from '../../../domain/dates';
import { validateLineEdit } from '../../../domain/lineEdit';
import { HttpError } from '../api';
import type { LineDetailDocument } from '../lineDetailApi';
import { patchLine, type EditResult } from '../lineEditApi';
import {
  buildEditPayload,
  editFieldDomId,
  editFormFrom,
  editIsDirty,
  type LineEditFormState,
} from '../lineEditForm';
import { getEnumeration } from '../newLineApi';
import { strings } from '../strings';
import { AttributeRows } from './AttributeRows';
import { ChipInput, DateField, TextField } from './formFields';
import { Modal } from './Modal';
import { ConfirmDialog } from './shared';

function scoped(errors: Record<string, string>, prefix: string): Record<string, string> {
  return Object.fromEntries(
    Object.entries(errors)
      .filter(([key]) => key.startsWith(`${prefix}.`))
      .map(([key, message]) => [key.slice(prefix.length + 1), message]),
  );
}

export function EditLineDialog({
  line,
  onClose,
  onSaved,
}: {
  line: LineDetailDocument;
  onClose: () => void;
  onSaved: (result: EditResult) => void;
}) {
  const [original] = useState(() => editFormFrom(line));
  const [form, setForm] = useState<LineEditFormState>(original);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<{ message: string; reload: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [attributeKeys, setAttributeKeys] = useState<string[]>([]);
  const dirty = editIsDirty(form, original);

  useEffect(() => {
    void getEnumeration('attribute_key')
      .then((result) => {
        setAttributeKeys(result.values);
      })
      .catch(() => undefined);
  }, []);

  function update(change: Partial<LineEditFormState>) {
    setForm((current) => ({ ...current, ...change }));
  }

  function showErrors(all: Record<string, string>) {
    setErrors(all);
    setBanner(all['form'] === undefined ? null : { message: all['form'], reload: false });
    window.setTimeout(() => {
      const first = Object.keys(all).find((key) => key !== 'form');
      const element = first === undefined ? null : document.getElementById(editFieldDomId(first));
      element?.focus();
    }, 0);
  }

  function requestClose() {
    if (dirty) setConfirmDiscard(true);
    else onClose();
  }

  async function save() {
    setBanner(null);
    const payload = buildEditPayload(form, original, line.version);
    const local = validateLineEdit(payload, labToday());
    if (!local.ok) {
      showErrors(local.errors);
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const result = await patchLine(line.id, payload);
      onSaved(result);
    } catch (cause: unknown) {
      if (!(cause instanceof HttpError) || cause.body === null) {
        setBanner({ message: strings.editSaveFailed, reload: false });
        return;
      }
      const { code, message, details } = cause.body;
      if (code === 'VERSION_CONFLICT') setBanner({ message, reload: true });
      else if (code === 'NAME_TAKEN') showErrors({ name: message });
      else if (code === 'INVALID_INPUT' && details?.['fields'] !== undefined)
        showErrors(details['fields'] as Record<string, string>);
      else setBanner({ message, reload: false });
    } finally {
      setSaving(false);
    }
  }

  const problemCount = Object.keys(errors).filter((key) => key !== 'form').length;

  return (
    <>
      <Modal
        title={strings.editTitle(line.name)}
        titleId="edit-line-title"
        onClose={requestClose}
        initialFocus="#el-name"
        wide
      >
        <form
          noValidate
          className="edit-line-form"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          {banner === null ? null : (
            <div className="form-error-summary" role="alert">
              <p>{banner.message}</p>
              {banner.reload ? (
                <button
                  type="button"
                  onClick={() => {
                    window.location.reload();
                  }}
                >
                  {strings.reload}
                </button>
              ) : null}
            </div>
          )}
          {problemCount > 0 ? (
            <div className="form-error-summary" role="alert">
              <p>{strings.formErrorSummary(problemCount)}</p>
            </div>
          ) : null}
          <TextField
            id="el-name"
            label={strings.fieldLineName}
            required
            maxLength={120}
            value={form.name}
            error={errors['name']}
            onChange={(name) => {
              update({ name });
            }}
          />
          <TextField
            id="el-gene"
            label={strings.fieldGene}
            value={form.gene}
            error={errors['gene']}
            onChange={(gene) => {
              update({ gene });
            }}
          />
          <DateField
            id="el-dob"
            label={strings.fieldDob}
            max={labToday()}
            value={form.dob}
            error={errors['dob']}
            warning={form.dob !== original.dob ? strings.dobChangeWarning : undefined}
            onChange={(dob) => {
              update({ dob });
            }}
          />
          <ChipInput
            id="el-phenotypes"
            label={strings.fieldPhenotypes}
            hint={strings.phenotypeHint}
            values={form.phenotypes}
            onChange={(phenotypes) => {
              update({ phenotypes });
            }}
          />
          <TextField
            id="el-notes"
            label={strings.fieldNotes}
            multiline
            value={form.notes}
            error={errors['notes']}
            onChange={(notes) => {
              update({ notes });
            }}
          />
          <h3>{strings.moreAttributes}</h3>
          <AttributeRows
            idPrefix="el-attr"
            rows={form.attributes}
            suggestions={attributeKeys}
            errors={scoped(errors, 'attributes')}
            onChange={(attributes) => {
              update({ attributes });
            }}
          />
          <TextField
            id="el-note"
            label={strings.editReason}
            hint={strings.editReasonHint}
            value={form.reason}
            error={errors['note']}
            onChange={(reason) => {
              update({ reason });
            }}
          />
          <div className="dialog__actions">
            <button type="button" onClick={requestClose}>
              {strings.cancel}
            </button>
            <button type="submit" className="button--primary" disabled={saving}>
              {saving ? strings.formSaving : strings.save}
            </button>
          </div>
        </form>
      </Modal>
      {confirmDiscard ? (
        <ConfirmDialog
          title={strings.editDiscardTitle}
          onCancel={() => {
            setConfirmDiscard(false);
          }}
          onConfirm={onClose}
        >
          {strings.editDiscardBody}
        </ConfirmDialog>
      ) : null}
    </>
  );
}
