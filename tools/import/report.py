"""Step 3 (T-004): renders the dry-run report (`docs/05-import-spec.md` section 6) as Markdown, so
it reads well both on GitHub and as plain text (`import_runs.report_md`, Settings, FR-ADM-05).
"""

from __future__ import annotations

from dataclasses import dataclass

from normalize import Diagnostic, NormalizedLine
from reader import NOT_IMPORTED_SHEETS, SheetInfo

# Reference candidates are installation-specific; do not embed private folder history in code.
REFERENCE_CANDIDATES: tuple[tuple[str, str], ...] = ()


@dataclass(frozen=True)
class Summary:
    total_lines: int
    status_counts: dict[str, int]
    protocol_type_counts: dict[str, int]
    cryo_total: int
    cryo_details_unknown: int
    lines_with_gene_text: int
    lines_with_reference: int
    next_cryo_id: str | None


def compute_summary(lines: list[NormalizedLine]) -> Summary:
    status_counts: dict[str, int] = {}
    protocol_type_counts: dict[str, int] = {}
    cryo_total = 0
    cryo_unknown = 0
    gene_count = 0
    reference_count = 0
    highest_cryo_number = 0
    for line in lines:
        status_counts[line.status] = status_counts.get(line.status, 0) + 1
        protocol_type_counts[line.protocol.protocol_type] = (
            protocol_type_counts.get(line.protocol.protocol_type, 0) + 1
        )
        if line.gene:
            gene_count += 1
        if line.reference_title:
            reference_count += 1
        if line.cryo_record is not None:
            cryo_total += 1
            if line.cryo_record.details_unknown:
                cryo_unknown += 1
            for cryo_id in (line.cryo_record.cryo_id_start, line.cryo_record.cryo_id_end):
                if cryo_id and cryo_id.startswith("C") and cryo_id[1:].isdigit():
                    highest_cryo_number = max(highest_cryo_number, int(cryo_id[1:]))
    next_cryo_id = f"C{highest_cryo_number + 1:04d}" if highest_cryo_number else None
    return Summary(
        total_lines=len(lines),
        status_counts=status_counts,
        protocol_type_counts=protocol_type_counts,
        cryo_total=cryo_total,
        cryo_details_unknown=cryo_unknown,
        lines_with_gene_text=gene_count,
        lines_with_reference=reference_count,
        next_cryo_id=next_cryo_id,
    )


def _counts_line(counts: dict[str, int]) -> str:
    return ", ".join(f"{count} {key}" for key, count in counts.items())


def _render_summary(summary: Summary) -> str:
    lines = [
        "## Summary counts",
        "",
        f"- Lines: **{summary.total_lines}**",
        f"- Status: {_counts_line(summary.status_counts)}",
        f"- ID Method: {_counts_line(summary.protocol_type_counts)}",
        f"- Cryopreserved: {summary.cryo_total} "
        f"({summary.cryo_details_unknown} with details unknown)",
        f"- Lines with gene text: {summary.lines_with_gene_text}",
        f"- Lines with a reference name: {summary.lines_with_reference}",
    ]
    if summary.next_cryo_id:
        lines.append(f"- Next Cryo ID suggestion: `{summary.next_cryo_id}`")
    return "\n".join(lines)


def _render_sheet_inventory(sheets: list[SheetInfo]) -> str:
    rows = ["| Sheet | State | Rows | Imported |", "|---|---|---|---|"]
    for sheet in sheets:
        imported = "no (out of scope)" if sheet.name in NOT_IMPORTED_SHEETS else "yes"
        rows.append(f"| `{sheet.name}` | {sheet.state} | {sheet.max_row} | {imported} |")
    return "## Sheet inventory\n\n" + "\n".join(rows)


def _cryo_cell(line: NormalizedLine) -> str:
    if line.cryo_record is None:
        return "No"
    if line.cryo_record.details_unknown:
        return "Yes (details unknown)"
    return "Yes"


