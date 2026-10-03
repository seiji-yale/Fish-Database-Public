"""Step 5 (T-004): builds the SQL statements `--apply` runs.

Per OQ-29 (no `import_run_id` column, no hard delete of user data), every line is one of:

- **insert**: the name is not in the target database yet -- write it fresh.
- **refresh**: the name is there, but its newest `line_versions` row is still `version_no = 1` /
  `change_type = 'imported'` -- nothing has touched it since the last import, so it is safe to
  replace its import-owned rows wholesale with the freshly read spreadsheet data. This *is* a hard
  delete, but only of rows this tool itself created and that no user action has ever referenced;
  BR-7 ("never hard-delete data in application code") is about the running application's write
  paths, not this one-off, pre-launch import tool.
- **skip**: the name is there with a *later* version -- someone edited it in the app since it was
  imported. It is never touched; it is reported instead ("skipped -- edited since import").

Statement order matters and does not rely on deferred foreign keys: `lines.line_id` on every child
table is an *immediate* foreign key (children must come after their line), and although
`lines.current_protocol_id` is declared `DEFERRABLE INITIALLY DEFERRED` in the schema, the real
hosted D1 service does not honour that across the statements of one `--file` the way plain SQLite
does (confirmed against a real preview database). So a line is always written with
`current_protocol_id = NULL` first, its protocol is inserted right after (now satisfying the
*immediate* `id_protocols.line_id` -> `lines.id` foreign key), and a final `UPDATE` points the line
at it -- safe under both immediate and deferred constraint checking, local or remote.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Literal

from chat_requests import ChatRequest
from normalize import NormalizedLine
from sql_text import sql_insert, sql_literal
from tz import local_noon_to_utc_iso
from ulid import new_id

Plan = Literal["insert", "refresh", "skip"]

# Child tables cleared *entirely* for the line before a "refresh"; genotyping_records first
# because it references id_protocols with an immediate foreign key (deleting the protocol first
# would violate it). `activities` is deliberately not here: it also holds `chat_posted` rows for
# this line's (untouched) imported chat messages, and a blanket clear would silently delete those
# too. Only the line's own "imported" activity is cleared, by `REFRESH_ACTIVITY_CLEAR_SQL` below.
CHILD_TABLES_TO_CLEAR: tuple[str, ...] = (
    "genotyping_records",
    "id_protocols",
    "cryo_records",
    "line_references",
    "line_attributes",
    "line_phenotypes",
    "line_versions",
)

# Reads every line's current name and highest version number in one round trip.
ELIGIBILITY_QUERY = """
SELECT lines.id AS id, lines.name AS name,
       COALESCE(MAX(line_versions.version_no), 0) AS max_version_no
FROM lines
LEFT JOIN line_versions ON line_versions.line_id = lines.id
GROUP BY lines.id;
""".strip()

# Task Management chat messages carry no id column of their own to key a re-import on (OQ-29 is
# about lines; there is no `import_run_id` anywhere). The fixed body prefix every imported message
# gets (chat_requests.build_body) is instead used as the "already imported" marker: a line that
# already has at least one such message is left alone on a later --apply, whatever plan it got.
IMPORTED_CHAT_LINE_IDS_QUERY = """
SELECT DISTINCT line_id FROM chat_messages WHERE body LIKE '[Imported task]%';
""".strip()


def lines_with_imported_chat(rows: list[dict[str, object]]) -> set[str]:
    """`rows` is `IMPORTED_CHAT_LINE_IDS_QUERY`'s result."""
    return {str(row["line_id"]) for row in rows}


@dataclass(frozen=True)
class ExistingLine:
    id: str
    max_version_no: int


def existing_lines_by_name(rows: list[dict[str, object]]) -> dict[str, ExistingLine]:
    """`rows` is `ELIGIBILITY_QUERY`'s result (from `d1_client.query` or a test database)."""
    return {
        str(row["name"]): ExistingLine(id=str(row["id"]), max_version_no=int(row["max_version_no"]))
        for row in rows
    }


def plan_for(name: str, existing: dict[str, ExistingLine]) -> tuple[Plan, str | None]:
    """`(plan, existing_line_id)`. `existing_line_id` is `None` only for `insert`."""
    entry = existing.get(name)
    if entry is None:
        return "insert", None
    if entry.max_version_no <= 1:
        return "refresh", entry.id
    return "skip", entry.id


