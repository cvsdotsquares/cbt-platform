"""Teacher batch scoping (parity with Nest teacher-scope.util)."""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import fetch_role_names_for_user, loaded_role_names
from app.models.user import User

ELEVATED_ROLES = frozenset(
    {"SUPER_ADMIN", "ORG_ADMIN", "EXAM_MANAGER", "ADMIN"}
)


def is_teacher_scoped(user, role_names: list[str] | None = None) -> bool:
    roles = {r.upper() for r in (role_names if role_names is not None else loaded_role_names(user))}
    if "TEACHER" not in roles:
        return False
    return not any(r in ELEVATED_ROLES for r in roles)


async def is_teacher_scoped_user(db: AsyncSession, user: User) -> bool:
    role_names = await fetch_role_names_for_user(db, str(user.id))
    return is_teacher_scoped(user, role_names)


async def get_teacher_subject_ids(db: AsyncSession, user_id: str, batch_id: str) -> list[str]:
    """Subjects this teacher is assigned to teach on one batch."""
    rows = await db.execute(
        text(
            """
            SELECT DISTINCT subject_id::text AS subject_id
            FROM teacher_assignments
            WHERE user_id = :user_id AND batch_id = :batch_id
            """
        ),
        {"user_id": str(user_id), "batch_id": str(batch_id)},
    )
    return [str(row["subject_id"]) for row in rows.mappings() if row.get("subject_id")]


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
