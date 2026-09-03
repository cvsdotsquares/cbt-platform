import json
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User

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
                WHERE pe.severity IN ('HIGH', 'CRITICAL') AND e.tenant_id = :tenant_id
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
                  SELECT er.id, er.total_score, er.max_score, er.percentage, er.created_at,
                         e.title AS exam_title, e.code AS exam_code,
                         u.first_name, u.last_name
                  FROM exam_results er
                  JOIN exams e ON e.id = er.exam_id
                  JOIN candidates c ON c.id = er.candidate_id
                  JOIN users u ON u.id = c.user_id
                  WHERE e.tenant_id = :tenant_id
                  ORDER BY er.created_at DESC
                  LIMIT 5
                ) t
              ) AS recent_submissions,
              (
                SELECT COALESCE(json_agg(t), '[]'::json)
                FROM (
                  SELECT pe.id, pe.event_type, pe.severity, pe.occurred_at,
                         e.title AS exam_title,
                         u.first_name, u.last_name
                  FROM proctoring_events pe
                  JOIN exam_sessions es ON es.id = pe.session_id
                  JOIN exams e ON e.id = es.exam_id
                  JOIN candidates c ON c.id = es.candidate_id
                  JOIN users u ON u.id = c.user_id
                  WHERE e.tenant_id = :tenant_id
                  ORDER BY pe.occurred_at DESC
                  LIMIT 5
                ) t
              ) AS recent_violations
            """
        ),
        {"tenant_id": tenant_id},
    )
    row = result.mappings().first() or {}

    upcoming = _rows(row.get("upcoming_exams"))
    submissions = _rows(row.get("recent_submissions"))
    violations = _rows(row.get("recent_violations"))

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
        "recentViolations": [
            {
                "id": r["id"],
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
            for r in violations
        ],
    }
