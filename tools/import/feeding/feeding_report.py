"""The Markdown report of a dry run (T-036): what the sheet holds, what would be written, and everything
that needs the owner's eye. Names are first names as written in the sheet; no other personal data."""

from __future__ import annotations

import calendar
from collections import Counter
from datetime import date

from feeding_mapper import Plan
from feeding_reader import MonthRead

WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]


def _weekend(day: str) -> bool:
    return date.fromisoformat(day).weekday() >= 5


def _calendar(month: MonthRead) -> list[str]:
    year, number = (int(part) for part in month.month.split("-"))
    names = {a.date: a.name for a in month.assignments}
    lines = ["| " + " | ".join(WEEKDAYS) + " |", "|" + " --- |" * 7]
    first = (date(year, number, 1).weekday() + 1) % 7
    cells = [""] * first + [
        f"{day} {names.get(f'{year:04d}-{number:02d}-{day:02d}', '-')}"
        for day in range(1, calendar.monthrange(year, number)[1] + 1)
    ]
    cells += [""] * (-len(cells) % 7)
    for start in range(0, len(cells), 7):
        lines.append("| " + " | ".join(cells[start : start + 7]) + " |")
    return lines


def _cell_range(cells: list[str]) -> str:
    """`['November2026!E7', 'November2026!F7']` -> `November2026!E7:F7` (cells of one row, in order)."""
    first, last = cells[0], cells[-1]
    return first if first == last else f"{first}:{last.split('!')[1]}"


def render_report(
    *, generated_at: str, source_name: str, env: str, months: list[MonthRead], plan: Plan, actor: str
) -> str:
    out = [
        "# Feeding Schedule import report",
        "",
        f"- Generated: {generated_at}",
        f"- Source file: {source_name}",
        f"- Target: {env}",
        f"- Actor (author of the written rows): {actor}",
        f"- Months read: {', '.join(m.month for m in months)}",
        "",
        "## Summary",
        "",
        f"- Assignments in the sheet: {sum(len(m.assignments) for m in months)}",
        f"- To write: {len(plan.writes)} ({sum(1 for w in plan.writes if w.replaces) } replace an earlier import)",
        f"- Already imported with the same value (no change): {len(plan.unchanged)}",
        f"- Changed in the app since, so kept: {len(plan.kept_app_days)}",
        f"- Excluded by the owner: {len(plan.excluded)}",
        f"- Name cells without a day number (orphans, skipped): {sum(len(m.orphans) for m in months)}",
        f"- Event cells (not imported): {sum(m.events_ignored for m in months)}",
        f"- Unknown names: {len(plan.unknown_names)}",
        f"- Provisional users to create: {len(plan.new_users)}",
        "",
    ]
    if plan.unknown_names:
        out += [
            "## Unknown names (stop)",
            "",
            "No user has these names. Add them in Settings > Users, pass `--alias \"Sheet name=User name\"`, "
            "or run with `--create-missing-users` to create provisional (inactive) users.",
            "",
            *[f"- {name}" for name in plan.unknown_names],
            "",
        ]
    if plan.new_users:
        out += [
            "## Provisional users to create",
            "",
            "Each becomes an **inactive Feeder without a password**: past days show their name, and an Admin "
            "decides later in Settings > Users (Show removed users): Reactivate to let the person use the app "
            "and be scheduled, or leave inactive.",
            "",
            *[f"- {user.name}" for user in plan.new_users],
            "",
        ]
    if plan.excluded:
        out += [
            "## Excluded by the owner",
            "",
            *[f"- {a.cell} ({a.name}, {a.date})" for a in plan.excluded],
            "",
        ]
    if plan.kept_app_days:
        out += [
            "## Days changed in the app (kept)",
            "",
            *[f"- {day}: {name}" for day, name in plan.kept_app_days],
            "",
        ]
    if plan.stale_imports:
        out += [
            "## Imported days whose sheet cell is now empty (left as they are)",
            "",
            *[f"- {day}" for day in plan.stale_imports],
            "",
        ]
    for month in months:
        year, number = (int(part) for part in month.month.split("-"))
        total_days = calendar.monthrange(year, number)[1]
        counts: Counter[str] = Counter()
        weekend: Counter[str] = Counter()
        for a in month.assignments:
            counts[a.name] += 1
            if _weekend(a.date):
                weekend[a.name] += 1
        out += [
            f"## {calendar.month_name[number]} {year}",
            "",
            f"- Tab: {month.tab}; day cells: {month.days}; assignments: {len(month.assignments)}; "
            f"events not imported: {month.events_ignored}",
        ]
        if len(month.assignments) < total_days:
            first_week_only = 0 < len(month.assignments) <= 7 and all(
                int(a.date[8:]) <= 7 for a in month.assignments
            )
            if first_week_only:
                out.append(
                    f"- **Check:** only the first week is filled ({len(month.assignments)} of {total_days} days). "
                    "If these are leftovers of the sheet template, exclude them with "
                    f"`--exclude \"{_cell_range([a.cell for a in month.assignments])}\"`."
                )
            else:
                out.append(f"- {total_days - len(month.assignments)} of {total_days} days have no name.")
        if month.orphans:
            out.append(
                "- Orphans (a name with no day number above it, skipped): "
                + ", ".join(f"{o.cell} ({o.name})" for o in month.orphans)
            )
        out += ["", "| Person | Days | Weekend days |", "| --- | --- | --- |"]
        out += [
            f"| {name} | {count} | {weekend[name]} |"
            for name, count in sorted(counts.items(), key=lambda item: (-item[1], item[0]))
        ]
        out += ["", *_calendar(month), ""]
    return "\n".join(out)
