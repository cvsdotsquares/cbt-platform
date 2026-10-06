from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def count_exam_student_attempts(db: AsyncSession, exam_id: str) -> tuple[int, int]:
    """Returns (session_count, result_count) for started/submitted activity."""
    session_row = await db.execute(
        text("SELECT COUNT(*) FROM exam_sessions WHERE exam_id::text = :exam_id"),
        {"exam_id": str(exam_id)},
    )
    result_row = await db.execute(
        text("SELECT COUNT(*) FROM exam_results WHERE exam_id::text = :exam_id"),
        {"exam_id": str(exam_id)},
    )
    sessions = int(session_row.scalar() or 0)
    results = int(result_row.scalar() or 0)
    return sessions, results


async def exam_has_student_attempts(db: AsyncSession, exam_id: str) -> bool:
    sessions, results = await count_exam_student_attempts(db, exam_id)
    return sessions > 0 or results > 0
