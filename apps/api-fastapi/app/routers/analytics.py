import json
from typing import Any

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.services.proctoring_service import get_event_detail

router = APIRouter(prefix="/analytics", tags=["Analytics"])


def _violation_label(event_type: str) -> str:
    labels = {
        "NO_FACE": "No face detected",
        "MULTIPLE_FACES": "Multiple faces detected",
        "FACE_MISMATCH": "Face mismatch",
        "LOOKING_AWAY": "Candidate looked away",
        "HEAD_TURNED": "Head turned from screen",
        "PHONE_DETECTED": "Phone detected",
        "AUDIO_ANOMALY": "Audio anomaly",
        "TAB_SWITCH": "Tab switch detected",
        "WINDOW_BLUR": "Window lost focus",
        "COPY_PASTE": "Copy/paste attempt",
        "RIGHT_CLICK": "Right-click blocked",
        "FULLSCREEN_EXIT": "Exited fullscreen",
        "MULTIPLE_MONITORS": "Multiple monitors detected",
    }
    return labels.get(event_type, event_type.replace("_", " ").lower())


def _iso(value: Any) -> str | None:
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def _rows(value: Any) -> list[dict[str, Any]]:
    if value is None:
        return []
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            return []
    if isinstance(value, list):
        return [row for row in value if isinstance(row, dict)]
    return []


