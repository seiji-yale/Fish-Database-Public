/** Row builders for tests: valid rows with sensible defaults; override what the test is about. */
import type {
  ActivityRow,
  AttachmentRow,
  ChatMessageRow,
  CryoRecordRow,
  GenotypingRecordRow,
  IdProtocolRow,
  LineAttributeRow,
  LinePhenotypeRow,
  LineReferenceRow,
  LineRow,
  LineVersionRow,
} from '../types';

/** Ids of the seeded users (0002_seed_users.sql). */
export const USER_ID = {
  admin: '01H00000000000000000000001',
  alice: '01H00000000000000000000002',
  bob: '01H00000000000000000000003',
  carol: '01H00000000000000000000004',
  dan: '01H00000000000000000000005',
  guest: '01H00000000000000000000006',
  erin: '01H00000000000000000000007',
} as const;

export const T0 = '2026-09-28T12:00:00Z';

export function makeLine(overrides: Partial<LineRow> = {}): LineRow {
  return {
    id: 'line-1',
    name: 'demo_c3',
    gene: null,
    status: 'Current',
    dob: '2025-09-15',
    generation_no: 1,
    ided_number: 0,
    last_id_date: null,
    breeding_started_at: null,
    closed_at: null,
    closed_reason: null,
    notes: null,
    current_protocol_id: null,
    legacy_no: null,
    legacy_check: null,
    version: 1,
    created_at: T0,
    created_by: USER_ID.bob,
    updated_at: T0,
    updated_by: USER_ID.bob,
    ...overrides,
  };
}

export function makePhenotype(overrides: Partial<LinePhenotypeRow> = {}): LinePhenotypeRow {
  return {
    id: 'pheno-1',
    line_id: 'line-1',
    description: 'Short Fins',
    sort_order: 0,
    deleted_at: null,
    ...overrides,
  };
}

export function makeAttribute(overrides: Partial<LineAttributeRow> = {}): LineAttributeRow {
  return {
    id: 'attr-1',
    line_id: 'line-1',
    key: 'Source',
    value: 'REPOSITORY A',
    sort_order: 0,
    deleted_at: null,
    ...overrides,
  };
}

export function makeProtocol(overrides: Partial<IdProtocolRow> = {}): IdProtocolRow {
  return {
    id: 'proto-1',
    line_id: 'line-1',
    protocol_type: 'pcr',
    label: 'PCR',
    fields: '{"annealing_c":60,"cycles":35}',
    notes: null,
    sort_order: 0,
    is_current: 0,
    deleted_at: null,
    created_at: T0,
    updated_at: T0,
    ...overrides,
  };
}

export function makeGenotypingRecord(
  overrides: Partial<GenotypingRecordRow> = {},
): GenotypingRecordRow {
  return {
    id: 'geno-1',
    line_id: 'line-1',
    generation_no: 1,
    record_date: '2026-01-08',
    protocol_id: null,
    positive_count: 6,
    screened_count: null,
    is_new_generation: 0,
    new_dob: null,
    notes: null,
    created_at: T0,
    created_by: USER_ID.bob,
    ...overrides,
  };
}

export function makeCryoRecord(overrides: Partial<CryoRecordRow> = {}): CryoRecordRow {
  return {
    id: 'cryo-1',
    line_id: 'line-1',
    cryo_date: '2026-03-09',
    place: 'Demo freezer shelf',
    box_name: 'Demo cryo box-Bob',
    cryo_id_start: 'C0548',
    cryo_id_end: 'C0551',
    count: 7,
    details_unknown: 0,
    notes: null,
    deleted_at: null,
    created_at: T0,
    created_by: USER_ID.bob,
    ...overrides,
  };
}

export function makeAttachment(overrides: Partial<AttachmentRow> = {}): AttachmentRow {
  return {
    id: 'att-1',
    owner_type: 'id_protocol',
    owner_id: 'proto-1',
    kind: 'gel_image',
    file_name: 'gel.png',
    mime_type: 'image/png',
    size_bytes: 1024,
    r2_key: 'lines/line-1/att-1-gel.png',
    thumb_r2_key: null,
    caption: null,
    is_latest: 1,
    deleted_at: null,
    created_at: T0,
    created_by: USER_ID.bob,
    ...overrides,
  };
}

export function makeReference(overrides: Partial<LineReferenceRow> = {}): LineReferenceRow {
  return {
    id: 'ref-1',
    line_id: 'line-1',
    title: 'Example primers.docx',
    url: null,
    attachment_id: null,
    note: null,
    sort_order: 0,
    deleted_at: null,
    created_at: T0,
    created_by: USER_ID.bob,
    ...overrides,
  };
}

export function makeVersion(overrides: Partial<LineVersionRow> = {}): LineVersionRow {
  return {
    id: 'ver-1',
    line_id: 'line-1',
    version_no: 1,
    snapshot: '{"name":"demo_c3"}',
    diff: null,
    change_type: 'imported',
    summary: 'Imported from Mastersheet Ver. 1.1',
    note: null,
    created_at: T0,
    created_by: USER_ID.bob,
    via_admin: 0,
    ...overrides,
  };
}

export function makeActivity(overrides: Partial<ActivityRow> = {}): ActivityRow {
  return {
    id: 'act-1',
    line_id: 'line-1',
    user_id: USER_ID.bob,
    via_admin: 0,
    type: 'imported',
    summary: 'Imported from Mastersheet Ver. 1.1',
    ref_type: null,
    ref_id: null,
    created_at: T0,
    ...overrides,
  };
}

export function makeChatMessage(overrides: Partial<ChatMessageRow> = {}): ChatMessageRow {
  return {
    id: 'msg-1',
    line_id: 'line-1',
    user_id: USER_ID.bob,
    via_admin: 0,
    body: 'Please set up an out-cross of demo_c3',
    request_type: null,
    request_status: null,
    request_done_by: null,
    request_done_at: null,
    edited_at: null,
    deleted_at: null,
    created_at: T0,
    ...overrides,
  };
}
