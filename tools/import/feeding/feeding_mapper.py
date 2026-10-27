"""Decides what an import writes (T-036, docs/08 section 7.2): which sheet names are which users, which
names need a new (provisional) user, and for every date whether to insert, replace an earlier import, leave
it (already imported, or changed in the app since) or skip it. Pure: no database, no file."""

from __future__ import annotations

from dataclasses import dataclass, field

from feeding_reader import Assignment, MonthRead


@dataclass(frozen=True)
class User:
    id: str
    name: str
    is_active: bool = True


@dataclass(frozen=True)
class ExistingRow:
    """A current (not replaced) feeding assignment already in the database."""

    id: str
    date: str
    user_id: str
    imported_from: str | None


@dataclass(frozen=True)
class NewUser:
    id: str
    name: str


@dataclass(frozen=True)
class Write:
    date: str
    user_id: str
    imported_from: str
    replaces: str | None  # id of the earlier imported row to close, if any


@dataclass
class Plan:
    new_users: list[NewUser] = field(default_factory=list)
    unknown_names: list[str] = field(default_factory=list)
    writes: list[Write] = field(default_factory=list)
    unchanged: list[str] = field(default_factory=list)  # dates already imported with this value
    kept_app_days: list[tuple[str, str]] = field(default_factory=list)  # (date, name in the app)
    excluded: list[Assignment] = field(default_factory=list)
    stale_imports: list[str] = field(default_factory=list)  # imported dates whose sheet cell is now empty
    resolved: dict[str, str] = field(default_factory=dict)  # sheet name (lower) -> user id (existing or new)


def _key(name: str) -> str:
    return " ".join(name.split()).casefold()


def cells_in(spec: str) -> set[str]:
    """`November2026!C7:I7` or `October2026!E7` -> the cell names (`November2026!C7` ...). One row or one
    cell per range is all the sheet needs; anything else is refused."""
    import re

    match = re.fullmatch(r"([A-Za-z]+\d{4})!([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?", spec.strip())
    if match is None:
        raise ValueError(f"Cannot read the cell range {spec!r}; use Sheet!E7 or Sheet!C7:I7 (one row).")
    tab, first, row, last, last_row = match.groups()
    if last is None:
        return {f"{tab}!{first}{row}"}
    if last_row != row:
        raise ValueError(f"{spec!r} spans several rows; list each row separately.")
    low, high = _column_number(first), _column_number(last)
    if low > high:
        raise ValueError(f"{spec!r} runs backwards.")
    return {f"{tab}!{_column_letters(number)}{row}" for number in range(low, high + 1)}


def _column_number(letters: str) -> int:
    number = 0
    for letter in letters:
        number = number * 26 + ord(letter) - 64
    return number


def _column_letters(number: int) -> str:
    letters = ""
    while number:
        number, rest = divmod(number - 1, 26)
        letters = chr(65 + rest) + letters
    return letters


def plan_import(
    months: list[MonthRead],
    users: list[User],
    existing: list[ExistingRow],
    *,
    create_missing: bool,
    new_id,
    aliases: dict[str, str] | None = None,
    exclude: set[str] | None = None,
) -> Plan:
    """`aliases` maps a sheet name to the name of an existing user; `exclude` is a set of cell names to skip."""
    aliases = {_key(sheet): target for sheet, target in (aliases or {}).items()}
    exclude = exclude or set()
    by_name = {_key(user.name): user for user in users}
    by_id = {user.id: user for user in users}
    current = {row.date: row for row in existing}
    plan = Plan()
    created: dict[str, NewUser] = {}
    sheet_dates: set[str] = set()

    for month in months:
        for assignment in month.assignments:
            if assignment.cell in exclude:
                plan.excluded.append(assignment)
                continue
            sheet_dates.add(assignment.date)
            key = _key(assignment.name)
            target = _key(aliases.get(key, assignment.name))
            user = by_name.get(target)
            if user is not None:
                user_id = user.id
            elif key in created:
                user_id = created[key].id
            elif create_missing:
                created[key] = NewUser(new_id(), assignment.name)
                plan.new_users.append(created[key])
                user_id = created[key].id
            else:
                if assignment.name not in plan.unknown_names:
                    plan.unknown_names.append(assignment.name)
                continue
            plan.resolved[key] = user_id
            row = current.get(assignment.date)
            if row is None:
                plan.writes.append(Write(assignment.date, user_id, assignment.cell, None))
            elif row.imported_from is None:
                shown = by_id[row.user_id].name if row.user_id in by_id else row.user_id
                plan.kept_app_days.append((assignment.date, shown))
            elif row.user_id == user_id:
                plan.unchanged.append(assignment.date)
            else:
                plan.writes.append(Write(assignment.date, user_id, assignment.cell, row.id))

    months_read = {month.month for month in months}
    plan.stale_imports = sorted(
        row.date
        for row in existing
        if row.imported_from is not None and row.date[:7] in months_read and row.date not in sheet_dates
    )
    return plan