@router.get("/violations/{event_id}")
async def violation_detail(
    event_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Violation drill-down for dashboard integrity alerts (same tenant scope as dashboard)."""
    data = await get_event_detail(db, event_id, str(current_user.tenant_id))
    if data is None:
        raise HTTPException(status_code=404, detail="Violation not found")
    return data


@router.get("/dashboard")
async def dashboard_stats(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tenant_id = current_user.tenant_id

    result = await db.execute(
        text(
            """
            SELECT
              (SELECT COUNT(*) FROM exams WHERE tenant_id = :tenant_id) AS total_exams,
              (SELECT COUNT(*) FROM exams WHERE tenant_id = :tenant_id AND status = 'PUBLISHED') AS published_exams,
              (SELECT COUNT(*) FROM candidates WHERE tenant_id = :tenant_id) AS total_candidates,
              (SELECT COUNT(*) FROM questions WHERE tenant_id = :tenant_id) AS total_questions,
              (
                SELECT COUNT(*)
                FROM exam_sessions es
                JOIN exams e ON e.id = es.exam_id
                WHERE es.status = 'IN_PROGRESS' AND e.tenant_id = :tenant_id
              ) AS active_sessions,
              (
                SELECT COUNT(*)
                FROM proctoring_events pe
                JOIN exam_sessions es ON es.id = pe.session_id
                JOIN exams e ON e.id = es.exam_id
                WHERE pe.severity IN ('HIGH', 'CRITICAL')
                  AND e.tenant_id = :tenant_id
                  AND NOT COALESCE((pe.metadata->>'dismissed')::boolean, false)
              ) AS violation_alerts,
              (
                SELECT COALESCE(json_agg(t), '[]'::json)
                FROM (
                  SELECT e.id, e.title, e.code, e.start_time, e.end_time, e.timezone,
                         (SELECT COUNT(*) FROM exam_registrations er WHERE er.exam_id = e.id) AS registrations
                  FROM exams e
                  WHERE e.tenant_id = :tenant_id
                    AND e.status IN ('PUBLISHED', 'SCHEDULED')
                    AND e.end_time >= NOW()
                  ORDER BY e.start_time ASC
                  LIMIT 5
                ) t
              ) AS upcoming_exams,
                            (
                                SELECT COALESCE(json_agg(t), '[]'::json)
                                FROM (
                                    SELECT e.id, e.title, e.code, e.start_time, e.end_time, e.timezone,
                                                 (SELECT COUNT(*) FROM exam_registrations er WHERE er.exam_id = e.id) AS registrations
                                    FROM exams e
                                    WHERE e.tenant_id = :tenant_id
                                        AND e.status IN ('PUBLISHED', 'SCHEDULED')
                                        AND e.end_time < NOW()
                                    ORDER BY e.start_time DESC
                                    LIMIT 5
                                ) t
                            ) AS previous_exams,
              (
                SELECT COALESCE(json_agg(t), '[]'::json)
                FROM (
                  SELECT e.id, e.title, e.code, e.status, e.start_time, e.end_time, e.timezone,
                         (SELECT COUNT(*) FROM exam_registrations er WHERE er.exam_id = e.id) AS registrations
                  FROM exams e
                  WHERE e.tenant_id = :tenant_id
                    AND e.status IN ('DRAFT', 'PUBLISHED', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED')
                    AND e.start_time >= (NOW() - INTERVAL '120 days')
                  ORDER BY e.start_time ASC
                  LIMIT 200
                ) t
              ) AS calendar_exams,
              (
                SELECT COALESCE(json_agg(t), '[]'::json)
                FROM (
                  SELECT er.id, er.total_score, er.max_score, er.percentage, er.created_at,
                         e.title AS exam_title, e.code AS exam_code,
                         u.first_name, u.last_name
                  FROM exam_results er
                  JOIN exams e ON e.id = er.exam_id
                  JOIN candidates c ON c.id = er.candidate_id
                  JOIN users u ON u.id = c.user_id
                  WHERE e.tenant_id = :tenant_id
                  ORDER BY er.created_at DESC
                  LIMIT 20
                ) t
              ) AS recent_submissions,
              (
                SELECT COALESCE(json_agg(t), '[]'::json)
                FROM (
                  SELECT pe.id, pe.event_type, pe.severity, pe.occurred_at,
                         es.id AS session_id, e.id AS exam_id, e.title AS exam_title,
                         u.first_name, u.last_name
                  FROM proctoring_events pe
                  JOIN exam_sessions es ON es.id = pe.session_id
                  JOIN exams e ON e.id = es.exam_id
                  JOIN candidates c ON c.id = es.candidate_id
                  JOIN users u ON u.id = c.user_id
                  WHERE e.tenant_id = :tenant_id
                    AND pe.severity IN ('HIGH', 'CRITICAL')
                    AND NOT COALESCE((pe.metadata->>'dismissed')::boolean, false)
                  ORDER BY pe.occurred_at DESC
                  LIMIT 5
                ) t
              ) AS recent_violations,
              (
                SELECT COALESCE(json_agg(t), '[]'::json)
                FROM (
                  SELECT pe.id, pe.event_type, pe.severity, pe.occurred_at,
                         es.id AS session_id, e.id AS exam_id, e.title AS exam_title,
                         u.first_name, u.last_name
                  FROM proctoring_events pe
                  JOIN exam_sessions es ON es.id = pe.session_id
                  JOIN exams e ON e.id = es.exam_id
                  JOIN candidates c ON c.id = es.candidate_id
                  JOIN users u ON u.id = c.user_id
                  WHERE e.tenant_id = :tenant_id
                    AND COALESCE((pe.metadata->>'dismissed')::boolean, false)
                  ORDER BY pe.occurred_at DESC
                  LIMIT 20
                ) t
              ) AS cleared_violations,
              (
                SELECT COALESCE(json_agg(t), '[]'::json)
                FROM (
                  SELECT c.id, c.updated_at,
                         u.first_name, u.last_name, u.email
                  FROM candidates c
                  JOIN users u ON u.id = c.user_id
                  WHERE c.tenant_id = :tenant_id AND c.kyc_status = 'PENDING'
                  ORDER BY c.updated_at DESC
                  LIMIT 5
                ) t
              ) AS kyc_pending,
              (
                SELECT COALESCE(json_agg(t), '[]'::json)
                FROM (
                  SELECT c.id, c.created_at,
                         u.first_name, u.last_name, u.email,
                         ac.id AS academic_class_id,
                         ac.level AS class_level,
                         ac.name AS class_name,
                         b.name AS batch_name
                  FROM candidates c
                  JOIN users u ON u.id = c.user_id
                  LEFT JOIN LATERAL (
                    SELECT be.batch_id
                    FROM batch_enrollments be
                    WHERE be.candidate_id = c.id
                    ORDER BY be.enrolled_at ASC
                    LIMIT 1
                  ) primary_be ON true
                  LEFT JOIN batches b ON b.id = primary_be.batch_id
                  LEFT JOIN academic_classes ac ON ac.id = b.academic_class_id
                  WHERE c.tenant_id = :tenant_id
                  ORDER BY c.created_at DESC
                  LIMIT 5
                ) t
              ) AS new_students,
              (
                SELECT COALESCE(json_agg(t), '[]'::json)
                FROM (
                  SELECT e.id, e.title, e.code, e.status, e.created_at
                  FROM exams e
                  WHERE e.tenant_id = :tenant_id
                  ORDER BY e.created_at DESC
                  LIMIT 5
                ) t
              ) AS tests_created
            """
        ),
        {"tenant_id": tenant_id},
    )
    row = result.mappings().first() or {}

    upcoming = _rows(row.get("upcoming_exams"))
    previous = _rows(row.get("previous_exams"))
    calendar = _rows(row.get("calendar_exams"))
    submissions = _rows(row.get("recent_submissions"))
    violations = _rows(row.get("recent_violations"))
    cleared = _rows(row.get("cleared_violations"))
    kyc_pending = _rows(row.get("kyc_pending"))
    new_students = _rows(row.get("new_students"))
    tests_created = _rows(row.get("tests_created"))

    recent_violations_out: list[dict[str, Any]] = []
    for r in violations:
        event_id = str(r["id"])
        item: dict[str, Any] = {
            "id": event_id,
            "sessionId": str(r["session_id"]) if r.get("session_id") else None,
            "examId": str(r["exam_id"]) if r.get("exam_id") else None,
            "eventType": r.get("event_type"),
            "label": _violation_label(r.get("event_type") or ""),
            "severity": r.get("severity"),
            "candidateName": f"{r.get('first_name') or ''} {r.get('last_name') or ''}".strip(),
            "examTitle": r.get("exam_title"),
            "occurredAt": _iso(r.get("occurred_at")),
            "message": (
                f"{_violation_label(r.get('event_type') or '')} during {r.get('exam_title')}"
            ),
        }
        recent_violations_out.append(item)

    cleared_violations_out: list[dict[str, Any]] = []
    for r in cleared:
        cleared_violations_out.append(
            {
                "id": str(r["id"]),
                "sessionId": str(r["session_id"]) if r.get("session_id") else None,
                "examId": str(r["exam_id"]) if r.get("exam_id") else None,
                "eventType": r.get("event_type"),
                "label": _violation_label(r.get("event_type") or ""),
                "severity": r.get("severity"),
                "candidateName": f"{r.get('first_name') or ''} {r.get('last_name') or ''}".strip(),
                "examTitle": r.get("exam_title"),
                "occurredAt": _iso(r.get("occurred_at")),
            }
        )

    return {
        "stats": {
            "totalExams": int(row.get("total_exams") or 0),
            "publishedExams": int(row.get("published_exams") or 0),
            "totalCandidates": int(row.get("total_candidates") or 0),
            "totalQuestions": int(row.get("total_questions") or 0),
            "activeSessions": int(row.get("active_sessions") or 0),
            "violationAlerts": int(row.get("violation_alerts") or 0),
        },
        "upcomingExams": [
            {
                "id": r["id"],
                "title": r["title"],
                "code": r["code"],
                "startTime": _iso(r.get("start_time")),
                "endTime": _iso(r.get("end_time")),
                "timezone": r.get("timezone"),
                "_count": {"registrations": int(r.get("registrations") or 0)},
            }
            for r in upcoming
        ],
        "previousExams": [
            {
                "id": r["id"],
                "title": r["title"],
                "code": r["code"],
                "startTime": _iso(r.get("start_time")),
                "endTime": _iso(r.get("end_time")),
                "timezone": r.get("timezone"),
                "_count": {"registrations": int(r.get("registrations") or 0)},
            }
            for r in previous
        ],
        "calendarExams": [
            {
                "id": r["id"],
                "title": r["title"],
                "code": r["code"],
                "status": r.get("status"),
                "startTime": _iso(r.get("start_time")),
                "endTime": _iso(r.get("end_time")),
                "timezone": r.get("timezone"),
                "_count": {"registrations": int(r.get("registrations") or 0)},
            }
            for r in calendar
        ],
        "recentSubmissions": [
            {
                "id": r["id"],
                "candidateName": f"{r.get('first_name') or ''} {r.get('last_name') or ''}".strip(),
                "examTitle": r.get("exam_title"),
                "examCode": r.get("exam_code"),
                "score": r.get("total_score"),
                "maxScore": r.get("max_score"),
                "percentage": r.get("percentage"),
                "submittedAt": _iso(r.get("created_at")),
                "message": (
                    f"{r.get('first_name') or ''} {r.get('last_name') or ''}".strip()
                    + f" submitted {r.get('exam_title')}"
                ),
            }
            for r in submissions
        ],
        "recentViolations": recent_violations_out,
        "clearedViolations": cleared_violations_out,
        "notificationFeed": {
            "kycPending": [
                {
                    "id": r["id"],
                    "candidateName": f"{r.get('first_name') or ''} {r.get('last_name') or ''}".strip(),
                    "email": r.get("email"),
                    "submittedAt": _iso(r.get("updated_at")),
                }
                for r in kyc_pending
            ],
            "newStudents": [
                {
                    "id": r["id"],
                    "candidateName": f"{r.get('first_name') or ''} {r.get('last_name') or ''}".strip(),
                    "email": r.get("email"),
                    "registeredAt": _iso(r.get("created_at")),
                    "academicClassId": str(r["academic_class_id"]) if r.get("academic_class_id") else None,
                    "classLevel": int(r["class_level"]) if r.get("class_level") is not None else None,
                    "className": r.get("class_name"),
                    "batchName": r.get("batch_name"),
                }
                for r in new_students
            ],
            "testsCreated": [
                {
                    "id": r["id"],
                    "title": r.get("title"),
                    "code": r.get("code"),
                    "status": r.get("status"),
                    "createdAt": _iso(r.get("created_at")),
                }
                for r in tests_created
            ],
        },
    }


def _parse_instant(value: str, param: str) -> datetime:
    raw = value.strip()
    if not raw:
        raise HTTPException(status_code=400, detail=f"Missing {param}")
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid {param}") from exc
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _map_submission_rows(submissions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "id": r["id"],
            "candidateName": f"{r.get('first_name') or ''} {r.get('last_name') or ''}".strip(),
            "examTitle": r.get("exam_title"),
            "examCode": r.get("exam_code"),
            "score": r.get("total_score"),
            "maxScore": r.get("max_score"),
            "percentage": r.get("percentage"),
            "submittedAt": _iso(r.get("created_at")),
            "message": (
                f"{r.get('first_name') or ''} {r.get('last_name') or ''}".strip()
                + f" submitted {r.get('exam_title')}"
            ),
        }
        for r in submissions
    ]


@router.get("/dashboard/submissions")
async def dashboard_submissions_for_day(
    from_: str = Query(..., alias="from"),
    to: str = Query(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """All exam results submitted in [from, to) — bounds from the user's local calendar day."""
    start = _parse_instant(from_, "from")
    end = _parse_instant(to, "to")
    if end <= start:
        raise HTTPException(status_code=400, detail="'to' must be after 'from'")

    tenant_id = current_user.tenant_id
    result = await db.execute(
        text(
            """
            SELECT er.id, er.total_score, er.max_score, er.percentage, er.created_at,
                   e.title AS exam_title, e.code AS exam_code,
                   u.first_name, u.last_name
            FROM exam_results er
            JOIN exams e ON e.id = er.exam_id
            JOIN candidates c ON c.id = er.candidate_id
            JOIN users u ON u.id = c.user_id
            WHERE e.tenant_id = :tenant_id
              AND er.created_at >= :start_at
              AND er.created_at < :end_at
            ORDER BY er.created_at DESC
            LIMIT 200
            """
        ),
        {"tenant_id": tenant_id, "start_at": start, "end_at": end},
    )
    rows = [dict(r) for r in result.mappings().all()]
    return _map_submission_rows(rows)


async def _set_violation_dismissed(
    db: AsyncSession, tenant_id: str, event_id: str | None, dismissed: bool
) -> int:
    event_clause = "AND pe.id::text = :event_id" if event_id else ""
    params: dict[str, object] = {
        "tenant_id": tenant_id,
        "dismissed_bool": dismissed,
    }
    if event_id:
        params["event_id"] = event_id
    result = await db.execute(
        text(
            f"""
            UPDATE proctoring_events pe
            SET metadata = COALESCE(pe.metadata, '{{}}'::jsonb)
              || jsonb_build_object('dismissed', CAST(:dismissed_bool AS boolean))
            FROM exam_sessions es
            JOIN exams e ON e.id = es.exam_id
            WHERE pe.session_id = es.id
              AND e.tenant_id = :tenant_id
              {event_clause}
            """
        ),
        params,
    )
    return int(result.rowcount or 0)


async def _purge_dismissed_violations(
    db: AsyncSession, tenant_id: str, event_id: str | None = None
) -> int:
    event_clause = "AND pe.id::text = :event_id" if event_id else ""
    params: dict[str, object] = {"tenant_id": tenant_id}
    if event_id:
        params["event_id"] = event_id
    result = await db.execute(
        text(
            f"""
            DELETE FROM proctoring_events pe
            USING exam_sessions es, exams e
            WHERE pe.session_id = es.id
              AND es.exam_id = e.id
              AND e.tenant_id = :tenant_id
              AND COALESCE((pe.metadata->>'dismissed')::boolean, false) = true
              {event_clause}
            """
        ),
        params,
    )
    return int(result.rowcount or 0)


@router.post("/violations/dismiss-all")
async def dismiss_all_violations(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    count = await _set_violation_dismissed(db, str(current_user.tenant_id), None, True)
    await db.commit()
    return {"cleared": count}


@router.post("/violations/purge-recycle-bin")
@router.post("/violations/recycle-bin/purge-all")
async def purge_recycle_bin_violations(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Permanently delete all dismissed (recycle bin) integrity alerts for this tenant."""
    count = await _purge_dismissed_violations(db, str(current_user.tenant_id), None)
    await db.commit()
    return {"deleted": count}


@router.post("/violations/{event_id}/dismiss")
async def dismiss_violation(
    event_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    count = await _set_violation_dismissed(db, str(current_user.tenant_id), event_id, True)
    if count == 0:
        raise HTTPException(status_code=404, detail="Violation not found")
    await db.commit()
    return {"dismissed": True}


@router.post("/violations/{event_id}/restore")
async def restore_violation(
    event_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    count = await _set_violation_dismissed(db, str(current_user.tenant_id), event_id, False)
    if count == 0:
        raise HTTPException(status_code=404, detail="Violation not found")
    await db.commit()
    return {"restored": True}