def snapshot_dict(line: NormalizedLine) -> dict[str, object]:
    """The `line_versions.snapshot` JSON: the full imported line document (docs/03-data-model.md
    2.12), everything the normaliser produced for this line except ids (assigned at write time)."""
    return {
        "name": line.name,
        "gene": line.gene,
        "status": line.status,
        "dob": line.dob,
        "legacy_no": line.legacy_no,
        "legacy_check": line.legacy_check,
        "notes": line.notes,
        "source_attribute": line.source_attribute,
        "ided_number": line.ided_number,
        "last_id_date": line.last_id_date,
        "phenotypes": list(line.phenotypes),
        "reference_title": line.reference_title,
        "protocol": {
            "protocol_type": line.protocol.protocol_type,
            "label": line.protocol.label,
            "fields": line.protocol.fields,
            "notes": line.protocol.notes,
        },
        "genotyping_record": None
        if line.genotyping_record is None
        else {
            "record_date": line.genotyping_record.record_date,
            "positive_count": line.genotyping_record.positive_count,
            "notes": line.genotyping_record.notes,
        },
        "cryo_record": None
        if line.cryo_record is None
        else {
            "cryo_date": line.cryo_record.cryo_date,
            "place": line.cryo_record.place,
            "box_name": line.cryo_record.box_name,
            "cryo_id_start": line.cryo_record.cryo_id_start,
            "cryo_id_end": line.cryo_record.cryo_id_end,
            "count": line.cryo_record.count,
            "details_unknown": line.cryo_record.details_unknown,
            "notes": line.cryo_record.notes,
        },
    }


def build_line_statements(
    line: NormalizedLine, plan: Plan, existing_id: str | None, actor_id: str
) -> tuple[list[str], str]:
    """SQL statements for one line (`plan` must not be `"skip"`). Returns `(statements, line_id)`."""
    if plan == "skip":
        raise ValueError("build_line_statements must not be called for a skipped line")
    statements: list[str] = []
    line_id = existing_id if plan == "refresh" and existing_id else new_id()
    protocol_id = new_id()
    version_id = new_id()
    activity_id = new_id()
    timestamp = local_noon_to_utc_iso(line.updated_at_source)

    if plan == "refresh":
        assert existing_id is not None
        statements.append(f"UPDATE lines SET current_protocol_id = NULL WHERE id = {sql_literal(existing_id)};")
        statements += [
            f"DELETE FROM {table} WHERE line_id = {sql_literal(existing_id)};" for table in CHILD_TABLES_TO_CLEAR
        ]
        # Only this line's own "imported" activity -- not any `chat_posted` activity for its
        # (untouched) imported chat messages.
        statements.append(
            f"DELETE FROM activities WHERE line_id = {sql_literal(existing_id)} AND type = 'imported';"
        )

    lines_row = {
        "id": line_id,
        "name": line.name,
        "gene": line.gene,
        "status": line.status,
        "dob": line.dob,
        "generation_no": 1,
        "ided_number": line.ided_number,
        "last_id_date": line.last_id_date,
        "breeding_started_at": None,
        "closed_at": None,
        "closed_reason": None,
        "notes": line.notes,
        # NULL here on purpose: the real hosted D1 service does not honour this column's
        # DEFERRABLE INITIALLY DEFERRED declaration across the statements of one `--file` the way
        # plain SQLite (and `wrangler`'s local dev D1) does -- confirmed against a real preview
        # database, where inserting a line with current_protocol_id already pointing at the
        # protocol row inserted right after it failed with SQLITE_CONSTRAINT_FOREIGNKEY. Set to
        # the real protocol id afterwards, once that row exists (see the trailing UPDATE below).
        "current_protocol_id": None,
        "legacy_no": line.legacy_no,
        "legacy_check": line.legacy_check,
        "version": 1,
        "created_at": timestamp,
        "created_by": actor_id,
        "updated_at": timestamp,
        "updated_by": actor_id,
    }
    if plan == "insert":
        statements.append(sql_insert("lines", lines_row))
    else:
        assignments = ", ".join(f"{column} = {sql_literal(value)}" for column, value in lines_row.items() if column != "id")
        statements.append(f"UPDATE lines SET {assignments} WHERE id = {sql_literal(line_id)};")

    statements.append(
        sql_insert(
            "id_protocols",
            {
                "id": protocol_id,
                "line_id": line_id,
                "protocol_type": line.protocol.protocol_type,
                "label": line.protocol.label,
                "fields": json.dumps(line.protocol.fields),
                "notes": line.protocol.notes,
                "sort_order": 0,
                "deleted_at": None,
                "created_at": timestamp,
                "updated_at": timestamp,
            },
        )
    )
    statements.append(
        f"UPDATE lines SET current_protocol_id = {sql_literal(protocol_id)} WHERE id = {sql_literal(line_id)};"
    )

    for index, description in enumerate(line.phenotypes):
        statements.append(
            sql_insert(
                "line_phenotypes",
                {
                    "id": new_id(),
                    "line_id": line_id,
                    "description": description,
                    "sort_order": index,
                    "deleted_at": None,
                },
            )
        )

    if line.source_attribute is not None:
        statements.append(
            sql_insert(
                "line_attributes",
                {
                    "id": new_id(),
                    "line_id": line_id,
                    "key": "Source",
                    "value": line.source_attribute,
                    "sort_order": 0,
                    "deleted_at": None,
                },
            )
        )

    if line.genotyping_record is not None:
        statements.append(
            sql_insert(
                "genotyping_records",
                {
                    "id": new_id(),
                    "line_id": line_id,
                    "generation_no": 1,
                    "record_date": line.genotyping_record.record_date,
                    "protocol_id": protocol_id,
                    "positive_count": line.genotyping_record.positive_count,
                    "screened_count": None,
                    "is_new_generation": 0,
                    "new_dob": None,
                    "notes": line.genotyping_record.notes,
                    "created_at": timestamp,
                    "created_by": actor_id,
                },
            )
        )

    if line.cryo_record is not None:
        statements.append(
            sql_insert(
                "cryo_records",
                {
                    "id": new_id(),
                    "line_id": line_id,
                    "cryo_date": line.cryo_record.cryo_date,
                    "place": line.cryo_record.place,
                    "box_name": line.cryo_record.box_name,
                    "cryo_id_start": line.cryo_record.cryo_id_start,
                    "cryo_id_end": line.cryo_record.cryo_id_end,
                    "count": line.cryo_record.count,
                    "details_unknown": line.cryo_record.details_unknown,
                    "notes": line.cryo_record.notes,
                    "deleted_at": None,
                    "created_at": timestamp,
                    "created_by": actor_id,
                },
            )
        )

    if line.reference_title is not None:
        statements.append(
            sql_insert(
                "line_references",
                {
                    "id": new_id(),
                    "line_id": line_id,
                    "title": line.reference_title,
                    "url": None,
                    "attachment_id": None,
                    "note": None,
                    "sort_order": 0,
                    "deleted_at": None,
                    "created_at": timestamp,
                    "created_by": actor_id,
                },
            )
        )

    statements.append(
        sql_insert(
            "line_versions",
            {
                "id": version_id,
                "line_id": line_id,
                "version_no": 1,
                "snapshot": json.dumps(snapshot_dict(line)),
                "diff": None,
                "change_type": "imported",
                "summary": "Imported from Mastersheet Ver. 1.1",
                "note": None,
                "created_at": timestamp,
                "created_by": actor_id,
                "via_admin": 0,
            },
        )
    )
    statements.append(
        sql_insert(
            "activities",
            {
                "id": activity_id,
                "line_id": line_id,
                "user_id": actor_id,
                "via_admin": 0,
                "type": "imported",
                "summary": "Imported from Mastersheet Ver. 1.1",
                "ref_type": None,
                "ref_id": None,
                "created_at": timestamp,
            },
        )
    )
    return statements, line_id


