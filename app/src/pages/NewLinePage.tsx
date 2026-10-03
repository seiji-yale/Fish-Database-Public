/**
 * `/lines/new` (T-011, FR-NEW-01…04, docs/04-ui-spec.md §6): one responsive form in five sections
 * (Identity, Generation, ID Method, Cryopreservation, References) with a sticky Cancel / Save /
 * Save and add another footer. Validation is the shared domain schema (`domain/newLine.ts`), run
 * here before sending so messages appear inline at once, and again by the API, whose field errors
 * are shown the same way.
 */
import { useEffect, useRef, useState } from 'react';
import { labToday } from '../../../domain/dates';
import {
  NEW_LINE_PROTOCOL_TYPES,
  PROTOCOL_TYPE_LABELS,
  newLineMessages,
  validateNewLine,
  type NewLineProtocolType,
} from '../../../domain/newLine';
import { HttpError } from '../api';
import { AttributeRows } from '../components/AttributeRows';
import {
  DateField,
  ChipInput,
  FormSection,
  RadioCards,
  SelectField,
  TextField,
} from '../components/formFields';
import { ProtocolForm } from '../components/ProtocolForm';
import { ConfirmDialog, Toast } from '../components/shared';
import { setFlash } from '../flash';
import { checkLineName, createLine, getEnumeration } from '../newLineApi';
import {
  buildNewLinePayload,
  fieldDomId,
  initialFormState,
  isDirty,
  newProtocolDraft,
  nextEntryState,
  type CryoDraft,
  type NewLineFormState,
} from '../newLineForm';
import { protocolDefaults } from '../protocolDefaults';
import { strings } from '../strings';

const TYPE_OPTIONS = NEW_LINE_PROTOCOL_TYPES.map((type) => ({
  value: type,
  label: PROTOCOL_TYPE_LABELS[type],
}));

const STATUS_OPTIONS = [
  { value: 'Current', label: strings.current },
  { value: 'Breeding', label: strings.breeding },
] as const;

const CRYO_OPTIONS = [
  { value: 'none', label: strings.cryoNotCryopreserved },
  { value: 'add', label: strings.cryoAddFirst },
] as const;

/** Errors whose key starts with `prefix.`, with the prefix removed. */
function scoped(errors: Record<string, string>, prefix: string): Record<string, string> {
  return Object.fromEntries(
    Object.entries(errors)
      .filter(([key]) => key.startsWith(`${prefix}.`))
      .map(([key, message]) => [key.slice(prefix.length + 1), message]),
  );
}

type NameStatus =
  | { state: 'idle' | 'checking' | 'available' }
  | {
      state: 'taken';
      existing: { id: string; name: string };
    };

