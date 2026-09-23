"""Teacher batch scoping (parity with Nest teacher-scope.util)."""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import loaded_role_names

ELEVATED_ROLES = frozenset(
    {"SUPER_ADMIN", "ORG_ADMIN", "INSTITUTE_ADMIN", "EXAM_MANAGER", "ADMIN"}
)


def is_teacher_scoped(user) -> bool:
    roles = {r.upper() for r in loaded_role_names(user)}
    if "TEACHER" not in roles:
        return False
    return not any(r in ELEVATED_ROLES for r in roles)


async def get_teacher_batch_ids(db: AsyncSession, user_id: str) -> list[str]:
    rows = await db.execute(
        text(
            """
            SELECT DISTINCT batch_id::text AS batch_id
            FROM teacher_assignments
            WHERE user_id = :user_id
            """
        ),
        {"user_id": str(user_id)},
    )
    return [str(row["batch_id"]) for row in rows.mappings() if row.get("batch_id")]
