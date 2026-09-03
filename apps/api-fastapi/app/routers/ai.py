import json
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.routers.batches import _uploaded_chapter_ids

router = APIRouter(prefix="/ai", tags=["AI"])


class CreateAiTestBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    title: str
    batch_id: str | None = Field(None, alias="batchId")
    subject_id: str | None = Field(None, alias="subjectId")
    all_subjects: bool = Field(False, alias="allSubjects")
    chapter_ids: list[str] | None = Field(None, alias="chapterIds")
    topic_ids: list[str] | None = Field(None, alias="topicIds")
    question_count: int | None = Field(10, alias="questionCount")
    questions_per_subject: int | None = Field(None, alias="questionsPerSubject")
    difficulty: str = "MEDIUM"
    question_types: list[str] | None = Field(None, alias="questionTypes")
    syllabus_scope: str = Field("COMPLETED_ONLY", alias="syllabusScope")
    duration_minutes: int | None = Field(60, alias="durationMinutes")
    assign_to_batch: bool = Field(False, alias="assignToBatch")


async def _unique_title(db: AsyncSession, tenant_id: str, title: str) -> str:
    base = title.strip()
    candidate = base
    suffix = 2
    while True:
        row = await db.execute(
            text("SELECT id FROM exams WHERE tenant_id = :tenant_id AND title = :title LIMIT 1"),
            {"tenant_id": tenant_id, "title": candidate},
        )
        if not row.scalar_one_or_none():
            return candidate
        candidate = f"{base} ({suffix})"
        suffix += 1


async def _resolve_chapter_ids(
    db: AsyncSession,
    tenant_id: str,
    batch_id: str | None,
    subject_id: str,
    class_level: int,
    chapter_ids_req: list[str] | None,
    syllabus_scope: str,
) -> list[str]:
    uploaded = await _uploaded_chapter_ids(db, tenant_id, class_level, subject_id)
    requested = [str(cid) for cid in (chapter_ids_req or []) if cid]

    if not uploaded and not requested:
        raise HTTPException(
            status_code=400,
            detail="No uploaded documents for this subject. Upload books on Books & Notes first.",
        )

    scope = (syllabus_scope or "COMPLETED_ONLY").upper()
    if scope == "SELECTED":
        chapter_ids = [cid for cid in requested if cid in uploaded]
        if not chapter_ids and requested:
            rows = await db.execute(
                text(
                    """
                    SELECT c.id::text
                    FROM chapters c
                    JOIN books b ON b.id::text = c.book_id::text
                    JOIN subjects s ON s.id::text = b.subject_id::text
                    JOIN academic_classes ac ON ac.id::text = s.academic_class_id::text
                    WHERE c.id::text = ANY(CAST(:ids AS text[]))
                      AND ac.level = :class_level
                      AND s.id::text = :subject_id
                    """
                ),
                {"ids": requested, "class_level": class_level, "subject_id": str(subject_id)},
            )
            chapter_ids = [row[0] for row in rows.all()]
        if not chapter_ids:
            raise HTTPException(
                status_code=400,
                detail="Select at least one chapter with uploaded documents for this test.",
            )
        return chapter_ids

    if scope == "COMPLETED_ONLY" and batch_id:
        rows = await db.execute(
            text(
                """
                SELECT chapter_id::text
                FROM syllabus_progress
                WHERE batch_id::text = :batch_id
                  AND status = 'COMPLETED'
                  AND chapter_id IS NOT NULL
                """
            ),
            {"batch_id": str(batch_id)},
        )
        completed = {row[0] for row in rows.all()}
        if requested:
            chapter_ids = [cid for cid in requested if cid in uploaded and cid in completed]
        else:
            chapter_ids = [cid for cid in completed if cid in uploaded]
        if not chapter_ids and uploaded:
            chapter_ids = sorted(uploaded)
        if not chapter_ids:
            raise HTTPException(
                status_code=400,
                detail=(
                    "No studied chapters with uploaded documents. Mark chapters on Classes & Batches "
                    "and ensure matching books are uploaded."
                ),
            )
        return sorted(chapter_ids)

    if requested:
        return [cid for cid in requested if cid in uploaded]
    if not uploaded:
        raise HTTPException(
            status_code=400,
            detail="No uploaded documents for this subject. Upload books on Books & Notes first.",
        )
    return sorted(uploaded)