export function NewLinePage() {
  const [form, setForm] = useState<NewLineFormState>(initialFormState);
  const [baseline, setBaseline] = useState<NewLineFormState>(form);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [nameStatus, setNameStatus] = useState<NameStatus>({ state: 'idle' });
  const [suggestions, setSuggestions] = useState<{
    attributeKeys: string[];
    fluorophores: string[];
    cryoPlaces: string[];
  }>({ attributeKeys: [], fluorophores: [], cryoPlaces: [] });
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<{ id: string; name: string } | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const leaving = useRef(false);
  const nameChecked = useRef('');

  const dirty = isDirty(form, baseline);

  useEffect(() => {
    void Promise.all([
      getEnumeration('attribute_key'),
      getEnumeration('fluorophore'),
      getEnumeration('cryo_place'),
    ])
      .then(([attributeKeys, fluorophores, cryoPlaces]) => {
        setSuggestions({
          attributeKeys: attributeKeys.values,
          fluorophores: fluorophores.values,
          cryoPlaces: cryoPlaces.values,
        });
      })
      .catch(() => undefined);
  }, []);

  // Full page loads are this app's navigation, so `beforeunload` is the unsaved-changes guard for
  // links, reload and closing the tab; Cancel has its own confirmation below.
  useEffect(() => {
    if (!dirty) return;
    function warn(event: BeforeUnloadEvent) {
      if (leaving.current) return;
      event.preventDefault();
    }
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
    };
  }, [dirty]);

  function update(change: Partial<NewLineFormState>) {
    setForm((current) => ({ ...current, ...change }));
  }

  function updateProtocol(index: number, protocol: NewLineFormState['protocols'][number]) {
    setForm((current) => ({
      ...current,
      protocols: current.protocols.map((entry, position) =>
        position === index ? protocol : entry,
      ),
    }));
  }

  function updateCryo(change: Partial<CryoDraft>) {
    setForm((current) => ({ ...current, cryo: { ...current.cryo, ...change } }));
  }

  async function verifyName() {
    const name = form.name.trim();
    if (name === '' || name === nameChecked.current) return;
    nameChecked.current = name;
    setNameStatus({ state: 'checking' });
    try {
      const result = await checkLineName(name);
      if (nameChecked.current !== name) return;
      setNameStatus(
        result.available || result.existing === undefined
          ? { state: 'available' }
          : { state: 'taken', existing: result.existing },
      );
    } catch {
      if (nameChecked.current === name) setNameStatus({ state: 'idle' });
    }
  }

  function focusFirstError(all: Record<string, string>) {
    const first = Object.keys(all).find((key) => key !== 'form');
    if (first === undefined) return;
    const element = document.getElementById(fieldDomId(first));
    if (element !== null) {
      element.scrollIntoView({ block: 'center' });
      element.focus();
    }
  }

  function showErrors(all: Record<string, string>) {
    setErrors(all);
    setFormError(all['form'] ?? null);
    // Wait for the inputs to re-render with aria-invalid before moving focus.
    window.setTimeout(() => {
      focusFirstError(all);
    }, 0);
  }

  async function save(again: boolean) {
    setFormError(null);
    setCreated(null);
    const payload = buildNewLinePayload(form);
    const local = validateNewLine(payload, labToday(), protocolDefaults());
    if (!local.ok) {
      showErrors(local.errors);
      return;
    }
    if (
      nameStatus.state === 'taken' &&
      nameStatus.existing.name.toLowerCase() === form.name.trim().toLowerCase()
    ) {
      showErrors({ name: newLineMessages.nameTaken(nameStatus.existing.name) });
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const result = await createLine(payload);
      if (again) {
        const next = nextEntryState(form);
        setForm(next);
        setBaseline(next);
        setNameStatus({ state: 'idle' });
        nameChecked.current = '';
        setCreated({ id: result.id, name: result.name });
        window.scrollTo({ top: 0 });
        document.getElementById('nl-name')?.focus();
      } else {
        leaving.current = true;
        setFlash(strings.lineCreatedFlash(result.name));
        window.location.assign(`/lines/${encodeURIComponent(result.id)}`);
      }
    } catch (cause: unknown) {
      if (!(cause instanceof HttpError) || cause.body === null) {
        setFormError(strings.formSaveFailed);
        return;
      }
      const { code, message, details } = cause.body;
      if (code === 'NAME_TAKEN') {
        const existing = details as { existingId?: string; existingName?: string } | undefined;
        if (existing?.existingId !== undefined && existing.existingName !== undefined)
          setNameStatus({
            state: 'taken',
            existing: { id: existing.existingId, name: existing.existingName },
          });
        showErrors({ name: message });
      } else if (code === 'INVALID_INPUT' && details?.['fields'] !== undefined) {
        showErrors(details['fields'] as Record<string, string>);
      } else {
        setFormError(message);
      }
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    if (dirty) setConfirmLeave(true);
    else window.location.assign('/lines');
  }

  const nameError =
    errors['name'] ??
    (nameStatus.state === 'taken'
      ? newLineMessages.nameTaken(nameStatus.existing.name)
      : undefined);
  const problemCount = Object.keys(errors).filter((key) => key !== 'form').length;

  return (
    <section className="new-line-page">
      <h1>{strings.newLineTitle}</h1>
      <nav className="form-progress" aria-label={strings.newLineProgress}>
        {[
          ['identity', strings.sectionIdentity],
          ['generation', strings.sectionGeneration],
          ['id-method', strings.sectionIdMethod],
          ['cryo', strings.sectionCryopreservation],
          ['references', strings.sectionReferences],
        ].map(([id, label], index) => (
          <a key={id} href={`#${String(id)}`}>{`${String(index + 1)} ${String(label)}`}</a>
        ))}
      </nav>
      {created === null ? null : (
        <div className="toast-region">
          <Toast
            message={strings.lineCreated(created.name)}
            onClose={() => {
              setCreated(null);
            }}
          />
          <a href={`/lines/${encodeURIComponent(created.id)}`}>{strings.lineCreatedOpen}</a>
        </div>
      )}
      {problemCount > 0 || formError !== null ? (
        <div className="form-error-summary" role="alert">
          <p>{formError ?? strings.formErrorSummary(problemCount)}</p>
          {problemCount > 0 ? (
            <button
              type="button"
              onClick={() => {
                focusFirstError(errors);
              }}
            >
              {strings.formErrorGo}
            </button>
          ) : null}
        </div>
      ) : null}
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save(false);
        }}
      >
        <p className="form-field__hint">{strings.requiredNote}</p>

        <FormSection id="identity" title={strings.sectionIdentity} step={1}>
          <TextField
            id="nl-name"
            label={strings.fieldLineName}
            required
            maxLength={120}
            value={form.name}
            error={nameError}
            hint={nameStatus.state === 'checking' ? strings.nameChecking : undefined}
            onChange={(name) => {
              update({ name });
              if (name.trim() !== nameChecked.current) setNameStatus({ state: 'idle' });
            }}
            onBlur={() => {
              void verifyName();
            }}
          />
          {nameStatus.state === 'taken' ? (
            <a href={`/lines/${encodeURIComponent(nameStatus.existing.id)}`}>
              {strings.nameOpenExisting}
            </a>
          ) : null}
          <TextField
            id="nl-gene"
            label={strings.fieldGene}
            value={form.gene}
            error={errors['gene']}
            onChange={(gene) => {
              update({ gene });
            }}
          />
          <ChipInput
            id="nl-phenotypes"
            label={strings.fieldPhenotypes}
            hint={strings.phenotypeHint}
            values={form.phenotypes}
            onChange={(phenotypes) => {
              update({ phenotypes });
            }}
          />
          <TextField
            id="nl-notes"
            label={strings.fieldNotes}
            multiline
            value={form.notes}
            error={errors['notes']}
            onChange={(notes) => {
              update({ notes });
            }}
          />
          <h3>{strings.moreAttributes}</h3>
          <p className="form-field__hint">{strings.attributesHint}</p>
          <AttributeRows
            idPrefix="nl-attr"
            rows={form.attributes}
            suggestions={suggestions.attributeKeys}
            errors={scoped(errors, 'attributes')}
            onChange={(attributes) => {
              update({ attributes });
            }}
          />
        </FormSection>

        <FormSection id="generation" title={strings.sectionGeneration} step={2}>
          <DateField
            id="nl-dob"
            label={strings.fieldDob}
            required
            max={labToday()}
            value={form.dob}
            error={errors['dob']}
            onChange={(dob) => {
              update({ dob });
            }}
          />
          <RadioCards
            legend={strings.fieldStatus}
            name="nl-status"
            value={form.status}
            options={STATUS_OPTIONS}
            onChange={(status) => {
              update({ status });
            }}
          />
          <TextField
            id="nl-idedNumber"
            label={strings.fieldIdedNumber}
            inputMode="numeric"
            value={form.idedNumber}
            error={errors['idedNumber']}
            onChange={(idedNumber) => {
              update({ idedNumber });
            }}
          />
        </FormSection>

        <FormSection id="id-method" title={strings.sectionIdMethod} step={3}>
          {form.protocols.map((protocol, index) => (
            <div className="protocol-form" key={protocol.key}>
              <h3>{strings.protocolHeading(index + 1)}</h3>
              <RadioCards<NewLineProtocolType>
                legend={strings.idMethodType}
                name={`nl-p-${String(index)}-type`}
                value={protocol.type}
                options={TYPE_OPTIONS}
                onChange={(type) => {
                  updateProtocol(index, { ...protocol, type });
                }}
              />
              <TextField
                id={`nl-p-${String(index)}-label`}
                label={strings.protocolLabel}
                hint={strings.protocolLabelHint}
                value={protocol.label}
                error={errors[`protocols.${String(index)}.label`]}
                onChange={(label) => {
                  updateProtocol(index, { ...protocol, label });
                }}
              />
              <ProtocolForm
                draft={protocol}
                idPrefix={`nl-p-${String(index)}`}
                fluorophores={suggestions.fluorophores}
                errors={{
                  ...scoped(errors, `protocols.${String(index)}.fields`),
                  ...scoped(errors, `protocols.${String(index)}`),
                }}
                onChange={(next) => {
                  updateProtocol(index, next);
                }}
              />
              {index === 0 ? null : (
                <button
                  type="button"
                  onClick={() => {
                    update({
                      protocols: form.protocols.filter((_, position) => position !== index),
                    });
                  }}
                >
                  {strings.protocolRemove(index + 1)}
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() => {
              update({ protocols: [...form.protocols, newProtocolDraft('none')] });
            }}
          >
            {strings.protocolAdd}
          </button>
        </FormSection>

        <FormSection id="cryo" title={strings.sectionCryopreservation} step={4}>
          <RadioCards
            legend={strings.cryoChoice}
            name="nl-cryo-choice"
            value={form.cryoMode}
            options={CRYO_OPTIONS}
            onChange={(cryoMode) => {
              update({ cryoMode });
            }}
          />
          {errors['cryo'] === undefined ? null : (
            <p className="form-field__error" id="nl-cryo-choice-error">
              {errors['cryo']}
            </p>
          )}
          {form.cryoMode === 'none' ? null : (
            <div className="cryo-form">
              <div className="form-grid">
                <DateField
                  id="nl-cryo-cryoDate"
                  label={strings.cryoDateField}
                  max={labToday()}
                  value={form.cryo.cryoDate}
                  error={errors['cryo.cryoDate']}
                  onChange={(cryoDate) => {
                    updateCryo({ cryoDate });
                  }}
                />
                <SelectField
                  id="nl-cryo-place"
                  label={strings.cryoPlaceField}
                  value={form.cryo.place}
                  options={suggestions.cryoPlaces}
                  emptyLabel={strings.cryoPlaceChoose}
                  error={errors['cryo.place']}
                  onChange={(place) => {
                    updateCryo({ place });
                  }}
                />
                <TextField
                  id="nl-cryo-boxName"
                  label={strings.cryoBoxField}
                  value={form.cryo.boxName}
                  error={errors['cryo.boxName']}
                  onChange={(boxName) => {
                    updateCryo({ boxName });
                  }}
                />
                <TextField
                  id="nl-cryo-cryoIdStart"
                  label={strings.cryoIdStartField}
                  value={form.cryo.cryoIdStart}
                  error={errors['cryo.cryoIdStart']}
                  onChange={(cryoIdStart) => {
                    updateCryo({ cryoIdStart });
                  }}
                />
                <TextField
                  id="nl-cryo-cryoIdEnd"
                  label={strings.cryoIdEndField}
                  value={form.cryo.cryoIdEnd}
                  error={errors['cryo.cryoIdEnd']}
                  onChange={(cryoIdEnd) => {
                    updateCryo({ cryoIdEnd });
                  }}
                />
                <TextField
                  id="nl-cryo-count"
                  label={strings.cryoCountField}
                  hint={strings.cryoCountHint}
                  inputMode="numeric"
                  value={form.cryo.count}
                  error={errors['cryo.count']}
                  onChange={(count) => {
                    updateCryo({ count });
                  }}
                />
              </div>
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={form.cryo.detailsUnknown}
                  onChange={(event) => {
                    updateCryo({ detailsUnknown: event.target.checked });
                  }}
                />
                <span>{strings.cryoDetailsUnknownField}</span>
              </label>
              <TextField
                id="nl-cryo-notes"
                label={strings.cryoNotesField}
                multiline
                value={form.cryo.notes}
                error={errors['cryo.notes']}
                onChange={(notes) => {
                  updateCryo({ notes });
                }}
              />
            </div>
          )}
        </FormSection>

        <FormSection id="references" title={strings.sectionReferences} step={5}>
          <p className="form-field__hint">{strings.referencesHint}</p>
          <div className="repeat-rows">
            {form.references.map((reference, index) => (
              <div className="repeat-row" key={index}>
                <TextField
                  id={`nl-ref-${String(index)}-title`}
                  label={strings.referenceTitle}
                  value={reference.title}
                  error={errors[`references.${String(index)}.title`]}
                  onChange={(title) => {
                    update({
                      references: form.references.map((entry, position) =>
                        position === index ? { ...entry, title } : entry,
                      ),
                    });
                  }}
                />
                <TextField
                  id={`nl-ref-${String(index)}-url`}
                  label={strings.referenceUrl}
                  type="url"
                  value={reference.url}
                  error={errors[`references.${String(index)}.url`]}
                  onChange={(url) => {
                    update({
                      references: form.references.map((entry, position) =>
                        position === index ? { ...entry, url } : entry,
                      ),
                    });
                  }}
                />
                <button
                  type="button"
                  className="repeat-row__remove"
                  aria-label={strings.referenceRemove(index + 1)}
                  onClick={() => {
                    update({
                      references: form.references.filter((_, position) => position !== index),
                    });
                  }}
                >
                  {strings.dismissIcon}
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              update({ references: [...form.references, { title: '', url: '' }] });
            }}
          >
            {strings.referenceAdd}
          </button>
        </FormSection>

        <footer className="form-footer">
          <button type="button" onClick={cancel}>
            {strings.formCancel}
          </button>
          <button type="button" disabled={saving} onClick={() => void save(true)}>
            {strings.formSaveAnother}
          </button>
          <button type="submit" className="button--primary" disabled={saving}>
            {saving ? strings.formSaving : strings.formSave}
          </button>
        </footer>
      </form>
      {confirmLeave ? (
        <ConfirmDialog
          title={strings.unsavedTitle}
          onCancel={() => {
            setConfirmLeave(false);
          }}
          onConfirm={() => {
            leaving.current = true;
            window.location.assign('/lines');
          }}
        >
          {strings.unsavedBody}
        </ConfirmDialog>
      ) : null}
    </section>
  );
}