def build_chat_request_statements(line_id: str, request: ChatRequest, actor_id: str) -> list[str]:
    """A `chat_messages` row plus its companion `activities` row (docs/03-data-model.md 2.13:
    "`line_versions` and `chat_messages` each create one")."""
    message_id = new_id()
    activity_id = new_id()
    return [
        sql_insert(
            "chat_messages",
            {
                "id": message_id,
                "line_id": line_id,
                "user_id": actor_id,
                "via_admin": 0,
                "body": request.body,
                "request_type": request.request_type,
                "request_status": "done",
                "request_done_by": None,
                "request_done_at": request.request_done_at,
                "edited_at": None,
                "deleted_at": None,
                "created_at": request.created_at,
            },
        ),
        sql_insert(
            "activities",
            {
                "id": activity_id,
                "line_id": line_id,
                "user_id": actor_id,
                "via_admin": 0,
                "type": "chat_posted",
                "summary": f"[Imported task] {request.request_type}",
                "ref_type": "chat_message",
                "ref_id": message_id,
                "created_at": request.created_at,
            },
        ),
    ]


def join_statements(statements: list[str]) -> str:
    """The text written to `import.sql` / passed to `wrangler d1 execute --file`.

    No explicit `BEGIN`/`COMMIT`: `wrangler d1 execute --file` already runs the whole file as one
    atomic unit and *refuses* a file containing its own `BEGIN TRANSACTION` (D1 is built on
    Durable Object storage, which requires the JS transaction API instead of SQL transaction
    statements). Nothing here relies on a deferred foreign key (hosted D1 does not honour one; see
    the module docstring). The tests wrap the same statements in `BEGIN`/`COMMIT` themselves
    (`testing_db.run_statements`) to get the same all-or-nothing behaviour from plain SQLite."""
    return "\n".join([*statements, ""])
