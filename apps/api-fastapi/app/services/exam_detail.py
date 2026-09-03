import json

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


async def get_exam_detail(db: AsyncSession, exam_id: str, tenant_id: str) -> dict | None:
    exam_row = await db.execute(
        text(
            """
            SELECT id, title, code, type, status, description, start_time, end_time, timezone,
                   settings, security_policy, created_by_id, published_at, created_at, updated_at
            FROM exams
            WHERE id = :id AND tenant_id = :tenant_id
            """
        ),
        {"id": exam_id, "tenant_id": tenant_id},
    )
    exam = exam_row.mappings().first()
    if not exam:
        return None

    sections_result = await db.execute(
        text(
            """
            SELECT id, name, order_index, duration_minutes, negative_marking, created_at
            FROM exam_sections
            WHERE exam_id = :exam_id
            ORDER BY order_index
            """
        ),
        {"exam_id": exam_id},
    )
    sections = []
    for section in sections_result.mappings():
        links = await db.execute(
            text(
                """
                SELECT eq.id, eq.question_id, eq.order_index, eq.marks, eq.negative_marks,
                       q.title, q.type, q.status,
                       qv.content, qv.options, qv.correct_answer, qv.marks AS version_marks,
                       qv.negative_marks AS version_negative_marks
                FROM exam_questions eq
                JOIN questions q ON q.id = eq.question_id
                LEFT JOIN question_versions qv ON qv.question_id = q.id AND qv.version_number = 1
                WHERE eq.section_id = :section_id
                ORDER BY eq.order_index
                """
            ),
            {"section_id": section["id"]},
        )
        questions = []
        for link in links.mappings():
            questions.append(
                {
                    "id": link["id"],
                    "questionId": link["question_id"],
                    "orderIndex": link["order_index"],
                    "marks": link["marks"],
                    "negativeMarks": link["negative_marks"],
                    "question": {
                        "id": link["question_id"],
                        "title": link["title"],
                        "type": link["type"],
                        "status": link["status"],
                        "versions": [
                            {
                                "content": _parse_json(link["content"]),
                                "options": _parse_json(link["options"]),
                                "correctAnswer": _parse_json(link["correct_answer"]),
                                "marks": link["version_marks"],
                                "negativeMarks": link["version_negative_marks"],
                            }
                        ],
                    },
                }
            )
        sections.append(
            {
                "id": section["id"],
                "name": section["name"],
                "orderIndex": section["order_index"],
                "durationMinutes": section["duration_minutes"],
                "negativeMarking": section["negative_marking"],
                "createdAt": section["created_at"].isoformat() if section["created_at"] else None,
                "questions": questions,
                "_count": {"questions": len(questions)},
            }
        )

    registrations = await db.execute(
        text("SELECT candidate_id FROM exam_registrations WHERE exam_id = :exam_id"),
        {"exam_id": exam_id},
    )

    ai_config = await db.execute(
        text(
            """
            SELECT atc.id, atc.batch_id, atc.subject_id, atc.title, atc.chapter_ids, atc.syllabus_scope,
                   b.name AS batch_name, b.academic_year,
                   ac.id AS class_id, ac.name AS class_name, ac.level AS class_level
            FROM ai_test_configs atc
            LEFT JOIN batches b ON b.id = atc.batch_id
            LEFT JOIN academic_classes ac ON ac.id = b.academic_class_id
            WHERE atc.exam_id = :exam_id
            LIMIT 1
            """
        ),
        {"exam_id": exam_id},
    )
    config = ai_config.mappings().first()

    reg_rows = registrations.all()
    reg_count = len(reg_rows)

    return {
        "id": exam["id"],
        "title": exam["title"],
        "code": exam["code"],
        "type": exam["type"],
        "status": exam["status"],
        "description": exam["description"],
        "startTime": exam["start_time"].isoformat() if exam["start_time"] else None,
        "endTime": exam["end_time"].isoformat() if exam["end_time"] else None,
        "timezone": exam["timezone"],
        "settings": _parse_json(exam["settings"]),
        "securityPolicy": _parse_json(exam["security_policy"]),
        "publishedAt": exam["published_at"].isoformat() if exam["published_at"] else None,
        "createdAt": exam["created_at"].isoformat() if exam["created_at"] else None,
        "updatedAt": exam["updated_at"].isoformat() if exam["updated_at"] else None,
        "sections": sections,
        "registrations": [{"candidateId": row[0]} for row in reg_rows],
        "aiTestConfig": (
            {
                "batchId": config["batch_id"],
                "subjectId": config["subject_id"],
                "title": config["title"],
                "chapterIds": _parse_json(config["chapter_ids"]),
                "syllabusScope": config["syllabus_scope"],
                "batch": (
                    {
                        "id": config["batch_id"],
                        "name": config["batch_name"],
                        "academicYear": config["academic_year"],
                        "academicClass": {
                            "id": config["class_id"],
                            "name": config["class_name"],
                            "level": config["class_level"],
                        },
                    }
                    if config["batch_id"]
                    else None
                ),
            }
            if config
            else None
        ),
        "_count": {
            "registrations": reg_count,
        },
    }
