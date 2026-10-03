/**
 * The ID protocol form (T-011 Step 2, FR-ID-03…07). One component per method so the field lists stay
 * readable — `ProtocolFormPcr`, `ProtocolFormPcrSequence`, `ProtocolFormFluorescence`,
 * `ProtocolFormSimple` (Tails and None: notes only) and `ProtocolFormCustom` — and `ProtocolForm`
 * picks the right one from the draft's type. T-014 (edit/add protocol later) reuses these unchanged:
 * they only read and write a `ProtocolDraft` and show the errors they are given, keyed by field name
 * (`primer_f_name`, `items.0.key`, ...).
 */
import { type ReactNode } from 'react';
import type { ProtocolDraft } from '../newLineForm';
import { strings } from '../strings';
import { SelectField, TextField } from './formFields';

export interface ProtocolFormProps {
  draft: ProtocolDraft;
  onChange: (draft: ProtocolDraft) => void;
  /** Field errors keyed by template field name (already stripped of the `protocols.N.fields.` prefix). */
  errors: Record<string, string>;
  /** Warnings that do not block saving, same keys. */
  warnings?: Record<string, string>;
  /** DOM id prefix, unique per protocol on the page. */
  idPrefix: string;
  fluorophores: readonly string[];
}

function fieldSetter(draft: ProtocolDraft, onChange: (draft: ProtocolDraft) => void) {
  return (name: string, value: string) => {
    onChange({ ...draft, fields: { ...draft.fields, [name]: value } });
  };
}

function Notes({ draft, onChange, idPrefix, errors }: ProtocolFormProps) {
  return (
    <TextField
      id={`${idPrefix}-notes`}
      label={strings.protocolNotes}
      multiline
      value={draft.notes}
      error={errors['notes']}
      onChange={(notes) => {
        onChange({ ...draft, notes });
      }}
    />
  );
}

function PcrFields(props: ProtocolFormProps): ReactNode {
  const { draft, errors, warnings = {}, idPrefix } = props;
  const set = fieldSetter(draft, props.onChange);
  const text = (name: string) => draft.fields[name] ?? '';
  return (
    <>
      <div className="form-grid">
        <TextField
          id={`${idPrefix}-primer_f_name`}
          label={strings.primerFName}
          value={text('primer_f_name')}
          error={errors['primer_f_name']}
          onChange={(value) => {
            set('primer_f_name', value);
          }}
        />
        <TextField
          id={`${idPrefix}-primer_f_seq`}
          label={strings.primerFSequence}
          value={text('primer_f_seq')}
          error={errors['primer_f_seq']}
          warning={warnings['primer_f_seq']}
          onChange={(value) => {
            set('primer_f_seq', value);
          }}
        />
        <TextField
          id={`${idPrefix}-primer_r_name`}
          label={strings.primerRName}
          value={text('primer_r_name')}
          error={errors['primer_r_name']}
          onChange={(value) => {
            set('primer_r_name', value);
          }}
        />
        <TextField
          id={`${idPrefix}-primer_r_seq`}
          label={strings.primerRSequence}
          value={text('primer_r_seq')}
          error={errors['primer_r_seq']}
          warning={warnings['primer_r_seq']}
          onChange={(value) => {
            set('primer_r_seq', value);
          }}
        />
        <TextField
          id={`${idPrefix}-annealing_c`}
          label={strings.annealingLabel}
          inputMode="decimal"
          value={text('annealing_c')}
          error={errors['annealing_c']}
          onChange={(value) => {
            set('annealing_c', value);
          }}
        />
        <TextField
          id={`${idPrefix}-cycles`}
          label={strings.cyclesFieldLabel}
          inputMode="numeric"
          value={text('cycles')}
          error={errors['cycles']}
          onChange={(value) => {
            set('cycles', value);
          }}
        />
        <TextField
          id={`${idPrefix}-expected_band`}
          label={strings.expectedBandLabel}
          value={text('expected_band')}
          error={errors['expected_band']}
          onChange={(value) => {
            set('expected_band', value);
          }}
        />
      </div>
    </>
  );
}

export function ProtocolFormPcr(props: ProtocolFormProps) {
  return (
    <>
      <PcrFields {...props} />
      <Notes {...props} />
    </>
  );
}

