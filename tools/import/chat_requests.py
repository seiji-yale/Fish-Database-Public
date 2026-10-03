"""Step 4 (T-004): turns the `Task Management` sheet into per-line chat messages tagged as done
Requests (`docs/05-import-spec.md` section 5). The caller supplies the existing actor account;
the sheet does not record who posted a task, so the import report states that assumption.
"""

from __future__ import annotations

from dataclasses import dataclass

from reader import RawRecord
from tz import local_datetime_to_utc_iso, local_noon_to_utc_iso, to_iso_date

REQUEST_STATUS_DONE = "done"


@dataclass(frozen=True)
class ChatRequest:
    line_name: str
    request_type: str
    body: str
    created_at: str  # ISO-8601 UTC
    request_done_at: str  # ISO-8601 UTC


def map_request_type(category: object, task: object) -> str:
    """Category/Task -> `enumerations(kind='request_type')` value (docs/05-import-spec.md section 5):
    any `Genotyping` category is `Genotyping`; `Breeding`/`Set Out-cross` is `Set up cross`;
    everything else (`Breeding`/`Collect Embryos`, `Breeding`/`Tank Wash`, ...) is `Other`."""
    if category == "Genotyping":
        return "Genotyping"
    if category == "Breeding" and task == "Set Out-cross":
        return "Set up cross"
    return "Other"


def build_body(task: object, description: object, assigned_to: object, due: object, message: object) -> str:
    due_iso = to_iso_date(due)
    if due_iso is None:
        raise ValueError(f"Task {task!r}: Due must not be blank")
    text = f"[Imported task] {task} — {description}. Assigned to {assigned_to}, due {due_iso}."
    if message not in (None, ""):
        text += f" {message}"
    return text


def resolve_line_name(raw_value: object, known_names: set[str]) -> str | None:
    """`3417`/`'3959A'` -> `demo_016`/`demo_017` when the bare value isn't itself a line name
    (docs/05-import-spec.md section 5); an exact (case-sensitive) match is tried first."""
    if raw_value is None:
        return None
    text = str(raw_value).strip()
    if text in known_names:
        return text
    prefixed = f"hi{text}"
    return prefixed if prefixed in known_names else None


def build_chat_requests(
    rows: list[RawRecord], known_line_names: set[str]
) -> tuple[list[ChatRequest], list[str]]:
    """Returns `(messages, unmatched_descriptions)`. `Lines Above` expands to every line resolved
    earlier in the same `Posted`-date group (docs/05-import-spec.md section 5); rows whose `Line`
    cannot be resolved contribute no message and are reported instead of being silently dropped."""
    requests: list[ChatRequest] = []
    unmatched: list[str] = []
    group_posted: object = object()  # sentinel that never equals a real Posted value
    group_line_names: list[str] = []

    for row in rows:
        values = row.values
        posted = values["posted"]
        if posted != group_posted:
            group_posted = posted
            group_line_names = []

        request_type = map_request_type(values["category"], values["task"])
        body = build_body(values["task"], values["description"], values["assigned_to"], values["due"], values["message"])
        created_at = local_noon_to_utc_iso(posted)
        last_updated = values["last_updated"]
        request_done_at = (
            local_datetime_to_utc_iso(last_updated) if last_updated is not None
            else local_noon_to_utc_iso(values["due"])
        )

        raw_line = values["line"]
        if isinstance(raw_line, str) and raw_line.strip() == "Lines Above":
            if not group_line_names:
                unmatched.append(
                    f"row {row.row}: 'Lines Above' has no resolved line earlier in the "
                    f"{posted!r} group"
                )
                continue
            targets = list(group_line_names)
        else:
            resolved = resolve_line_name(raw_line, known_line_names)
            if resolved is None:
                unmatched.append(f"row {row.row}: Line {raw_line!r} did not match any line")
                continue
            group_line_names.append(resolved)
            targets = [resolved]

        for line_name in targets:
            requests.append(
                ChatRequest(
                    line_name=line_name,
                    request_type=request_type,
                    body=body,
                    created_at=created_at,
                    request_done_at=request_done_at,
                )
            )

    return requests, unmatched
