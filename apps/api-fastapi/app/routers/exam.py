import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.exam import Exam
from app.models.user import User
from app.schemas.exam import ExamCreate, ExamResponse
from app.services.exam_detail import get_exam_detail
from app.services.exam_queries import list_exams
from app.services.candidate_context import (
    assert_exam_visible_to_candidate,
    parse_json,
    require_candidate_id,
)

router = APIRouter(prefix="/exams", tags=["exams"])


class ScheduleUpdate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    start_time: str = Field(..., alias="startTime")
    end_time: str = Field(..., alias="endTime")
    timezone: str | None = None
    duration_minutes: int | None = Field(None, alias="durationMinutes")


class CandidateIdsBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    candidate_ids: list[str] = Field(default_factory=list, alias="candidateIds")


def _teacher_filter(user: User) -> str | None:
    role_names = {
        ur.role.name
        for ur in (user.user_roles or [])
        if ur.role and ur.role.name
    }
    admin_roles = {"ORG_ADMIN", "SUPER_ADMIN", "ADMIN"}
    if "TEACHER" in role_names and not role_names.intersection(admin_roles):
        return user.id
    return None


async def _get_exam_row(db: AsyncSession, exam_id: str, tenant_id: str):
    row = await db.execute(
        text(
            """
            SELECT id, title, status, settings, timezone, start_time, end_time
            FROM exams WHERE id = :id AND tenant_id = :tenant_id
            """
        ),
        {"id": exam_id, "tenant_id": tenant_id},
    )
    return row.mappings().first()


