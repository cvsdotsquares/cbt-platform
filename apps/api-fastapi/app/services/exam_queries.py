import json
import math
from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


def _parse_json(value):
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


async def list_exams(
    db: AsyncSession,
    tenant_id: str,
    page: int = 1,
    limit: int = 20,
    search: str = "",
    created_by_id: str | None = None,
    published_only: bool = False,
) -> dict:
    page = max(1, page)
    limit = max(1, min(limit, 100))
    offset = (page - 1) * limit
    params: dict = {"tenant_id": tenant_id, "limit": limit, "offset": offset}

    filters = ["e.tenant_id = :tenant_id"]
    if search.strip():
        params["search"] = f"%{search.strip().lower()}%"
        filters.append("(LOWER(e.title) LIKE :search OR LOWER(e.code) LIKE :search)")
    if created_by_id:
        params["created_by_id"] = created_by_id
        filters.append("e.created_by_id = :created_by_id")
    if published_only:
        filters.append("e.status IN ('PUBLISHED', 'COMPLETED')")

    where_sql = " AND ".join(filters)
    total = int(
        (
            await db.execute(
                text(f"SELECT COUNT(*) FROM exams e WHERE {where_sql}"),
                params,
            )
        ).scalar()
        or 0
    )

    rows = await db.execute(
        text(
            f"""
            SELECT e.id, e.title, e.code, e.type, e.status, e.start_time, e.end_time,
                   e.timezone, e.settings, e.published_at, e.created_at
            FROM exams e
            WHERE {where_sql}
            ORDER BY e.start_time DESC
            LIMIT :limit OFFSET :offset
            """
        ),
        params,
    )
    exams = rows.mappings().all()
    if not exams:
        return {
            "items": [],
            "total": total,
            "page": page,
            "limit": limit,
            "totalPages": math.ceil(total / limit) if total else 0,
        }

    exam_ids = [e["id"] for e in exams]

    sections_result = await db.execute(
        text(
            """
            SELECT es.id, es.exam_id, es.name, es.order_index, es.duration_minutes,
                   (SELECT COUNT(*) FROM exam_questions eq WHERE eq.section_id = es.id) AS question_count
            FROM exam_sections es
            WHERE es.exam_id = ANY(:exam_ids)
            ORDER BY es.order_index
            """
        ),
        {"exam_ids": exam_ids},
    )
    sections_by_exam: dict[str, list] = {}
    for s in sections_result.mappings():
        sections_by_exam.setdefault(str(s["exam_id"]), []).append(
            {
                "id": s["id"],
                "name": s["name"],
                "orderIndex": s["order_index"],
                "durationMinutes": s["duration_minutes"],
                "_count": {"questions": int(s["question_count"] or 0)},
            }
        )

    counts_result = await db.execute(
        text(
            """
            SELECT e.id AS exam_id,
                   (SELECT COUNT(*) FROM exam_registrations er WHERE er.exam_id = e.id) AS registrations,
                   (SELECT COUNT(*) FROM exam_sessions es WHERE es.exam_id = e.id) AS sessions,
                   (SELECT COUNT(*) FROM exam_results er2 WHERE er2.exam_id = e.id) AS results,
                   (SELECT COUNT(*) FROM (
                        SELECT candidate_id FROM exam_sessions es2 WHERE es2.exam_id = e.id
                        UNION
                        SELECT candidate_id FROM exam_results er3 WHERE er3.exam_id = e.id
                    ) attempted_students) AS attempted_students
            FROM exams e
            WHERE e.id = ANY(:exam_ids)
            """
        ),
        {"exam_ids": exam_ids},
    )
    counts_map = {
        str(r["exam_id"]): {
            "registrations": int(r["registrations"] or 0),
            "sessions": int(r["sessions"] or 0),
            "results": int(r["results"] or 0),
            "attemptedStudents": int(r["attempted_students"] or 0),
        }
        for r in counts_result.mappings()
    }

    configs_result = await db.execute(
        text(
            """
            SELECT atc.exam_id, atc.batch_id, atc.subject_id, atc.title,
                   b.name AS batch_name, b.academic_year,
                   ac.id AS class_id, ac.name AS class_name, ac.level AS class_level
            FROM ai_test_configs atc
            LEFT JOIN batches b ON b.id = atc.batch_id
            LEFT JOIN academic_classes ac ON ac.id = b.academic_class_id
            WHERE atc.exam_id = ANY(:exam_ids)
            """
        ),
        {"exam_ids": exam_ids},
    )
    config_map = {}
    for c in configs_result.mappings():
        config_map[str(c["exam_id"])] = {
            "batchId": c["batch_id"],
            "subjectId": c["subject_id"],
            "title": c["title"],
            "batch": (
                {
                    "id": c["batch_id"],
                    "name": c["batch_name"],
                    "academicYear": c["academic_year"],
                    "academicClass": {
                        "id": c["class_id"],
                        "name": c["class_name"],
                        "level": c["class_level"],
                    },
                }
                if c["batch_id"]
                else None
            ),
        }

    items = []
    for exam in exams:
        eid = str(exam["id"])
        items.append(
            {
                "id": eid,
                "title": exam["title"],
                "code": exam["code"],
                "type": exam["type"],
                "status": exam["status"],
                "startTime": exam["start_time"].isoformat() if exam["start_time"] else None,
                "endTime": exam["end_time"].isoformat() if exam["end_time"] else None,
                "timezone": exam["timezone"],
                "settings": _parse_json(exam["settings"]),
                "publishedAt": exam["published_at"].isoformat() if exam["published_at"] else None,
                "createdAt": exam["created_at"].isoformat() if exam["created_at"] else None,
                "sections": sections_by_exam.get(eid, []),
                "aiTestConfig": config_map.get(eid),
                "_count": counts_map.get(
                    eid,
                    {"registrations": 0, "sessions": 0, "results": 0, "attemptedStudents": 0},
                ),
            }
        )

    return {
        "items": items,
        "total": total,
        "page": page,
        "limit": limit,
        "totalPages": math.ceil(total / limit) if total else 0,
    }