export function ProtocolFormPcrSequence(props: ProtocolFormProps) {
  const { draft, errors, warnings = {}, idPrefix } = props;
  const set = fieldSetter(draft, props.onChange);
  const text = (name: string) => draft.fields[name] ?? '';
  return (
    <>
      <PcrFields {...props} />
      <div className="form-grid">
        <TextField
          id={`${idPrefix}-seq_primer`}
          label={strings.sequencingPrimerField}
          value={text('seq_primer')}
          error={errors['seq_primer']}
          onChange={(value) => {
            set('seq_primer', value);
          }}
        />
        <TextField
          id={`${idPrefix}-guide_seq`}
          label={strings.guideSequenceField}
          value={text('guide_seq')}
          error={errors['guide_seq']}
          warning={warnings['guide_seq']}
          onChange={(value) => {
            set('guide_seq', value);
          }}
        />
        <TextField
          id={`${idPrefix}-expected_mutation`}
          label={strings.expectedMutationField}
          value={text('expected_mutation')}
          error={errors['expected_mutation']}
          onChange={(value) => {
            set('expected_mutation', value);
          }}
        />
      </div>
      <TextField
        id={`${idPrefix}-seq_result_urls`}
        label={strings.sequenceResultLinks}
        hint={strings.sequenceResultLinksHint}
        multiline
        value={text('seq_result_urls')}
        error={errors['seq_result_urls']}
        onChange={(value) => {
          set('seq_result_urls', value);
        }}
      />
      <Notes {...props} />
    </>
  );
}

export function ProtocolFormFluorescence(props: ProtocolFormProps) {
  const { draft, errors, idPrefix, fluorophores } = props;
  const set = fieldSetter(draft, props.onChange);
  const text = (name: string) => draft.fields[name] ?? '';
  return (
    <>
      <div className="form-grid">
        <SelectField
          id={`${idPrefix}-fluorophore`}
          label={strings.fluorophoreField}
          value={text('fluorophore')}
          options={fluorophores}
          emptyLabel={strings.fluorophoreChoose}
          error={errors['fluorophore']}
          onChange={(value) => {
            set('fluorophore', value);
          }}
        />
        <TextField
          id={`${idPrefix}-screening_day`}
          label={strings.screeningDayField}
          hint={strings.screeningDayHint}
          value={text('screening_day')}
          error={errors['screening_day']}
          onChange={(value) => {
            set('screening_day', value);
          }}
        />
      </div>
      <TextField
        id={`${idPrefix}-description`}
        label={strings.descriptionField}
        value={text('description')}
        error={errors['description']}
        onChange={(value) => {
          set('description', value);
        }}
      />
      <Notes {...props} />
    </>
  );
}

/** Tails and None: FR-ID-06, only notes. */
export function ProtocolFormSimple(props: ProtocolFormProps) {
  return (
    <>
      <p className="form-field__hint">{strings.protocolNoFields}</p>
      <Notes {...props} />
    </>
  );
}

export function ProtocolFormCustom(props: ProtocolFormProps) {
  const { draft, onChange, errors, idPrefix } = props;
  function setItem(index: number, change: Partial<{ key: string; value: string }>) {
    onChange({
      ...draft,
      items: draft.items.map((item, position) =>
        position === index ? { ...item, ...change } : item,
      ),
    });
  }
  return (
    <>
      <div className="repeat-rows">
        {draft.items.map((item, index) => (
          <div className="repeat-row" key={index}>
            <TextField
              id={`${idPrefix}-items-${String(index)}-key`}
              label={strings.customItemName}
              value={item.key}
              error={errors[`items.${String(index)}.key`]}
              onChange={(key) => {
                setItem(index, { key });
              }}
            />
            <TextField
              id={`${idPrefix}-items-${String(index)}-value`}
              label={strings.customItemValue}
              value={item.value}
              onChange={(value) => {
                setItem(index, { value });
              }}
            />
            <button
              type="button"
              className="repeat-row__remove"
              aria-label={strings.customItemRemove(index + 1)}
              onClick={() => {
                onChange({
                  ...draft,
                  items: draft.items.filter((_, position) => position !== index),
                });
              }}
            >
              {strings.dismissIcon}
            </button>
          </div>
        ))}
      </div>
      {errors['items'] === undefined ? null : (
        <p className="form-field__error">{errors['items']}</p>
      )}
      <button
        type="button"
        onClick={() => {
          onChange({ ...draft, items: [...draft.items, { key: '', value: '' }] });
        }}
      >
        {strings.customItemAdd}
      </button>
      <Notes {...props} />
    </>
  );
}

export function ProtocolForm(props: ProtocolFormProps) {
  switch (props.draft.type) {
    case 'pcr':
      return <ProtocolFormPcr {...props} />;
    case 'pcr_sequence':
      return <ProtocolFormPcrSequence {...props} />;
    case 'fluorescence':
      return <ProtocolFormFluorescence {...props} />;
    case 'custom':
      return <ProtocolFormCustom {...props} />;
    case 'none':
    case 'tails':
      return <ProtocolFormSimple {...props} />;
  }
}
