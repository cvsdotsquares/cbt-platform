from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.models.curriculum import Chapter
from app.services.chapter_titles import resolve_chapter_title

router = APIRouter(prefix="/learning", tags=["Learning"])


@router.get("/student/dashboard")
async def student_dashboard(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    candidate_row = await db.execute(
        text("SELECT id FROM candidates WHERE user_id = :user_id LIMIT 1"),
        {"user_id": current_user.id},
    )
    candidate_id = candidate_row.scalar_one_or_none()
    if not candidate_id:
        return {"error": "Student profile not found"}

    candidate = await db.execute(
        text(
            """
            SELECT c.registration_number, u.first_name, u.last_name, u.email
            FROM candidates c
            JOIN users u ON u.id = c.user_id
            WHERE c.id = :candidate_id AND c.tenant_id = :tenant_id
            """
        ),
        {"candidate_id": candidate_id, "tenant_id": current_user.tenant_id},
    )
    profile_row = candidate.mappings().first()
    if not profile_row:
        raise HTTPException(status_code=404, detail="Student not found")

    enrollments = await db.execute(
        text(
            """
            SELECT b.id, b.name, b.academic_year, ac.id AS class_id, ac.name AS class_name, ac.level
            FROM batch_enrollments be
            JOIN batches b ON b.id = be.batch_id
            JOIN academic_classes ac ON ac.id = b.academic_class_id
            WHERE be.candidate_id = :candidate_id
            ORDER BY be.enrolled_at DESC
            """
        ),
        {"candidate_id": candidate_id},
    )
    enrollment_rows = enrollments.mappings().all()

    results_rows = await db.execute(
        text(
            """
            SELECT er.id, er.percentage, er.created_at, e.title AS exam_title, e.type AS exam_type
            FROM exam_results er
            JOIN exams e ON e.id = er.exam_id
            WHERE er.candidate_id = :candidate_id AND er.published = true
            ORDER BY er.created_at DESC
            LIMIT 10
            """
        ),
        {"candidate_id": candidate_id},
    )
    recent_results = results_rows.mappings().all()
    avg_score = (
        sum(float(r["percentage"] or 0) for r in recent_results) / len(recent_results)
        if recent_results
        else None
    )

    syllabus_coverage = []
    for enrollment in enrollment_rows:
        progress = await db.execute(
            text(
                """
                SELECT sp.status, c.id AS chapter_id, c.number, c.title,
                       s.id AS subject_id, s.name AS subject_name, s.code AS subject_code
                FROM syllabus_progress sp
                JOIN chapters c ON c.id = sp.chapter_id
                JOIN books bk ON bk.id = c.book_id
                JOIN subjects s ON s.id = bk.subject_id
                WHERE sp.batch_id = :batch_id
                  AND sp.chapter_id IS NOT NULL
                  AND sp.status = 'COMPLETED'
                ORDER BY s.name, c.number
                """
            ),
            {"batch_id": enrollment["id"]},
        )
        chapters = []
        seen: set[str] = set()
        by_subject: dict[str, dict] = {}
        class_level = int(enrollment["level"])
        for row in progress.mappings():
            if row["chapter_id"] in seen:
                continue
            seen.add(row["chapter_id"])
            resolved_title = resolve_chapter_title(
                row["title"],
                chapter_number=int(row["number"]),
                class_level=class_level,
                subject_code=row.get("subject_code"),
            )
            if resolved_title != (row["title"] or "").strip():
                chapter_row = await db.get(Chapter, row["chapter_id"])
                if chapter_row:
                    chapter_row.title = resolved_title[:200]
            chapter = {
                "id": row["chapter_id"],
                "number": row["number"],
                "title": resolved_title,
                "status": row["status"],
                "subject": {"id": row["subject_id"], "name": row["subject_name"]},
            }
            chapters.append(chapter)
            sid = row["subject_id"]
            if sid not in by_subject:
                by_subject[sid] = {
                    "subject": {"id": sid, "name": row["subject_name"]},
                    "chapters": [],
                }
            by_subject[sid]["chapters"].append(chapter)

        await db.flush()

        syllabus_coverage.append(
            {
                "batch": {
                    "id": enrollment["id"],
                    "name": enrollment["name"],
                    "className": enrollment["class_name"],
                },
                "chapters": chapters,
                "subjects": list(by_subject.values()),
                "stats": {
                    "total": len(chapters),
                    "done": len(chapters),
                    "studying": 0,
                    "subjectCount": len(by_subject),
                },
            }
        )

    done_chapters = sum(item["stats"]["done"] for item in syllabus_coverage)

    return {
        "profile": {
            "fullName": f"{profile_row['first_name']} {profile_row['last_name']}".strip(),
            "email": profile_row["email"],
            "registrationNumber": profile_row["registration_number"],
        },
        "batches": [
            {
                "id": e["id"],
                "name": e["name"],
                "academicYear": e["academic_year"],
                "academicClass": {
                    "id": e["class_id"],
                    "name": e["class_name"],
                    "level": e["level"],
                },
            }
            for e in enrollment_rows
        ],
        "stats": {
            "totalTests": len(recent_results),
            "averageScore": avg_score,
            "weakTopics": 0,
            "masteredTopics": 0,
            "doneChapters": done_chapters,
        },
        "recentResults": [
            {
                "id": r["id"],
                "percentage": float(r["percentage"] or 0),
                "createdAt": r["created_at"].isoformat() if r["created_at"] else None,
                "exam": {"title": r["exam_title"], "type": r["exam_type"]},
            }
            for r in recent_results
        ],
        "weakAreas": [],
        "topicMasteries": [],
        "syllabusCoverage": syllabus_coverage,
    }


def _map_progress_status(status: str) -> str:
    if status == "COMPLETED":
        return "completed"
    if status == "IN_PROGRESS":
        return "in-progress"
    return "planned"


@router.get("/institute/lessons")
async def institute_lessons(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tenant_id = current_user.tenant_id
    batches = await db.execute(
        text(
            """
            SELECT b.id, b.name, ac.name AS class_name
            FROM batches b
            JOIN academic_classes ac ON ac.id = b.academic_class_id
            WHERE b.tenant_id = :tenant_id AND b.is_active = true
            ORDER BY b.academic_year DESC, b.name ASC
            LIMIT 40
            """
        ),
        {"tenant_id": tenant_id},
    )
    batch_rows = batches.mappings().all()
    items = []
    for batch in batch_rows:
        progress = await db.execute(
            text(
                """
                SELECT sp.status, c.id AS chapter_id, c.number, c.title,
                       s.name AS subject_name
                FROM syllabus_progress sp
                JOIN chapters c ON c.id = sp.chapter_id
                JOIN books bk ON bk.id = c.book_id
                JOIN subjects s ON s.id = bk.subject_id
                WHERE sp.batch_id = :batch_id AND sp.chapter_id IS NOT NULL
                ORDER BY s.name, c.number
                """
            ),
            {"batch_id": batch["id"]},
        )
        for row in progress.mappings():
            items.append(
                {
                    "id": f"{batch['id']}-{row['chapter_id']}",
                    "chapterId": row["chapter_id"],
                    "batchId": batch["id"],
                    "title": row["title"],
                    "description": f"{row['subject_name']} · {batch['name']}",
                    "subjectName": row["subject_name"],
                    "batchName": batch["name"],
                    "className": batch["class_name"],
                    "chapterNumber": row["number"],
                    "status": _map_progress_status(row["status"] or "NOT_STARTED"),
                }
            )

    status_order = {"in-progress": 0, "planned": 1, "completed": 2}
    items.sort(
        key=lambda x: (
            status_order.get(x["status"], 9),
            x["className"],
            x["subjectName"],
            x["chapterNumber"],
        )
    )
    return {"items": items, "batchCount": len(batch_rows)}
