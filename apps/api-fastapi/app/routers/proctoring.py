from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user, require_permission
from app.models.user import User
from app.services.candidate_context import require_candidate_id
from app.services.live_feed_store import set_live_frame
from app.services.proctoring_service import get_event_detail, get_live_monitoring, intervene, record_event

router = APIRouter(prefix="/proctoring", tags=["Proctoring"])


class RecordEventBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    session_id: str = Field(..., alias="sessionId")
    event_type: str = Field(..., alias="eventType")
    severity: str | None = None
    confidence: float | None = None
    metadata: dict | None = None


class InterveneBody(BaseModel):
    type: str
    message: str | None = None


class LiveFrameBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    thumbnail: str
    source: Literal["screen", "camera"]


@router.post("/events")
async def report_proctoring_event(
    body: RecordEventBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("exam:take")),
):
    candidate_id = await require_candidate_id(db, current_user.id)
    row = await db.execute(
        text(
            """
            SELECT es.candidate_id FROM exam_sessions es WHERE es.id = :sid
            """
        ),
        {"sid": body.session_id},
    )
    session = row.mappings().first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if str(session["candidate_id"]) != str(candidate_id):
        raise HTTPException(status_code=403, detail="Session does not belong to this candidate")

    try:
        event = await record_event(
            db,
            body.session_id,
            body.event_type,
            severity=body.severity or "LOW",
            confidence=body.confidence,
            metadata=body.metadata,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    await db.commit()
    return event


@router.get("/events/{event_id}")
async def violation_event_detail(
    event_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_permission(
            ["proctoring:monitor", "analytics:view", "security:view_violations"],
        ),
    ),
):
    data = await get_event_detail(db, event_id, str(current_user.tenant_id))
    if data is None:
        raise HTTPException(status_code=404, detail="Violation not found")
    return data


@router.post("/sessions/{session_id}/live-frame")
async def upload_live_frame(
    session_id: str,
    body: LiveFrameBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("exam:take")),
):
    candidate_id = await require_candidate_id(db, current_user.id)
    row = await db.execute(
        text(
            """
            SELECT es.candidate_id, es.exam_id, es.status
            FROM exam_sessions es
            WHERE es.id = :sid
            """
        ),
        {"sid": session_id},
    )
    session = row.mappings().first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if str(session["candidate_id"]) != str(candidate_id):
        raise HTTPException(status_code=403, detail="Session does not belong to this candidate")
    if session["status"] not in ("IN_PROGRESS", "PAUSED"):
        raise HTTPException(status_code=400, detail="Session is not active")

    try:
        await set_live_frame(session_id, str(session["exam_id"]), body.source, body.thumbnail)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    return {"ok": True}


@router.get("/sessions/{exam_id}/live-feeds")
async def exam_live_feeds(
    exam_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("proctoring:monitor")),
):
    from app.services.live_feed_store import get_exam_feeds

    exam_row = await db.execute(
        text("SELECT id FROM exams WHERE id = :eid AND tenant_id = :tid"),
        {"eid": exam_id, "tid": str(current_user.tenant_id)},
    )
    if not exam_row.mappings().first():
        raise HTTPException(status_code=404, detail="Exam not found")

    session_rows = await db.execute(
        text(
            """
            SELECT es.id FROM exam_sessions es
            WHERE es.exam_id = :eid AND es.status IN ('IN_PROGRESS', 'PAUSED')
            """
        ),
        {"eid": exam_id},
    )
    session_ids = [str(r["id"]) for r in session_rows.mappings()]
    feeds = await get_exam_feeds(exam_id, session_ids)
    return {"examId": exam_id, "feeds": feeds}


@router.get("/sessions/{exam_id}/live")
async def live_monitoring(
    exam_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("proctoring:monitor")),
):
    data = await get_live_monitoring(db, exam_id, str(current_user.tenant_id))
    if data is None:
        raise HTTPException(status_code=404, detail="Exam not found")
    return data


@router.post("/sessions/{session_id}/intervene")
async def proctor_intervene(
    session_id: str,
    body: InterveneBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("proctoring:intervene")),
):
    row = await db.execute(
        text(
            """
            SELECT e.tenant_id FROM exam_sessions es
            JOIN exams e ON e.id = es.exam_id
            WHERE es.id = :sid
            """
        ),
        {"sid": session_id},
    )
    session = row.mappings().first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if str(session["tenant_id"]) != str(current_user.tenant_id):
        raise HTTPException(status_code=403, detail="Session not in your organization")

    try:
        result = await intervene(db, session_id, body.type, body.message)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    if not result:
        raise HTTPException(status_code=404, detail="Session not found")

    await db.commit()
    return result