def _render_per_line_table(entries: list[tuple[NormalizedLine, list[Diagnostic]]]) -> str:
    rows = [
        "| Line | Status | ID Method | DOB | IDed number | Cryopreserved | Notes |",
        "|---|---|---|---|---|---|---|",
    ]
    for line, diagnostics in sorted(entries, key=lambda pair: pair[0].name.lower()):
        note_count = len(diagnostics)
        note = f"{note_count} note(s), see below" if note_count else "-"
        rows.append(
            f"| {line.name} | {line.status} | {line.protocol.label} | {line.dob or '-'} | "
            f"{line.ided_number} | {_cryo_cell(line)} | {note} |"
        )
    return "## Per-line summary\n\n" + "\n".join(rows)


def _diagnostic_items(entries: list[tuple[NormalizedLine, list[Diagnostic]]], kind: str) -> str:
    items = [
        f"- **{diagnostic.line}**: {diagnostic.message}"
        for _line, diagnostics in sorted(entries, key=lambda pair: pair[0].name.lower())
        for diagnostic in diagnostics
        if diagnostic.kind == kind
    ]
    return "\n".join(items) if items else "_None._"


def _render_missing_reference_links(entries: list[tuple[NormalizedLine, list[Diagnostic]]]) -> str:
    items = [
        f"- **{line.name}**: {line.reference_title!r} (no URL; attach one in the app)"
        for line, _diagnostics in sorted(entries, key=lambda pair: pair[0].name.lower())
        if line.reference_title
    ]
    body = "\n".join(items) if items else "_None._"
    return "### References with no link yet\n\n" + body


@dataclass(frozen=True)
class TaskManagementSummary:
    """What Step 4's `chat_requests.build_chat_requests` produced, for the report."""

    source_rows: int
    messages_created: int
    unmatched: list[str]


def _render_task_management(summary: TaskManagementSummary | None) -> str:
    if summary is None:
        return "### Task Management import\n\n_Not run in this dry run._"
    lines = [
        "### Task Management import",
        "",
        f"- {summary.source_rows} sheet row(s) -> {summary.messages_created} chat message(s) "
        "(a `Lines Above` row expands to one message per line named earlier in its group).",
        "- Poster is the account selected with --actor-id: the sheet does not record who posted a task.",
        f"- Rows that could not be matched to a line: {len(summary.unmatched)}",
    ]
    lines += [f"  - {row}" for row in summary.unmatched]
    return "\n".join(lines)


def _render_reference_candidates() -> str:
    rows = [f"| {name} | {candidate} |" for name, candidate in REFERENCE_CANDIDATES]
    if not rows:
        return "## Reference candidates\n\n_None configured; add links through the app after import._"
    return "## Reference candidates\n\n| Excel name | Candidate path(s) |\n|---|---|\n" + "\n".join(rows)


def render_report(
    *,
    generated_at: str,
    source_file: str,
    sheet_inventory: list[SheetInfo],
    entries: list[tuple[NormalizedLine, list[Diagnostic]]],
    task_management: TaskManagementSummary | None = None,
) -> str:
    """The full `report.md`. `entries` pairs every imported line with its diagnostics (in the same
    order Step 2 produced them); `task_management` is Step 4's `chat_requests` result."""
    sections = [
        "# Fish-Database import report",
        "",
        f"Generated {generated_at} from `{source_file}` (read-only; the file is never modified).",
        "",
        _render_summary(compute_summary([line for line, _diagnostics in entries])),
        "",
        _render_sheet_inventory(sheet_inventory),
        "",
        _render_per_line_table(entries),
        "",
        "## Normalisations applied",
        "",
        _diagnostic_items(entries, "normalisation"),
        "",
        "## Unresolved items",
        "",
        "### Fields needing a decision",
        "",
        _diagnostic_items(entries, "unresolved"),
        "",
        _render_missing_reference_links(entries),
        "",
        _render_task_management(task_management),
        "",
        _render_reference_candidates(),
        "",
    ]
    return "\n".join(sections)