async def _load_chapters(db: AsyncSession, chapter_ids: list[str]) -> list[dict]:
    if not chapter_ids:
        return []
    rows = await db.execute(
        text(
            """
            SELECT c.id, c.title, c.number, s.name AS subject_name
            FROM chapters c
            JOIN books b ON b.id::text = c.book_id::text
            JOIN subjects s ON s.id::text = b.subject_id::text
            WHERE c.id::text = ANY(CAST(:ids AS text[]))
            ORDER BY c.order_index, c.number
            """
        ),
        {"ids": [str(cid) for cid in chapter_ids]},
    )
    return [dict(row._mapping) for row in rows.all()]


def _placeholder_questions(chapters: list[dict], count: int, difficulty: str) -> list[dict]:
    if not chapters:
        return []
    difficulty = (difficulty or "MEDIUM").upper()
    questions: list[dict] = []
    for i in range(count):
        chapter = chapters[i % len(chapters)]
        title = chapter["title"]
        subject = chapter["subject_name"]
        questions.append(
            {
                "title": f"{subject}: {title} — Q{i + 1}",
                "content": {
                    "text": f'Which statement best relates to "{title}" in {subject}?',
                },
                "options": {
                    "a": f"A key concept from {title}",
                    "b": "An unrelated statement",
                    "c": "The opposite of the chapter theme",
                    "d": "A detail from a different subject",
                },
                "correct_answer": {"value": "a"},
                "marks": 2.0,
                "negative_marks": 0.0,
                "difficulty": difficulty,
                "chapter_id": chapter["id"],
            }
        )
    return questions


async def _insert_question(
    db: AsyncSession,
    tenant_id: str,
    user_id: str,
    now: datetime,
    q: dict,
) -> str:
    question_id = str(uuid.uuid4())
    version_id = str(uuid.uuid4())
    await db.execute(
        text(
            """
            INSERT INTO questions
              (id, tenant_id, type, difficulty, title, status, created_by_id, current_version_id, created_at, updated_at)
            VALUES
              (:id, :tenant_id, 'MCQ', :difficulty, :title, 'DRAFT', :user_id, :version_id, :now, :now)
            """
        ),
        {
            "id": question_id,
            "tenant_id": tenant_id,
            "difficulty": q["difficulty"],
            "title": q["title"],
            "user_id": user_id,
            "version_id": version_id,
            "now": now,
        },
    )
    await db.execute(
        text(
            """
            INSERT INTO question_versions
              (id, question_id, version_number, content, options, correct_answer, marks, negative_marks, created_at)
            VALUES
              (:id, :question_id, 1, CAST(:content AS jsonb), CAST(:options AS jsonb), CAST(:correct_answer AS jsonb), :marks, :negative_marks, :now)
            """
        ),
        {
            "id": version_id,
            "question_id": question_id,
            "content": json.dumps(q["content"]),
            "options": json.dumps(q["options"]),
            "correct_answer": json.dumps(q["correct_answer"]),
            "marks": q["marks"],
            "negative_marks": q["negative_marks"],
            "now": now,
        },
    )
    return question_id


async def _create_exam_shell(
    db: AsyncSession,
    tenant_id: str,
    user_id: str,
    title: str,
    code: str,
    duration_minutes: int,
    settings_extra: dict,
    sections: list[str],
    now: datetime,
) -> tuple[str, list[str]]:
    exam_id = str(uuid.uuid4())
    start = now
    end = now + timedelta(minutes=duration_minutes)
    settings = {
        "durationMinutes": duration_minutes,
        "passingScore": 40,
        "negativeMarking": False,
        **settings_extra,
    }
    security_policy = {
        "proctoringEnabled": False,
        "fullscreen": True,
        "blockCopyPaste": True,
        "blockRightClick": True,
    }
    await db.execute(
        text(
            """
            INSERT INTO exams
              (id, tenant_id, title, code, type, status, start_time, end_time, timezone,
               settings, security_policy, created_by_id, created_at, updated_at)
            VALUES
              (:id, :tenant_id, :title, :code, 'AI_ASSESSMENT', 'DRAFT', :start, :end, 'UTC',
               CAST(:settings AS jsonb), CAST(:security_policy AS jsonb), :user_id, :now, :now)
            """
        ),
        {
            "id": exam_id,
            "tenant_id": tenant_id,
            "title": title,
            "code": code,
            "start": start,
            "end": end,
            "settings": json.dumps(settings),
            "security_policy": json.dumps(security_policy),
            "user_id": user_id,
            "now": now,
        },
    )

    section_ids: list[str] = []
    for index, name in enumerate(sections):
        section_id = str(uuid.uuid4())
        section_ids.append(section_id)
        await db.execute(
            text(
                """
                INSERT INTO exam_sections
                  (id, exam_id, name, order_index, duration_minutes, negative_marking, created_at)
                VALUES
                  (:id, :exam_id, :name, :order_index, :duration_minutes, false, :now)
                """
            ),
            {
                "id": section_id,
                "exam_id": exam_id,
                "name": name,
                "order_index": index,
                "duration_minutes": duration_minutes,
                "now": now,
            },
        )
    return exam_id, section_ids