@router.get("")
@router.get("/")
async def get_exams(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    search: str = Query(""),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return await list_exams(
        db,
        current_user.tenant_id,
        page=page,
        limit=limit,
        search=search,
        created_by_id=_teacher_filter(current_user),
    )


@router.get("/my/available")
async def my_available_exams(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    candidate_row = await db.execute(
        text("SELECT id FROM candidates WHERE user_id = :user_id LIMIT 1"),
        {"user_id": current_user.id},
    )
    candidate = candidate_row.scalar_one_or_none()
    if not candidate:
        raise HTTPException(
            status_code=400,
            detail="Candidate profile not found. Please complete registration.",
        )

    rows = await db.execute(
        text(
            """
            SELECT
              er.id AS registration_id,
              er.exam_id,
              er.registered_at,
              e.title, e.code, e.status, e.start_time, e.end_time, e.timezone, e.settings,
              es.id AS session_id,
              es.status AS session_status,
              es.submitted_at AS session_submitted_at
            FROM exam_registrations er
            JOIN exams e ON e.id = er.exam_id
            LEFT JOIN LATERAL (
              SELECT ses.id, ses.status, ses.submitted_at
              FROM exam_sessions ses
              WHERE ses.registration_id = er.id
              ORDER BY ses.created_at DESC
              LIMIT 1
            ) es ON true
            WHERE er.candidate_id = :candidate_id
              AND e.status IN ('PUBLISHED', 'IN_PROGRESS', 'COMPLETED')
            ORDER BY er.registered_at DESC
            """
        ),
        {"candidate_id": candidate},
    )

    items = []
    for r in rows.mappings():
        settings = r["settings"]
        if isinstance(settings, str):
            settings = json.loads(settings) if settings else {}
        exam = {
            "id": r["exam_id"],
            "title": r["title"],
            "code": r["code"],
            "status": r["status"],
            "startTime": r["start_time"].isoformat() if r["start_time"] else None,
            "endTime": r["end_time"].isoformat() if r["end_time"] else None,
            "timezone": r["timezone"],
            "settings": settings,
        }
        sessions = []
        if r["session_id"]:
            sessions.append(
                {
                    "id": r["session_id"],
                    "status": r["session_status"],
                    "submittedAt": r["session_submitted_at"].isoformat()
                    if r["session_submitted_at"]
                    else None,
                }
            )
        items.append(
            {
                "id": r["registration_id"],
                "examId": r["exam_id"],
                "registeredAt": r["registered_at"].isoformat() if r["registered_at"] else None,
                "exam": exam,
                "sessions": sessions,
            }
        )
    return items


@router.get("/{exam_id}/instructions")
async def exam_instructions(
    exam_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    candidate_id = await require_candidate_id(db, current_user.id)
    row = await db.execute(
        text(
            """
            SELECT
              er.id AS registration_id,
              e.id, e.title, e.code, e.status, e.start_time, e.end_time, e.timezone,
              e.settings, e.security_policy,
              es.id AS session_id, es.status AS session_status
            FROM exam_registrations er
            JOIN exams e ON e.id = er.exam_id
            LEFT JOIN LATERAL (
              SELECT ses.id, ses.status
              FROM exam_sessions ses
              WHERE ses.registration_id = er.id
              ORDER BY ses.created_at DESC
              LIMIT 1
            ) es ON true
            WHERE er.exam_id = :exam_id AND er.candidate_id = :candidate_id
            """
        ),
        {"exam_id": exam_id, "candidate_id": candidate_id},
    )
    reg = row.mappings().first()
    if not reg:
        raise HTTPException(status_code=404, detail="Not registered for this exam")
    assert_exam_visible_to_candidate(reg["status"])

    sessions = []
    if reg["session_id"]:
        sessions.append({"id": reg["session_id"], "status": reg["session_status"]})

    return {
        "id": reg["id"],
        "title": reg["title"],
        "code": reg["code"],
        "status": reg["status"],
        "startTime": reg["start_time"].isoformat() if reg["start_time"] else None,
        "endTime": reg["end_time"].isoformat() if reg["end_time"] else None,
        "timezone": reg["timezone"],
        "settings": parse_json(reg["settings"]),
        "securityPolicy": parse_json(reg["security_policy"]),
        "registration": {
            "id": reg["registration_id"],
            "sessions": sessions,
        },
    }


@router.get("/{exam_id}")
async def get_exam(
    exam_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    exam = await get_exam_detail(db, exam_id, current_user.tenant_id)
    if not exam:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Exam not found")
    return exam


@router.post("/", response_model=dict, status_code=status.HTTP_201_CREATED)
async def create_exam(
    exam_data: ExamCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    new_exam = Exam(
        id=uuid.uuid4(),
        title=exam_data.title,
        description=exam_data.description,
        code=exam_data.code,
        status=exam_data.status,
        start_time=exam_data.starts_at,
        end_time=exam_data.ends_at,
        tenant_id=current_user.tenant_id,
        created_by_id=current_user.id,
    )
    db.add(new_exam)
    try:
        await db.commit()
        await db.refresh(new_exam)
        exam_dict = ExamResponse.model_validate(new_exam).model_dump()
        return {"success": True, "data": exam_dict, "statusCode": 201}
    except Exception:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create exam",
        )


@router.post("/{exam_id}/publish")
async def publish_exam(
    exam_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    exam = await _get_exam_row(db, exam_id, current_user.tenant_id)
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")

    counts = await db.execute(
        text(
            """
            SELECT
              (SELECT COUNT(*) FROM exam_questions WHERE exam_id = :exam_id) AS questions,
              (SELECT COUNT(*) FROM exam_registrations WHERE exam_id = :exam_id) AS registrations
            """
        ),
        {"exam_id": exam_id},
    )
    c = counts.mappings().first()
    if int(c["questions"] or 0) == 0:
        raise HTTPException(status_code=400, detail="Add at least one approved question before publishing")
    if int(c["registrations"] or 0) == 0:
        raise HTTPException(status_code=400, detail="Assign at least one candidate before publishing")

    now = datetime.now(timezone.utc)
    settings = exam["settings"]
    if isinstance(settings, str):
        settings = json.loads(settings) if settings else {}
    settings = settings or {}
    duration_minutes = int(settings.get("durationMinutes") or 60)
    publish_start = now
    publish_end = now + timedelta(minutes=duration_minutes)

    await db.execute(
        text(
            """
            UPDATE questions
            SET status = 'APPROVED', updated_at = :now
            WHERE id IN (SELECT question_id FROM exam_questions WHERE exam_id = :exam_id)
              AND status = 'DRAFT'
            """
        ),
        {"exam_id": exam_id, "now": now},
    )
    await db.execute(
        text(
            """
            UPDATE exams
            SET status = 'PUBLISHED', published_at = :now, updated_at = :now,
                start_time = :start_time, end_time = :end_time
            WHERE id = :exam_id AND tenant_id = :tenant_id
            """
        ),
        {
            "exam_id": exam_id,
            "tenant_id": current_user.tenant_id,
            "now": now,
            "start_time": publish_start,
            "end_time": publish_end,
        },
    )
    return await get_exam_detail(db, exam_id, current_user.tenant_id)


@router.patch("/{exam_id}/schedule")
async def update_schedule(
    exam_id: str,
    body: ScheduleUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    exam = await _get_exam_row(db, exam_id, current_user.tenant_id)
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")
    if exam["status"] == "COMPLETED":
        raise HTTPException(status_code=400, detail="Cannot edit schedule of a completed exam")

    existing = exam["settings"]
    if isinstance(existing, str):
        existing = json.loads(existing) if existing else {}
    existing = existing or {}
    if body.duration_minutes:
        existing["durationMinutes"] = body.duration_minutes

    start = datetime.fromisoformat(body.start_time.replace("Z", "+00:00"))
    end = datetime.fromisoformat(body.end_time.replace("Z", "+00:00"))
    tz = body.timezone or exam["timezone"] or "UTC"
    now = datetime.now(timezone.utc)

    await db.execute(
        text(
            """
            UPDATE exams
            SET start_time = :start_time, end_time = :end_time, timezone = :timezone,
                settings = CAST(:settings AS jsonb), updated_at = :now
            WHERE id = :exam_id AND tenant_id = :tenant_id
            """
        ),
        {
            "exam_id": exam_id,
            "tenant_id": current_user.tenant_id,
            "start_time": start,
            "end_time": end,
            "timezone": tz,
            "settings": json.dumps(existing),
            "now": now,
        },
    )
    return await get_exam_detail(db, exam_id, current_user.tenant_id)


@router.post("/{exam_id}/candidates")
async def assign_candidates(
    exam_id: str,
    body: CandidateIdsBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    exam = await _get_exam_row(db, exam_id, current_user.tenant_id)
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")

    now = datetime.now(timezone.utc)
    added = 0
    skipped = 0
    for candidate_id in body.candidate_ids:
        check = await db.execute(
            text("SELECT id FROM candidates WHERE id = :id AND tenant_id = :tenant_id"),
            {"id": candidate_id, "tenant_id": current_user.tenant_id},
        )
        if not check.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="One or more candidates are invalid for this tenant")
        existing = await db.execute(
            text(
                "SELECT id FROM exam_registrations WHERE exam_id = :exam_id AND candidate_id = :candidate_id"
            ),
            {"exam_id": exam_id, "candidate_id": candidate_id},
        )
        if existing.scalar_one_or_none():
            skipped += 1
            continue
        await db.execute(
            text(
                """
                INSERT INTO exam_registrations (id, exam_id, candidate_id, status, registered_at)
                VALUES (:id, :exam_id, :candidate_id, 'REGISTERED', :now)
                """
            ),
            {
                "id": str(uuid.uuid4()),
                "exam_id": exam_id,
                "candidate_id": candidate_id,
                "now": now,
            },
        )
        added += 1
    return {"count": added, "skipped": skipped}


@router.put("/{exam_id}/candidates")
async def sync_candidates(
    exam_id: str,
    body: CandidateIdsBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    exam = await _get_exam_row(db, exam_id, current_user.tenant_id)
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")
    if exam["status"] != "DRAFT":
        raise HTTPException(status_code=400, detail="Can only sync candidates on draft exams")

    desired = set(body.candidate_ids)
    current_rows = await db.execute(
        text("SELECT candidate_id FROM exam_registrations WHERE exam_id = :exam_id"),
        {"exam_id": exam_id},
    )
    current = {r[0] for r in current_rows.all()}
    to_remove = current - desired
    to_add = desired - current
    now = datetime.now(timezone.utc)

    for cid in to_remove:
        await db.execute(
            text("DELETE FROM exam_registrations WHERE exam_id = :exam_id AND candidate_id = :candidate_id"),
            {"exam_id": exam_id, "candidate_id": cid},
        )
    added = 0
    for cid in to_add:
        await db.execute(
            text(
                """
                INSERT INTO exam_registrations (id, exam_id, candidate_id, status, registered_at)
                VALUES (:id, :exam_id, :candidate_id, 'REGISTERED', :now)
                """
            ),
            {"id": str(uuid.uuid4()), "exam_id": exam_id, "candidate_id": cid, "now": now},
        )
        added += 1
    return {"assigned": len(desired), "added": added, "removed": len(to_remove)}


@router.put("/{exam_id}")
async def update_exam(
    exam_id: str,
    exam_data: ExamCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Any:
    result = await db.execute(select(Exam).where(Exam.id == exam_id, Exam.tenant_id == current_user.tenant_id))
    exam = result.scalar_one_or_none()
    if not exam:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Exam not found")

    exam.title = exam_data.title
    exam.description = exam_data.description
    exam.code = exam_data.code
    exam.status = exam_data.status
    exam.start_time = exam_data.starts_at
    exam.end_time = exam_data.ends_at
    try:
        await db.commit()
        await db.refresh(exam)
    except Exception:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to update exam")
    return {"success": True, "data": exam}


@router.delete("/{exam_id}")
async def delete_exam(
    exam_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    exam = await _get_exam_row(db, exam_id, current_user.tenant_id)
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")

    session_count = await db.execute(
        text("SELECT COUNT(*) FROM exam_sessions WHERE exam_id::text = :exam_id"),
        {"exam_id": exam_id},
    )
    if int(session_count.scalar() or 0) > 0:
        raise HTTPException(status_code=400, detail="Cannot delete: candidates have taken this exam")

    params = {"exam_id": exam_id, "tenant_id": str(current_user.tenant_id)}
    await db.execute(text("DELETE FROM exam_questions WHERE exam_id::text = :exam_id"), params)
    await db.execute(text("DELETE FROM exam_sections WHERE exam_id::text = :exam_id"), params)
    await db.execute(text("DELETE FROM exam_registrations WHERE exam_id::text = :exam_id"), params)
    await db.execute(text("DELETE FROM exam_results WHERE exam_id::text = :exam_id"), params)
    await db.execute(text("DELETE FROM ai_test_configs WHERE exam_id::text = :exam_id"), params)
    await db.execute(
        text("DELETE FROM exams WHERE id::text = :exam_id AND tenant_id::text = :tenant_id"),
        params,
    )
    return {"deleted": True}


@router.delete("/{exam_id}/questions/{question_id}")
async def remove_exam_question(
    exam_id: str,
    question_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    exam = await _get_exam_row(db, exam_id, current_user.tenant_id)
    if not exam:
        raise HTTPException(status_code=404, detail="Exam not found")

    result = await db.execute(
        text(
            "DELETE FROM exam_questions WHERE exam_id = :exam_id AND question_id = :question_id RETURNING id"
        ),
        {"exam_id": exam_id, "question_id": question_id},
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Question not linked to this exam")
    return await get_exam_detail(db, exam_id, current_user.tenant_id)
