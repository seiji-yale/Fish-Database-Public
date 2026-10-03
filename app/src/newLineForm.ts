/**
 * The New Line form's state and its conversion to the API payload (T-011). The form keeps every
 * value as the text the person typed; `buildNewLinePayload` turns it into what
 * `domain/newLine.ts` validates (numbers as numbers, blank as absent). Validation itself is the
 * shared domain schema, so the form and the API can never disagree about a rule.
 */
import { defaultProtocolFields, protocolTemplates } from '../../domain/protocolTemplates';
import { protocolDefaults } from './protocolDefaults';
import type { NewLineProtocolType } from '../../domain/newLine';

export interface ProtocolDraft {
  /** Stable React key: rows can be removed, so the index is not one. */
  key: string;
  type: NewLineProtocolType;
  label: string;
  /** Text of each template field, by field name (`primer_f_name`, `annealing_c`, ...). */
  fields: Record<string, string>;
  /** Custom protocol rows. */
  items: { key: string; value: string }[];
  notes: string;
}

export interface CryoDraft {
  cryoDate: string;
  place: string;
  boxName: string;
  cryoIdStart: string;
  cryoIdEnd: string;
  count: string;
  detailsUnknown: boolean;
  notes: string;
}

export interface NewLineFormState {
  name: string;
  gene: string;
  notes: string;
  phenotypes: string[];
  attributes: { key: string; value: string }[];
  dob: string;
  status: 'Current' | 'Breeding';
  idedNumber: string;
  protocols: ProtocolDraft[];
  cryoMode: 'none' | 'add';
  cryo: CryoDraft;
  references: { title: string; url: string }[];
}

let draftCounter = 0;

/** A protocol draft with the BR-9 defaults (annealing 60 °C, cycles 35) already in its fields. */
export function newProtocolDraft(type: NewLineProtocolType = 'none'): ProtocolDraft {
  draftCounter += 1;
  const defaults = defaultProtocolFields('pcr', undefined, protocolDefaults());
  return {
    key: `protocol-${String(draftCounter)}`,
    type,
    label: '',
    fields: Object.fromEntries(
      Object.entries(defaults).map(([key, value]) => [key, String(value)]),
    ),
    items: [{ key: '', value: '' }],
    notes: '',
  };
}

export function emptyCryoDraft(): CryoDraft {
  return {
    cryoDate: '',
    place: '',
    boxName: '',
    cryoIdStart: '',
    cryoIdEnd: '',
    count: '',
    detailsUnknown: false,
    notes: '',
  };
}

export function initialFormState(): NewLineFormState {
  return {
    name: '',
    gene: '',
    notes: '',
    phenotypes: [],
    attributes: [],
    dob: '',
    status: 'Current',
    idedNumber: '0',
    protocols: [newProtocolDraft('none')],
    cryoMode: 'none',
    cryo: emptyCryoDraft(),
    references: [],
  };
}

/**
 * FR-NEW-04: after "Save and add another" the next entry starts with the same ID method type and
 * the same attribute names (values cleared); everything else is blank again.
 */
export function nextEntryState(previous: NewLineFormState): NewLineFormState {
  const next = initialFormState();
  const first = previous.protocols[0];
  return {
    ...next,
    protocols: [newProtocolDraft(first?.type ?? 'none')],
    attributes: previous.attributes
      .filter((attribute) => attribute.key.trim() !== '')
      .map((attribute) => ({ key: attribute.key, value: '' })),
  };
}

const NUMBER_FIELDS: ReadonlySet<string> = new Set(['annealing_c', 'cycles']);

/** Numbers are sent as numbers; text that is not a number is sent as typed so the API says "Enter a number." */
function fieldValue(name: string, text: string): unknown {
  if (NUMBER_FIELDS.has(name) && text.trim() !== '' && Number.isFinite(Number(text)))
    return Number(text);
  return text;
}