async def _assign_batch_candidates(
    db: AsyncSession, exam_id: str, batch_id: str, now: datetime
) -> None:
    rows = await db.execute(
        text("SELECT candidate_id FROM batch_enrollments WHERE batch_id = :batch_id"),
        {"batch_id": batch_id},
    )
    for (candidate_id,) in rows.all():
        await db.execute(
            text(
                """
                INSERT INTO exam_registrations (id, exam_id, candidate_id, status, registered_at)
                VALUES (:id, :exam_id, :candidate_id, 'REGISTERED', :now)
                ON CONFLICT (exam_id, candidate_id) DO NOTHING
                """
            ),
            {"id": str(uuid.uuid4()), "exam_id": exam_id, "candidate_id": candidate_id, "now": now},
        )


@router.post("/tests/create")
async def create_ai_test(
    body: CreateAiTestBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tenant_id = current_user.tenant_id
    user_id = current_user.id
    now = datetime.now(timezone.utc)
    title = await _unique_title(db, tenant_id, body.title)

    if body.all_subjects and body.batch_id:
        batch_row = await db.execute(
            text(
                """
                SELECT b.id, ac.level, ac.id AS class_id
                FROM batches b
                JOIN academic_classes ac ON ac.id = b.academic_class_id
                WHERE b.id = :id AND b.tenant_id = :tenant_id AND b.is_active = true
                """
            ),
            {"id": body.batch_id, "tenant_id": tenant_id},
        )
        batch = batch_row.mappings().first()
        if not batch:
            raise HTTPException(status_code=400, detail="Batch not found")

        subjects = await db.execute(
            text(
                """
                SELECT id, name
                FROM subjects
                WHERE academic_class_id = :class_id
                ORDER BY order_index, name
                """
            ),
            {"class_id": batch["class_id"]},
        )
        subject_rows = subjects.mappings().all()
        if not subject_rows:
            raise HTTPException(status_code=400, detail="No subjects configured for this class")

        per_subject = body.questions_per_subject or max(1, (body.question_count or 10) // max(len(subject_rows), 1))
        duration = body.duration_minutes or 90
        code = f"AI-ALL-{int(now.timestamp())}"
        exam_id, section_ids = await _create_exam_shell(
            db,
            tenant_id,
            user_id,
            title,
            code,
            duration,
            {"aiGenerated": True, "combinedSubjects": True, "batchId": body.batch_id},
            [s["name"] for s in subject_rows],
            now,
        )

        total_questions = 0
        order_index = 0
        for subject, section_id in zip(subject_rows, section_ids):
            try:
                chapter_ids = await _resolve_chapter_ids(
                    db,
                    tenant_id,
                    body.batch_id,
                    subject["id"],
                    batch["level"],
                    body.chapter_ids,
                    body.syllabus_scope,
                )
            except HTTPException as exc:
                detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
                raise HTTPException(
                    status_code=400,
                    detail=f"{subject['name']}: {detail}",
                ) from exc
            chapters = await _load_chapters(db, chapter_ids)
            generated = _placeholder_questions(chapters, per_subject, body.difficulty)
            for q in generated:
                question_id = await _insert_question(db, tenant_id, user_id, now, q)
                await db.execute(
                    text(
                        """
                        INSERT INTO exam_questions
                          (id, exam_id, section_id, question_id, order_index, marks, negative_marks)
                        VALUES
                          (:id, :exam_id, :section_id, :question_id, :order_index, :marks, :negative_marks)
                        """
                    ),
                    {
                        "id": str(uuid.uuid4()),
                        "exam_id": exam_id,
                        "section_id": section_id,
                        "question_id": question_id,
                        "order_index": order_index,
                        "marks": q["marks"],
                        "negative_marks": q["negative_marks"],
                    },
                )
                order_index += 1
                total_questions += 1

        await db.execute(
            text(
                """
                INSERT INTO ai_test_configs
                  (id, tenant_id, batch_id, subject_id, title, chapter_ids, topic_ids,
                   question_count, question_types, syllabus_scope, exam_id, created_by_id, created_at)
                VALUES
                  (:id, :tenant_id, :batch_id, NULL, :title, '[]'::jsonb, NULL,
                   :question_count, CAST(:question_types AS jsonb), :syllabus_scope, :exam_id, :user_id, :now)
                """
            ),
            {
                "id": str(uuid.uuid4()),
                "tenant_id": tenant_id,
                "batch_id": body.batch_id,
                "title": title,
                "question_count": total_questions,
                "question_types": json.dumps(body.question_types or ["MCQ"]),
                "syllabus_scope": body.syllabus_scope,
                "exam_id": exam_id,
                "user_id": user_id,
                "now": now,
            },
        )
        if body.assign_to_batch:
            await _assign_batch_candidates(db, exam_id, body.batch_id, now)

        return {
            "exam": {"id": exam_id, "title": title, "status": "DRAFT", "code": code},
            "questionCount": total_questions,
            "source": "placeholder",
            "message": (
                "Draft exam created with syllabus-based placeholder questions. "
                "Review and edit them, then publish from Class Tests. "
                "Full AI generation from PDF content requires the NestJS API."
            ),
        }

    if not body.subject_id:
        raise HTTPException(status_code=400, detail="Choose a subject or enable all subjects")

    subject_row = await db.execute(
        text(
            """
            SELECT s.id, s.name, s.academic_class_id, ac.level
            FROM subjects s
            JOIN academic_classes ac ON ac.id = s.academic_class_id
            WHERE s.id = :id
            """
        ),
        {"id": body.subject_id},
    )
    subject = subject_row.mappings().first()
    if not subject:
        raise HTTPException(status_code=400, detail="Subject not found")

    chapter_ids = await _resolve_chapter_ids(
        db,
        tenant_id,
        body.batch_id,
        body.subject_id,
        subject["level"],
        body.chapter_ids,
        body.syllabus_scope,
    )
    chapters = await _load_chapters(db, chapter_ids)
    expected_count = body.question_count or 10
    generated = _placeholder_questions(chapters, expected_count, body.difficulty)
    if len(generated) < expected_count:
        raise HTTPException(
            status_code=400,
            detail=f"Expected {expected_count} questions but could only prepare {len(generated)}.",
        )

    duration = body.duration_minutes or 60
    code = f"AI-{int(now.timestamp())}"
    exam_id, section_ids = await _create_exam_shell(
        db,
        tenant_id,
        user_id,
        title,
        code,
        duration,
        {"aiGenerated": True, "subjectId": body.subject_id, "chapterIds": chapter_ids},
        ["Section A"],
        now,
    )
    section_id = section_ids[0]

    question_ids: list[str] = []
    for order_index, q in enumerate(generated):
        question_id = await _insert_question(db, tenant_id, user_id, now, q)
        question_ids.append(question_id)
        await db.execute(
            text(
                """
                INSERT INTO exam_questions
                  (id, exam_id, section_id, question_id, order_index, marks, negative_marks)
                VALUES
                  (:id, :exam_id, :section_id, :question_id, :order_index, :marks, :negative_marks)
                """
            ),
            {
                "id": str(uuid.uuid4()),
                "exam_id": exam_id,
                "section_id": section_id,
                "question_id": question_id,
                "order_index": order_index,
                "marks": q["marks"],
                "negative_marks": q["negative_marks"],
            },
        )

    await db.execute(
        text(
            """
            INSERT INTO ai_test_configs
              (id, tenant_id, batch_id, subject_id, title, chapter_ids, topic_ids,
               question_count, question_types, syllabus_scope, exam_id, created_by_id, created_at)
            VALUES
              (:id, :tenant_id, :batch_id, :subject_id, :title, CAST(:chapter_ids AS jsonb), CAST(:topic_ids AS jsonb),
               :question_count, CAST(:question_types AS jsonb), :syllabus_scope, :exam_id, :user_id, :now)
            """
        ),
        {
            "id": str(uuid.uuid4()),
            "tenant_id": tenant_id,
            "batch_id": body.batch_id,
            "subject_id": body.subject_id,
            "title": title,
            "chapter_ids": json.dumps(chapter_ids),
            "topic_ids": json.dumps(body.topic_ids or []),
            "question_count": expected_count,
            "question_types": json.dumps(body.question_types or ["MCQ"]),
            "syllabus_scope": body.syllabus_scope,
            "exam_id": exam_id,
            "user_id": user_id,
            "now": now,
        },
    )
    if body.assign_to_batch and body.batch_id:
        await _assign_batch_candidates(db, exam_id, body.batch_id, now)

    return {
        "exam": {"id": exam_id, "title": title, "status": "DRAFT", "code": code},
        "questionCount": len(question_ids),
        "source": "placeholder",
        "contextUsed": len(chapters),
        "message": (
            "Draft exam created with syllabus-based placeholder questions. "
            "Review and edit them, then publish from Class Tests. "
            "Full AI generation from PDF content requires the NestJS API."
        ),
    }
