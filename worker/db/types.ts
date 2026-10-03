/**
 * Row types, hand-written to match worker/db/migrations/*.sql column for column
 * (docs/03-data-model.md). TEXT -> string, INTEGER -> number, nullable -> `| null`.
 * Booleans are stored as INTEGER 0/1 and typed `number` so a row can be passed to SQL unchanged.
 * JSON columns (`fields`, `snapshot`, `diff`) are TEXT here; parsing and validation belong to the
 * domain layer.
 */

export type UserRole = 'admin' | 'member' | 'guest';

export interface UserRow {
  id: string;
  name: string;
  role: UserRole;
  is_active: number;
  is_builtin: number;
  created_at: string;
  updated_at: string;
  /** Accounts (ADR-0005, migration 0010). Never send these to the client. */
  password_hash: string | null;
  must_change_password: number;
  session_epoch: number;
  failed_logins: number;
  locked_until: string | null;
}

export interface InviteRow {
  id: string;
  user_id: string;
  token_hash: string;
  created_by: string | null;
  created_at: string;
  expires_at: string;
  used_at: string | null;
}

export interface SettingRow {
  key: string;
  value: string | null;
}

export type EnumerationKind =
  'id_method_type' | 'fluorophore' | 'cryo_place' | 'request_type' | 'attribute_key';

export interface EnumerationRow {
  id: string;
  kind: EnumerationKind;
  value: string;
  sort_order: number;
  is_active: number;
}

export type LineStatus = 'Current' | 'Breeding' | 'Closed';

export interface LineRow {
  id: string;
  name: string;
  gene: string | null;
  status: LineStatus;
  dob: string | null;
  generation_no: number;
  ided_number: number;
  last_id_date: string | null;
  breeding_started_at: string | null;
  closed_at: string | null;
  closed_reason: string | null;
  notes: string | null;
  current_protocol_id: string | null;
  legacy_no: number | null;
  legacy_check: number | null;
  version: number;
  created_at: string;
  created_by: string;
  updated_at: string;
  updated_by: string;
}

export interface LinePhenotypeRow {
  id: string;
  line_id: string;
  description: string;
  sort_order: number;
  deleted_at: string | null;
}

export interface LineAttributeRow {
  id: string;
  line_id: string;
  key: string;
  value: string | null;
  sort_order: number;
  deleted_at: string | null;
}

export type ProtocolType = 'none' | 'tails' | 'pcr' | 'pcr_sequence' | 'fluorescence' | 'custom';

export interface IdProtocolRow {
  id: string;
  line_id: string;
  protocol_type: ProtocolType;
  label: string;
  fields: string;
  notes: string | null;
  sort_order: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  /** 1 = one of the line's current ID methods (a line can have several); added by migration 0006. */
  is_current: number;
}

export interface GenotypingRecordRow {
  id: string;
  line_id: string;
  generation_no: number;
  record_date: string;
  protocol_id: string | null;
  positive_count: number;
  screened_count: number | null;
  is_new_generation: number;
  new_dob: string | null;
  notes: string | null;
  created_at: string;
  created_by: string;
}

export interface CryoRecordRow {
  id: string;
  line_id: string;
  cryo_date: string | null;
  place: string | null;
  box_name: string | null;
  cryo_id_start: string | null;
  cryo_id_end: string | null;
  count: number | null;
  details_unknown: number;
  notes: string | null;
  deleted_at: string | null;
  created_at: string;
  created_by: string;
}

/** A vial (or several, for records without IDs) taken out of a cryo record (migration 0009). */
export interface CryoVialUseRow {
  id: string;
  line_id: string;
  cryo_record_id: string;
  /** The used Cryo ID, e.g. `C0640`; NULL for a record without IDs. Never reused. */
  cryo_id: string | null;
  quantity: number;
  used_at: string;
  note: string | null;
  created_at: string;
  created_by: string;
  /** Set when the use was undone (T-028): the vial is back in its record; the row stays for good. */
  undone_at: string | null;
  undone_by: string | null;
}

export type AttachmentOwnerType =
  'id_protocol' | 'genotyping_record' | 'line_reference' | 'chat_message' | 'line';

export type AttachmentKind =
  'gel_image' | 'fluorescence_image' | 'sequence_result' | 'reference_file' | 'other';

export interface AttachmentRow {
  id: string;
  owner_type: AttachmentOwnerType;
  owner_id: string;
  kind: AttachmentKind;
  file_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  r2_key: string;
  thumb_r2_key: string | null;
  caption: string | null;
  is_latest: number;
  deleted_at: string | null;
  created_at: string;
  created_by: string;
}

export interface LineReferenceRow {
  id: string;
  line_id: string;
  title: string;
  url: string | null;
  attachment_id: string | null;
  note: string | null;
  sort_order: number;
  deleted_at: string | null;
  created_at: string;
  created_by: string;
}

export type VersionChangeType =
  | 'created'
  | 'edited'
  | 'breeding_started'
  | 'genotyping_same_gen'
  | 'genotyping_new_gen'
  | 'closed'
  | 'reopened'
  | 'protocol_changed'
  | 'cryo_changed'
  | 'reference_changed'
  | 'restored'
  | 'imported';

export interface LineVersionRow {
  id: string;
  line_id: string;
  version_no: number;
  snapshot: string;
  diff: string | null;
  change_type: VersionChangeType;
  summary: string;
  note: string | null;
  created_at: string;
  created_by: string;
  via_admin: number;
}

export type ActivityType =
  | VersionChangeType
  | 'chat_posted'
  | 'request_opened'
  | 'request_done'
  | 'user_added'
  | 'user_deactivated'
  | 'settings_changed'
  | 'mirror_failed';

export interface ActivityRow {
  id: string;
  line_id: string | null;
  user_id: string;
  via_admin: number;
  type: ActivityType;
  summary: string;
  ref_type: string | null;
  ref_id: string | null;
  created_at: string;
}

export type RequestStatus = 'open' | 'done';

export interface ChatMessageRow {
  id: string;
  line_id: string | null;
  user_id: string;
  via_admin: number;
  body: string;
  request_type: string | null;
  request_status: RequestStatus | null;
  request_done_by: string | null;
  request_done_at: string | null;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
}

export interface ChatReadRow {
  message_id: string;
  user_id: string;
  read_at: string;
}

export interface ChatReadStateRow extends ChatReadRow {
  deleted_at: string | null;
}

export interface ChatMentionRow {
  id: string;
  message_id: string;
  user_id: string;
  created_at: string;
  deleted_at: string | null;
}

export type MirrorRunKind = 'on_change' | 'nightly' | 'manual';

export interface MirrorRunRow {
  id: string;
  kind: MirrorRunKind;
  status: 'ok' | 'failed';
  started_at: string;
  finished_at: string | null;
  files_written: number;
  error: string | null;
}

export interface ImportRunRow {
  id: string;
  source_file: string | null;
  source_sheet: string | null;
  mode: 'dry_run' | 'apply';
  started_at: string;
  finished_at: string | null;
  report_md: string | null;
  row_count: number | null;
}
