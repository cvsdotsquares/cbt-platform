from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User

router = APIRouter(prefix="/onboarding", tags=["Onboarding"])


@router.get("/setup-status")
async def setup_status(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tenant_id = current_user.tenant_id

    counts = await db.execute(
        text(
            """
            SELECT
              (SELECT COUNT(*) FROM academic_classes WHERE tenant_id = :tenant_id OR tenant_id IS NULL) AS class_count,
              (SELECT COUNT(*) FROM batches WHERE tenant_id = :tenant_id) AS batch_count,
              (SELECT COUNT(*) FROM study_materials WHERE tenant_id = :tenant_id AND status = 'READY') AS material_ready,
              (SELECT COUNT(*) FROM study_materials WHERE tenant_id = :tenant_id) AS material_total,
              (
                SELECT COUNT(*)
                FROM batch_enrollments be
                JOIN batches b ON b.id = be.batch_id
                WHERE b.tenant_id = :tenant_id
              ) AS enrollment_count,
              (
                SELECT COUNT(*)
                FROM syllabus_progress sp
                JOIN batches b ON b.id = sp.batch_id
                WHERE b.tenant_id = :tenant_id AND sp.status = 'COMPLETED'
              ) AS progress_completed,
              (SELECT COUNT(*) FROM ai_test_configs WHERE tenant_id = :tenant_id) AS ai_test_count,
              (SELECT COUNT(*) FROM candidates WHERE tenant_id = :tenant_id) AS student_count
            """
        ),
        {"tenant_id": tenant_id},
    )
    c = counts.mappings().first() or {}
    material_ready = int(c.get("material_ready") or 0)
    material_total = int(c.get("material_total") or 0)
    batch_count = int(c.get("batch_count") or 0)
    enrollment_count = int(c.get("enrollment_count") or 0)
    progress_completed = int(c.get("progress_completed") or 0)
    ai_test_count = int(c.get("ai_test_count") or 0)
    student_count = int(c.get("student_count") or 0)

    steps = [
        {
            "id": "syllabus",
            "order": 1,
            "title": "Review extracted syllabus",
            "description": "Chapters and topics from your uploaded books. Open Syllabus after uploading.",
            "href": "/dashboard/syllabus",
            "done": material_ready > 0,
            "detail": f"{material_ready} book(s) indexed" if material_ready > 0 else "Upload books first",
        },
        {
            "id": "students",
            "order": 2,
            "title": "Add Students",
            "description": "Create student accounts under Students. Each student needs a login.",
            "href": "/dashboard/candidates",
            "done": student_count > 0,
            "detail": f"{student_count} student(s)",
        },
        {
            "id": "batch",
            "order": 3,
            "title": "Create a Batch",
            "description": "Group students by class and academic year (e.g. Class 10 — Batch A — 2025-26).",
            "href": "/dashboard/batches",
            "done": batch_count > 0,
            "detail": f"{batch_count} batch(es)",
        },
        {
            "id": "enroll",
            "order": 4,
            "title": "Enroll Students in Batch",
            "description": "On the Batches page, select a batch and enroll students with roll numbers.",
            "href": "/dashboard/batches",
            "done": enrollment_count > 0,
            "detail": f"{enrollment_count} enrollment(s)",
        },
        {
            "id": "materials",
            "order": 5,
            "title": "Upload Study Materials",
            "description": "Upload PDFs or notes. Chapters, topics, and AI index are built from your files.",
            "href": "/dashboard/materials",
            "done": material_ready > 0,
            "detail": f"{material_ready}/{material_total} indexed" if material_total > 0 else "No uploads yet",
        },
        {
            "id": "syllabus-progress",
            "order": 6,
            "title": "Mark Syllabus Progress",
            "description": "Mark chapters as Completed or In Progress. AI only uses completed chapters.",
            "href": "/dashboard/batches",
            "done": progress_completed > 0,
            "detail": f"{progress_completed} chapter(s) completed",
        },
        {
            "id": "ai-test",
            "order": 7,
            "title": "Create NCERT Class Test",
            "description": "Use Create Class Test: pick batch + subject, generate from studied chapters, then publish.",
            "href": "/dashboard/ai-tests",
            "done": ai_test_count > 0,
            "detail": f"{ai_test_count} AI test(s) created",
        },
        {
            "id": "student-take",
            "order": 8,
            "title": "Student Takes Class Test",
            "description": "Student logs in → Student Portal → Class Tests → Start.",
            "href": "/my-exams",
            "done": ai_test_count > 0 and enrollment_count > 0,
            "detail": "Student: candidate@example.com / Candidate@123",
        },
    ]

    completed = sum(1 for s in steps if s["done"])
    next_step = next((s for s in steps if not s["done"]), None)

    return {
        "progress": round((completed / len(steps)) * 100) if steps else 0,
        "completed": completed,
        "total": len(steps),
        "nextStep": next_step,
        "steps": steps,
        "demoAccounts": {
            "admin": {"email": "admin@cbt-platform.com", "password": "Admin@123"},
            "teacher": {"email": "teacher@example.com", "password": "Teacher@123"},
            "student": {"email": "candidate@example.com", "password": "Candidate@123"},
        },
    }
