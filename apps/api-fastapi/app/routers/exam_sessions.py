from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.services.candidate_context import require_candidate_id
from app.services.exam_engine import (
    _time_remaining,
    _duration_minutes,
    evaluate_session,
    get_session_state,
    start_session,
    _upsert_response,
)

router = APIRouter(prefix="/exam-sessions", tags=["Exam Sessions"])


class StartBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    exam_id: str = Field(..., alias="examId")


class AnswerBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    question_id: str = Field(..., alias="questionId")
    answer: object
    time_spent_seconds: int = Field(0, alias="timeSpentSeconds")
    marked_for_review: bool = Field(False, alias="markedForReview")


class MarkReviewBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    question_id: str = Field(..., alias="questionId")
    marked: bool


class SubmitBody(BaseModel):
    answers: list[AnswerBody] | None = None


async def _owner(db: AsyncSession, session_id: str, user_id: str):
    candidate_id = await require_candidate_id(db, user_id)
    row = await db.execute(
        text("SELECT candidate_id, status FROM exam_sessions WHERE id = :id"),
        {"id": session_id},
    )
    s = row.mappings().first()
    if not s:
        raise HTTPException(status_code=404, detail="Session not found")
    if s["candidate_id"] != candidate_id:
        raise HTTPException(status_code=403, detail="Session does not belong to this candidate")
    return candidate_id, s["status"]


@router.post("/start")
async def start_exam_session(
    body: StartBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    candidate_id = await require_candidate_id(db, current_user.id)
    return await start_session(db, body.exam_id, candidate_id)


@router.get("/{session_id}")
async def get_exam_session(
    session_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    candidate_id = await require_candidate_id(db, current_user.id)
    return await get_session_state(db, session_id, candidate_id)


@router.post("/{session_id}/responses")
async def save_response(
    session_id: str,
    body: AnswerBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _, status = await _owner(db, session_id, current_user.id)
    if status != "IN_PROGRESS":
        raise HTTPException(status_code=400, detail="Session is not active")
    answer = body.answer if isinstance(body.answer, dict) else {"value": body.answer}
    await _upsert_response(db, session_id, body.question_id, answer, body.time_spent_seconds, body.marked_for_review)
    return {"saved": True}


@router.post("/{session_id}/mark-review")
async def mark_review(
    session_id: str,
    body: MarkReviewBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _owner(db, session_id, current_user.id)
    await _upsert_response(
        db,
        session_id,
        body.question_id,
        None,
        0,
        body.marked,
        update_answer=False,
    )
    return {"marked": body.marked}


@router.post("/{session_id}/submit")
async def submit_session(
    session_id: str,
    body: SubmitBody | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _owner(db, session_id, current_user.id)
    if body and body.answers:
        for a in body.answers:
            if a.answer is None or a.answer == "":
                continue
            answer = a.answer if isinstance(a.answer, dict) else {"value": a.answer}
            await _upsert_response(db, session_id, a.question_id, answer, a.time_spent_seconds, a.marked_for_review)

    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    await db.execute(
        text(
            """
            UPDATE exam_sessions
            SET status = 'SUBMITTED', submitted_at = :now, time_remaining_seconds = 0, updated_at = :now
            WHERE id = :id AND status = 'IN_PROGRESS'
            """
        ),
        {"id": session_id, "now": now},
    )
    result = await evaluate_session(db, session_id)
    return {"session": {"id": session_id, "status": "SUBMITTED"}, "result": result}


@router.post("/{session_id}/heartbeat")
async def heartbeat(
    session_id: str,
    body: SubmitBody | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    candidate_id, status = await _owner(db, session_id, current_user.id)
    if status == "PAUSED":
        row = await db.execute(
            text("SELECT time_remaining_seconds FROM exam_sessions WHERE id = :id"),
            {"id": session_id},
        )
        remaining = (row.mappings().first() or {}).get("time_remaining_seconds") or 0
        return {
            "alive": True,
            "paused": True,
            "autoSubmitted": False,
            "timeRemainingSeconds": remaining,
        }
    if status == "TERMINATED":
        return {
            "alive": False,
            "terminated": True,
            "autoSubmitted": False,
            "timeRemainingSeconds": 0,
        }
    if status != "IN_PROGRESS":
        result = await evaluate_session(db, session_id) if status in ("SUBMITTED", "AUTO_SUBMITTED") else None
        return {
            "alive": False,
            "autoSubmitted": status in ("SUBMITTED", "AUTO_SUBMITTED"),
            "timeRemainingSeconds": 0,
            "result": result,
        }

    if body and body.answers:
        for a in body.answers:
            if a.answer is None or a.answer == "":
                continue
            answer = a.answer if isinstance(a.answer, dict) else {"value": a.answer}
            await _upsert_response(db, session_id, a.question_id, answer, a.time_spent_seconds, a.marked_for_review)

    row = await db.execute(
        text(
            """
            SELECT es.started_at, e.settings, e.start_time, e.end_time
            FROM exam_sessions es JOIN exams e ON e.id = es.exam_id
            WHERE es.id = :id
            """
        ),
        {"id": session_id},
    )
    s = row.mappings().first()
    remaining = _time_remaining(
        s["started_at"],
        _duration_minutes(s["settings"], s["start_time"], s["end_time"]),
        s["end_time"],
    )
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc)
    await db.execute(
        text(
            """
            UPDATE exam_sessions
            SET time_remaining_seconds = :r, updated_at = :now
            WHERE id = :id
            """
        ),
        {"r": remaining, "id": session_id, "now": now},
    )
    if remaining <= 0:
        await db.execute(
            text(
                """
                UPDATE exam_sessions
                SET status = 'AUTO_SUBMITTED', submitted_at = :now, time_remaining_seconds = 0, updated_at = :now
                WHERE id = :id
                """
            ),
            {"id": session_id, "now": now},
        )
        await db.commit()
        result = await evaluate_session(db, session_id)
        return {"alive": False, "autoSubmitted": True, "timeRemainingSeconds": 0, "result": result}

    await db.commit()
    return {"alive": True, "autoSubmitted": False, "timeRemainingSeconds": remaining}
