"""Default class roll numbers: 1, 2, 3… in alphabetical name order."""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


def _name_key(student: dict) -> tuple[str, str, str]:
    return (
        str(student.get("first_name") or "").strip().casefold(),
        str(student.get("last_name") or "").strip().casefold(),
        str(student["id"]),
    )


def plan_roll_numbers(students: list[dict]) -> dict[str, str]:
    """Map each enrollment id to a roll number.

    Students whose roll is locked keep that number. Everyone else is numbered
    from 1 in alphabetical order, skipping numbers already kept.
    """
    locked: dict[str, str] = {}
    open_students: list[dict] = []
    for student in students:
        roll = str(student.get("roll_number") or "").strip()
        if student.get("roll_locked") and roll:
            locked[str(student["id"])] = roll
        else:
            open_students.append(student)

    used = set(locked.values())
    planned = dict(locked)
    number = 1
    for student in sorted(open_students, key=_name_key):
        while str(number) in used:
            number += 1
        roll = str(number)
        planned[str(student["id"])] = roll
        used.add(roll)
        number += 1
    return planned


async def sync_batch_roll_numbers(db: AsyncSession, batch_id: str) -> dict[str, str]:
    """Write alphabetical default roll numbers for one batch."""
    result = await db.execute(
        text(
            """
            SELECT be.id,
                   be.roll_number,
                   COALESCE(be.roll_locked, false) AS roll_locked,
                   COALESCE(u.first_name, '') AS first_name,
                   COALESCE(u.last_name, '') AS last_name
            FROM batch_enrollments be
            JOIN candidates c ON c.id = be.candidate_id
            JOIN users u ON u.id = c.user_id
            WHERE be.batch_id = :batch_id
            """
        ),
        {"batch_id": batch_id},
    )
    students = [dict(row) for row in result.mappings()]
    planned = plan_roll_numbers(students)
    for student in students:
        roll = planned[str(student["id"])]
        current = str(student.get("roll_number") or "")
        if current != roll:
            await db.execute(
                text(
                    """
                    UPDATE batch_enrollments
                    SET roll_number = :roll
                    WHERE id = :id
                    """
                ),
                {"roll": roll, "id": student["id"]},
            )
    return planned


async def sync_candidate_batches(db: AsyncSession, candidate_id: str) -> None:
    result = await db.execute(
        text(
            """
            SELECT DISTINCT batch_id
            FROM batch_enrollments
            WHERE candidate_id = :candidate_id
            """
        ),
        {"candidate_id": candidate_id},
    )
    for batch_id in result.scalars():
        await sync_batch_roll_numbers(db, str(batch_id))
