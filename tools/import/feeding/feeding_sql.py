"""The SQL an import runs (T-036): one file, one transaction when run with `wrangler d1 execute --file`.
Nothing is deleted (BR-7): an earlier imported value is closed with `replaced_at/replaced_by`, and the new
value is inserted; a new provisional user is an inactive Feeder without a password."""

from __future__ import annotations

from feeding_mapper import Plan
from sql_text import sql_insert, sql_literal


def build_statements(plan: Plan, actor_id: str, now: str, new_id) -> list[str]:
    statements: list[str] = []
    for user in plan.new_users:
        statements.append(
            sql_insert(
                "users",
                {
                    "id": user.id,
                    "name": user.name,
                    "role": "feeder",
                    "is_active": 0,
                    "is_builtin": 0,
                    "created_at": now,
                    "updated_at": now,
                    "password_hash": None,
                    "must_change_password": 0,
                },
            )
        )
        statements.append(
            sql_insert(
                "activities",
                {
                    "id": new_id(),
                    "line_id": None,
                    "user_id": actor_id,
                    "type": "user_added",
                    "summary": f"User {user.name} added as feeder (provisional, from the Feeding Schedule sheet import).",
                    "ref_type": "user",
                    "ref_id": user.id,
                    "created_at": now,
                },
            )
        )
    for write in plan.writes:
        if write.replaces is not None:
            statements.append(
                "UPDATE feeding_assignments SET replaced_at = "
                f"{sql_literal(now)}, replaced_by = {sql_literal(actor_id)} "
                f"WHERE id = {sql_literal(write.replaces)} AND replaced_at IS NULL;"
            )
        statements.append(
            sql_insert(
                "feeding_assignments",
                {
                    "id": new_id(),
                    "date": write.date,
                    "user_id": write.user_id,
                    "note": None,
                    "imported_from": write.imported_from,
                    "created_at": now,
                    "created_by": actor_id,
                    "replaced_at": None,
                    "replaced_by": None,
                },
            )
        )
    return statements


def join_statements(statements: list[str]) -> str:
    return "\n".join(statements) + ("\n" if statements else "")