export function protocolPayload(draft: ProtocolDraft) {
  const template = protocolTemplates[draft.type];
  const allowed = Object.keys(template?.fields ?? {});
  const fields: Record<string, unknown> = {};
  for (const name of allowed) {
    if (name === 'items') fields.items = draft.items;
    else if (name === 'seq_result_urls')
      fields.seq_result_urls = (draft.fields[name] ?? '')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '');
    else if (name in draft.fields) fields[name] = fieldValue(name, draft.fields[name] ?? '');
  }
  return { type: draft.type, label: draft.label, fields, notes: draft.notes };
}

export function buildNewLinePayload(form: NewLineFormState): Record<string, unknown> {
  const idedNumber = form.idedNumber.trim();
  return {
    name: form.name,
    gene: form.gene,
    notes: form.notes,
    phenotypes: form.phenotypes,
    attributes: form.attributes,
    dob: form.dob,
    status: form.status,
    idedNumber:
      idedNumber === '' ? 0 : Number.isFinite(Number(idedNumber)) ? Number(idedNumber) : idedNumber,
    protocols: form.protocols.map(protocolPayload),
    cryo:
      form.cryoMode === 'none'
        ? null
        : {
            ...form.cryo,
            count:
              form.cryo.count.trim() === ''
                ? null
                : Number.isFinite(Number(form.cryo.count))
                  ? Number(form.cryo.count)
                  : form.cryo.count,
          },
    references: form.references,
  };
}

/** True once the person has typed or chosen anything: the unsaved-changes guard's test. */
export function isDirty(form: NewLineFormState, baseline: NewLineFormState): boolean {
  return JSON.stringify(withoutKeys(form)) !== JSON.stringify(withoutKeys(baseline));
}

function withoutKeys(form: NewLineFormState) {
  return { ...form, protocols: form.protocols.map((protocol) => ({ ...protocol, key: '' })) };
}

/** The fields the API's `details.fields` / the shared schema key by path -> the DOM id of the input. */
export function fieldDomId(path: string): string {
  const protocolField = /^protocols\.(\d+)\.fields\.(.+)$/.exec(path);
  if (protocolField !== null)
    return `nl-p-${String(protocolField[1])}-${String(protocolField[2]).replaceAll('.', '-')}`;
  const protocol = /^protocols\.(\d+)\.(.+)$/.exec(path);
  if (protocol !== null) return `nl-p-${String(protocol[1])}-${String(protocol[2])}`;
  const attribute = /^attributes\.(\d+)\.(.+)$/.exec(path);
  if (attribute !== null) return `nl-attr-${String(attribute[1])}-${String(attribute[2])}`;
  const reference = /^references\.(\d+)\.(.+)$/.exec(path);
  if (reference !== null) return `nl-ref-${String(reference[1])}-${String(reference[2])}`;
  if (path === 'cryo') return 'nl-cryo-choice';
  if (path.startsWith('cryo.')) return `nl-cryo-${path.slice('cryo.'.length)}`;
  return `nl-${path}`;
}

/** An existing protocol as an editable draft (T-014): numbers and link lists become the text the form shows. */
export function protocolDraftFrom(protocol: {
  protocolType: string;
  label: string;
  fields: Record<string, unknown>;
  notes: string | null;
}): ProtocolDraft {
  const text = (value: unknown): string =>
    Array.isArray(value)
      ? value.map(String).join('\n')
      : typeof value === 'string' || typeof value === 'number'
        ? String(value)
        : '';
  const rows = Array.isArray(protocol.fields['items'])
    ? (protocol.fields['items'] as unknown[]).map((entry) => {
        const row = (entry ?? {}) as Record<string, unknown>;
        return { key: text(row['key']), value: text(row['value']) };
      })
    : [];
  return {
    ...newProtocolDraft(protocol.protocolType as NewLineProtocolType),
    label: protocol.label,
    fields: Object.fromEntries(
      Object.entries(protocol.fields)
        .filter(([name]) => name !== 'items')
        .map(([name, value]) => [name, text(value)]),
    ),
    items: rows.length > 0 ? rows : [{ key: '', value: '' }],
    notes: protocol.notes ?? '',
  };
}
