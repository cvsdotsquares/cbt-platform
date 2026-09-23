import json

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

CANDIDATE_VISIBLE_STATUSES = ("PUBLISHED", "COMPLETED")


def parse_json(value):
    if value is None:
        return None
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return value
    return value


async def require_candidate_id(db: AsyncSession, user_id: str) -> str:
    row = await db.execute(
        text("SELECT id::text FROM candidates WHERE user_id::text = :user_id LIMIT 1"),
        {"user_id": str(user_id)},
    )
    candidate_id = row.scalar_one_or_none()
    if not candidate_id:
        raise HTTPException(
            status_code=400,
            detail="Candidate profile not found. Please complete registration.",
        )
    return str(candidate_id)


def assert_exam_visible_to_candidate(status: str) -> None:
    if status not in CANDIDATE_VISIBLE_STATUSES:
        raise HTTPException(status_code=400, detail="Exam is not available yet")
