import csv
import io
import math

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user, require_permission
from app.models.user import User
from app.services.candidate_context import parse_json, require_candidate_id
from app.services.exam_engine import evaluate_session, grade_session_responses
from app.services.subjective_grading import grade_subjective_answer

router = APIRouter(prefix="/results", tags=["Results"])

MANUAL_GRADE_TYPES = frozenset({
    "SUBJECTIVE", "CASE_STUDY", "CODING", "AUDIO", "VIDEO", "MSQ",
})


class ManualGradeBody(BaseModel):
    marks_awarded: float = Field(alias="marksAwarded")

    model_config = {"populate_by_name": True}


RESULT_STAFF_ROLES = {
    "SUPER_ADMIN",
    "ORG_ADMIN",
    "INSTITUTE_ADMIN",
    "EXAM_MANAGER",
    "TEACHER",
    "EVALUATOR",
    "AUDITOR",
    "ADMIN",
}


def _normalize_answer(answer) -> list[str]:
    if not answer:
        return []
    parsed = parse_json(answer)
    raw = parsed.get("value") if isinstance(parsed, dict) and "value" in parsed else parsed
    if raw is None:
        return []
    if isinstance(raw, list):
        return [str(v) for v in raw if v is not None and str(v).strip()]
    return [str(raw)]


def _normalize_options(options) -> dict[str, str]:
    parsed = parse_json(options)
    if not isinstance(parsed, dict):
        return {}
    out: dict[str, str] = {}
    for key in ("a", "b", "c", "d", "A", "B", "C", "D"):
        value = parsed.get(key)
        if value is not None and str(value).strip():
            out[key.lower()] = str(value)
    return out


def _format_answer_label(keys: list[str], options: dict[str, str]) -> str:
    if not keys:
        return "Not answered"
    parts: list[str] = []
    for key in keys:
        normalized = key.strip().lower()
        label = options.get(normalized)
        if label:
            parts.append(f"{normalized.upper()}. {label}")
        else:
            parts.append(key)
    return ", ".join(parts)


def _effective_marks_awarded(
    marks_awarded: float | None,
    *,
    answered: bool,
    is_correct: bool | None,
    max_marks: float,
) -> float | None:
    if marks_awarded is not None:
        return float(marks_awarded)
    if not answered:
        return 0.0
    if is_correct is True:
        return max_marks
    if is_correct is False:
        return 0.0
    return None


def _infer_is_correct(question_type: str, given: list[str], expected: list[str]) -> bool | None:
    if not given:
        return None
    if not expected:
        return None
    qtype = (question_type or "MCQ").upper()
    if qtype == "MSQ":
        exp_set = set(expected)
        giv_set = set(given)
        return (
            all(a in giv_set for a in expected)
            and all(a in exp_set for a in given)
            and len(expected) > 0
        )
    if qtype == "NUMERICAL":
        try:
            exp_num = float(expected[0])
            giv_num = float(given[0])
            return abs(exp_num - giv_num) < 0.001
        except (ValueError, IndexError):
            return False
    if qtype in {"SUBJECTIVE", "CASE_STUDY", "CODING", "AUDIO", "VIDEO"}:
        return None
    return str(given[0]).strip().lower() == str(expected[0]).strip().lower()


async def _user_roles(db: AsyncSession, user_id: str) -> list[str]:
    rows = await db.execute(
        text(
            """
            SELECT r.name
            FROM user_roles ur
            JOIN roles r ON r.id::text = ur.role_id::text
            WHERE ur.user_id::text = :user_id AND r.is_active = TRUE
            """
        ),
        {"user_id": str(user_id)},
    )
    return [row[0] for row in rows.all()]


def _certificate_number(exam_code: str, result_id: str) -> str:
    return f"CERT-{exam_code}-{str(result_id)[:8].upper()}"


def _passing_score(settings) -> float:
    parsed = parse_json(settings) or {}
    try:
        return float(parsed.get("passingScore", 40))
    except (TypeError, ValueError):
        return 40.0


async def _certificate_row(
    db: AsyncSession,
    result_id: str,
    *,
    candidate_id: str | None = None,
    published_only: bool = True,
) -> dict:
    params: dict[str, str] = {"result_id": str(result_id)}
    candidate_clause = ""
    published_clause = "AND er.published = true" if published_only else ""
    if candidate_id:
        params["candidate_id"] = str(candidate_id)
        candidate_clause = "AND er.candidate_id::text = :candidate_id"

    row = await db.execute(
        text(
            f"""
            SELECT er.id, er.exam_id, er.total_score, er.max_score, er.percentage,
                   er.rank, er.percentile, er.published, er.published_at, er.created_at,
                   e.title AS exam_title, e.code AS exam_code, e.settings AS exam_settings,
                   u.first_name, u.last_name, u.email
            FROM exam_results er
            JOIN exams e ON e.id::text = er.exam_id::text
            JOIN candidates c ON c.id::text = er.candidate_id::text
            JOIN users u ON u.id::text = c.user_id::text
            WHERE er.id::text = :result_id
              {candidate_clause}
              {published_clause}
            """
        ),
        params,
    )
    result = row.mappings().first()
    if not result:
        raise HTTPException(status_code=404, detail="Published result not found")
    return dict(result)


def _certificate_response(result: dict, total_candidates: int | None = None) -> dict:
    issued_at = result.get("published_at") or result.get("created_at")
    passing_score = _passing_score(result.get("exam_settings"))
    percentage = float(result["percentage"] or 0)
    return {
        "certificateId": result["id"],
        "certificateNumber": _certificate_number(result["exam_code"], str(result["id"])),
        "candidateName": f"{result['first_name'] or ''} {result['last_name'] or ''}".strip(),
        "candidateEmail": result["email"],
        "examTitle": result["exam_title"],
        "examCode": result["exam_code"],
        "totalScore": float(result["total_score"] or 0),
        "maxScore": float(result["max_score"] or 0),
        "percentage": percentage,
        "passingScore": passing_score,
        "rank": result["rank"],
        "percentile": float(result["percentile"]) if result["percentile"] is not None else None,
        "totalCandidates": total_candidates,
        "issuedAt": issued_at.isoformat() if issued_at else None,
        "verificationUrl": f"/verify/certificate/{result['id']}",
    }


async def _backfill_missing_results(db: AsyncSession, exam_id: str) -> None:
    rows = await db.execute(
        text(
            """
            SELECT es.id
            FROM exam_sessions es
            LEFT JOIN exam_results er ON er.session_id = es.id
            WHERE es.exam_id = :exam_id
              AND es.status IN ('SUBMITTED', 'AUTO_SUBMITTED')
              AND er.id IS NULL
            """
        ),
        {"exam_id": exam_id},
    )
    for (session_id,) in rows.all():
        await evaluate_session(db, session_id)


async def _assert_exam(db: AsyncSession, exam_id: str, tenant_id: str):
    row = await db.execute(
        text("SELECT id FROM exams WHERE id = :id AND tenant_id = :tenant_id"),
        {"id": exam_id, "tenant_id": tenant_id},
    )
    if not row.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Exam not found")


@router.get("/exam/{exam_id}")
async def exam_results(
    exam_id: str,
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _assert_exam(db, exam_id, current_user.tenant_id)
    await _backfill_missing_results(db, exam_id)
    offset = (page - 1) * limit
    total = int(
        (
            await db.execute(
                text("SELECT COUNT(*) FROM exam_results WHERE exam_id = :exam_id"),
                {"exam_id": exam_id},
            )
        ).scalar()
        or 0
    )
    rows = await db.execute(
        text(
            """
            SELECT er.id, er.total_score, er.max_score, er.percentage, er.rank,
                   er.percentile, er.published, er.created_at,
                   u.first_name, u.last_name, u.email
            FROM exam_results er
            JOIN candidates c ON c.id = er.candidate_id
            JOIN users u ON u.id = c.user_id
            WHERE er.exam_id = :exam_id
            ORDER BY er.total_score DESC, er.created_at ASC
            LIMIT :limit OFFSET :offset
            """
        ),
        {"exam_id": exam_id, "limit": limit, "offset": offset},
    )
    items = [
        {
            "id": r["id"],
            "totalScore": float(r["total_score"] or 0),
            "maxScore": float(r["max_score"] or 0),
            "percentage": float(r["percentage"] or 0),
            "rank": r["rank"],
            "percentile": float(r["percentile"]) if r["percentile"] is not None else None,
            "published": bool(r["published"]),
            "createdAt": r["created_at"].isoformat() if r["created_at"] else None,
            "candidate": {
                "user": {
                    "firstName": r["first_name"] or "",
                    "lastName": r["last_name"] or "",
                    "email": r["email"],
                },
            },
        }
        for r in rows.mappings()
    ]
    return {
        "items": items,
        "total": total,
        "page": page,
        "limit": limit,
        "totalPages": math.ceil(total / limit) if total else 0,
    }


@router.get("/exam/{exam_id}/export", response_class=PlainTextResponse)
async def export_exam_results(
    exam_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _assert_exam(db, exam_id, current_user.tenant_id)
    await _backfill_missing_results(db, exam_id)

    rows = await db.execute(
        text(
            """
            SELECT er.rank, er.total_score, er.max_score, er.percentage,
                   er.published, er.evaluation_status,
                   u.first_name, u.last_name, u.email
            FROM exam_results er
            JOIN candidates c ON c.id = er.candidate_id
            JOIN users u ON u.id = c.user_id
            WHERE er.exam_id = :exam_id
            ORDER BY er.rank ASC NULLS LAST, er.total_score DESC, er.created_at ASC
            """
        ),
        {"exam_id": exam_id},
    )

    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(["Rank", "Candidate Name", "Email", "Score", "Max Score", "Percentage", "Status", "Published"])
    for row in rows.mappings():
        writer.writerow([
            row["rank"] if row["rank"] is not None else "",
            f"{row['first_name'] or ''} {row['last_name'] or ''}".strip(),
            row["email"] or "",
            row["total_score"] or 0,
            row["max_score"] or 0,
            f"{float(row['percentage'] or 0):.2f}",
            row["evaluation_status"] or "",
            "Yes" if row["published"] else "No",
        ])

    return PlainTextResponse(
        output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="results-{exam_id}.csv"'},
    )


@router.get("/exam/{exam_id}/subjective")
async def exam_subjective(
    exam_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _assert_exam(db, exam_id, current_user.tenant_id)
    return []


@router.patch("/grade/{session_id}/{question_id}")
async def grade_response(
    session_id: str,
    question_id: str,
    body: ManualGradeBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("result:evaluate")),
):
    session_row = await db.execute(
        text(
            """
            SELECT es.id, e.tenant_id
            FROM exam_sessions es
            JOIN exams e ON e.id::text = es.exam_id::text
            WHERE es.id::text = :session_id
            """
        ),
        {"session_id": str(session_id)},
    )
    session = session_row.mappings().first()
    if not session or str(session["tenant_id"]) != str(current_user.tenant_id):
        raise HTTPException(status_code=404, detail="Session not found")

    response_row = await db.execute(
        text(
            """
            SELECT sr.id, q.type, eq.marks, qv.marks AS version_marks
            FROM session_responses sr
            JOIN questions q ON q.id::text = sr.question_id::text
            JOIN exam_sessions es ON es.id::text = sr.session_id::text
            JOIN exam_questions eq
              ON eq.question_id::text = sr.question_id::text
             AND eq.exam_id::text = es.exam_id::text
            LEFT JOIN question_versions qv ON qv.id::text = q.current_version_id::text
            WHERE sr.session_id::text = :session_id AND sr.question_id::text = :question_id
            """
        ),
        {"session_id": str(session_id), "question_id": str(question_id)},
    )
    response = response_row.mappings().first()
    if not response:
        raise HTTPException(status_code=404, detail="Response not found")

    qtype = (response["type"] or "MCQ").upper()
    if qtype not in MANUAL_GRADE_TYPES:
        raise HTTPException(status_code=400, detail="This question type cannot be manually graded")

    max_marks = float(response["version_marks"] or response["marks"] or 0)
    marks_awarded = float(body.marks_awarded)
    if marks_awarded < 0 or marks_awarded > max_marks:
        raise HTTPException(status_code=400, detail=f"Marks must be between 0 and {max_marks}")

    is_correct = marks_awarded >= max_marks if max_marks > 0 else False
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc)
    await db.execute(
        text(
            """
            UPDATE session_responses
            SET marks_awarded = :marks, is_correct = :is_correct, updated_at = :now
            WHERE session_id::text = :session_id AND question_id::text = :question_id
            """
        ),
        {
            "marks": marks_awarded,
            "is_correct": is_correct,
            "now": now,
            "session_id": str(session_id),
            "question_id": str(question_id),
        },
    )
    await db.commit()
    return await evaluate_session(db, session_id)


async def _rank_exam_results(db: AsyncSession, exam_id: str) -> int:
    rows = await db.execute(
        text(
            """
            SELECT id, total_score FROM exam_results
            WHERE exam_id = :exam_id
            ORDER BY total_score DESC, created_at ASC
            """
        ),
        {"exam_id": exam_id},
    )
    results = rows.mappings().all()
    total = len(results)
    current_rank = 0
    prev_score = None
    for i, r in enumerate(results):
        score = float(r["total_score"] or 0)
        if prev_score is None or score < prev_score:
            current_rank = i + 1
            prev_score = score
        percentile = 100.0 if total <= 1 else ((total - current_rank) / (total - 1)) * 100
        await db.execute(
            text("UPDATE exam_results SET rank = :rank, percentile = :pct WHERE id = :id"),
            {"rank": current_rank, "pct": percentile, "id": r["id"]},
        )
    return total


@router.post("/rank/{exam_id}")
async def rank_results(
    exam_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _assert_exam(db, exam_id, current_user.tenant_id)
    total = await _rank_exam_results(db, exam_id)
    return {"examId": exam_id, "totalCandidates": total}


@router.post("/publish/{exam_id}")
async def publish_results(
    exam_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _assert_exam(db, exam_id, current_user.tenant_id)
    await _rank_exam_results(db, exam_id)
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    await db.execute(
        text(
            """
            UPDATE exam_results
            SET published = true, published_at = :now, evaluation_status = 'PUBLISHED', updated_at = :now
            WHERE exam_id = :exam_id
            """
        ),
        {"exam_id": exam_id, "now": now},
    )
    return {"examId": exam_id, "published": True}


@router.post("/evaluate/{session_id}")
async def evaluate_result(
    session_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    row = await db.execute(
        text(
            """
            SELECT es.id, e.tenant_id
            FROM exam_sessions es
            JOIN exams e ON e.id = es.exam_id
            WHERE es.id = :session_id
            """
        ),
        {"session_id": session_id},
    )
    session = row.mappings().first()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session["tenant_id"] != current_user.tenant_id:
        raise HTTPException(status_code=404, detail="Session not found")
    return await evaluate_session(db, session_id)


@router.get("/review/{result_id}")
async def result_review(
    result_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    row = await db.execute(
        text(
            """
            SELECT er.id, er.exam_id, er.candidate_id, er.session_id,
                   er.total_score, er.max_score, er.percentage, er.published,
                   e.title AS exam_title, e.code AS exam_code, e.tenant_id,
                   u.first_name, u.last_name, c.user_id AS candidate_user_id
            FROM exam_results er
            JOIN exams e ON e.id::text = er.exam_id::text
            JOIN candidates c ON c.id::text = er.candidate_id::text
            JOIN users u ON u.id::text = c.user_id::text
            WHERE er.id::text = :result_id
            """
        ),
        {"result_id": str(result_id)},
    )
    result = row.mappings().first()
    if not result or str(result["tenant_id"]) != str(current_user.tenant_id):
        raise HTTPException(status_code=404, detail="Result not found")

    roles = await _user_roles(db, current_user.id)
    is_owner = str(result["candidate_user_id"]) == str(current_user.id)
    is_staff = any(role in RESULT_STAFF_ROLES for role in roles)

    if is_owner:
        if not result["published"]:
            raise HTTPException(status_code=403, detail="Result is not published yet")
    elif not is_staff:
        raise HTTPException(status_code=403, detail="You cannot view this result")

    total_score, max_score = await grade_session_responses(
        db, str(result["session_id"]), str(result["exam_id"])
    )
    percentage = (total_score / max_score * 100) if max_score > 0 else 0.0
    await db.execute(
        text(
            """
            UPDATE exam_results
            SET total_score = :total, max_score = :max, percentage = :pct, updated_at = NOW()
            WHERE id::text = :result_id
            """
        ),
        {
            "total": total_score,
            "max": max_score,
            "pct": percentage,
            "result_id": str(result_id),
        },
    )

    responses_result = await db.execute(
        text(
            """
            SELECT question_id::text, answer, is_correct, marks_awarded
            FROM session_responses
            WHERE session_id::text = :session_id
            """
        ),
        {"session_id": str(result["session_id"])},
    )
    response_by_question = {
        r["question_id"]: r for r in responses_result.mappings().all()
    }

    questions_result = await db.execute(
        text(
            """
            SELECT eq.question_id::text, eq.marks, q.type, q.title,
                   es.name AS section_name,
                   qv.content, qv.options, qv.correct_answer, qv.marks AS version_marks,
                   qv.explanation
            FROM exam_questions eq
            JOIN exam_sections es ON es.id::text = eq.section_id::text
            JOIN questions q ON q.id::text = eq.question_id::text
            LEFT JOIN question_versions qv ON qv.id::text = q.current_version_id::text
            WHERE eq.exam_id::text = :exam_id
            ORDER BY es.order_index, eq.order_index
            """
        ),
        {"exam_id": str(result["exam_id"])},
    )

    questions = []
    for index, eq in enumerate(questions_result.mappings().all()):
        response = response_by_question.get(eq["question_id"])
        content = parse_json(eq["content"]) or {}
        options = _normalize_options(eq["options"])
        correct_answer = _normalize_answer(eq["correct_answer"])
        candidate_answer = _normalize_answer(response["answer"] if response else None)
        is_correct = response["is_correct"] if response and response["is_correct"] is not None else None
        answered = len(candidate_answer) > 0
        max_marks = float(eq["version_marks"] or eq["marks"] or 0)
        qtype = (eq["type"] or "MCQ").upper()

        raw_marks = (
            float(response["marks_awarded"])
            if response and response["marks_awarded"] is not None
            else None
        )

        if qtype in {"SUBJECTIVE", "CASE_STUDY"} and answered and raw_marks is None:
            inferred_correct, inferred_marks = grade_subjective_answer(
                " ".join(candidate_answer),
                parse_json(eq["correct_answer"]),
                max_marks,
            )
            if inferred_marks is not None:
                is_correct = inferred_correct
                raw_marks = inferred_marks

        if is_correct is None:
            is_correct = _infer_is_correct(eq["type"], candidate_answer, correct_answer)

        marks_awarded = _effective_marks_awarded(
            raw_marks,
            answered=answered,
            is_correct=is_correct,
            max_marks=max_marks,
        )

        questions.append(
            {
                "number": index + 1,
                "questionId": eq["question_id"],
                "type": eq["type"],
                "title": eq["title"] or "Question",
                "text": (content.get("text") or "").strip() or eq["title"] or "Question",
                "sectionName": eq["section_name"],
                "options": options,
                "candidateAnswer": candidate_answer,
                "candidateAnswerLabel": _format_answer_label(candidate_answer, options),
                "correctAnswer": correct_answer,
                "correctAnswerLabel": _format_answer_label(correct_answer, options),
                "isCorrect": is_correct,
                "marksAwarded": marks_awarded,
                "maxMarks": max_marks,
                "explanation": eq["explanation"],
                "answered": answered,
            }
        )

    return {
        "resultId": result["id"],
        "sessionId": str(result["session_id"]),
        "examTitle": result["exam_title"],
        "examCode": result["exam_code"],
        "candidateName": f"{result['first_name'] or ''} {result['last_name'] or ''}".strip(),
        "totalScore": total_score,
        "maxScore": max_score,
        "percentage": percentage,
        "published": bool(result["published"]),
        "questions": questions,
    }


@router.get("/verify/{result_id}")
async def verify_certificate(
    result_id: str,
    db: AsyncSession = Depends(get_db),
):
    result = await _certificate_row(db, result_id, published_only=True)
    passing_score = _passing_score(result.get("exam_settings"))
    percentage = float(result["percentage"] or 0)
    issued_at = result.get("published_at") or result.get("created_at")
    return {
        "valid": True,
        "certificateId": result["id"],
        "certificateNumber": _certificate_number(result["exam_code"], str(result["id"])),
        "candidateName": f"{result['first_name'] or ''} {result['last_name'] or ''}".strip(),
        "examTitle": result["exam_title"],
        "examCode": result["exam_code"],
        "totalScore": float(result["total_score"] or 0),
        "maxScore": float(result["max_score"] or 0),
        "percentage": percentage,
        "passingScore": passing_score,
        "passed": percentage >= passing_score,
        "rank": result["rank"],
        "issuedAt": issued_at.isoformat() if issued_at else None,
    }


@router.get("/my/{result_id}/certificate")
async def my_certificate(
    result_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        candidate_id = await require_candidate_id(db, current_user.id)
    except HTTPException as exc:
        if exc.status_code == 400:
            raise HTTPException(status_code=404, detail="Candidate profile not found") from exc
        raise

    result = await _certificate_row(
        db,
        result_id,
        candidate_id=candidate_id,
        published_only=True,
    )
    passing_score = _passing_score(result.get("exam_settings"))
    percentage = float(result.get("percentage") or 0)
    if percentage < passing_score:
        raise HTTPException(
            status_code=403,
            detail="Certificates are only available when you meet the exam pass score",
        )
    total_candidates = int(
        (
            await db.execute(
                text(
                    """
                    SELECT COUNT(*) FROM exam_results
                    WHERE exam_id::text = :exam_id AND published = true
                    """
                ),
                {"exam_id": str(result["exam_id"])},
            )
        ).scalar()
        or 0
    )
    return _certificate_response(result, total_candidates)


@router.get("/my")
async def my_results(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    row = await db.execute(
        text("SELECT id FROM candidates WHERE user_id = :user_id LIMIT 1"),
        {"user_id": current_user.id},
    )
    candidate_id = row.scalar_one_or_none()
    if not candidate_id:
        return {"items": []}

    rows = await db.execute(
        text(
            """
            SELECT er.id, er.exam_id, er.total_score, er.max_score, er.percentage,
                   er.rank, er.percentile, er.published, er.created_at,
                   e.title AS exam_title, e.code AS exam_code, e.settings AS exam_settings
            FROM exam_results er
            JOIN exams e ON e.id = er.exam_id
            WHERE er.candidate_id = :candidate_id AND er.published = true
            ORDER BY er.created_at DESC
            """
        ),
        {"candidate_id": candidate_id},
    )
    results = rows.mappings().all()
    if not results:
        return {"items": []}

    exam_ids = list({r["exam_id"] for r in results})
    totals_result = await db.execute(
        text(
            """
            SELECT exam_id, COUNT(*) AS total
            FROM exam_results
            WHERE exam_id = ANY(:exam_ids) AND published = true
            GROUP BY exam_id
            """
        ),
        {"exam_ids": exam_ids},
    )
    totals = {r["exam_id"]: int(r["total"]) for r in totals_result.mappings()}

    return {
        "items": [
            {
                "id": r["id"],
                "examId": r["exam_id"],
                "totalScore": float(r["total_score"] or 0),
                "maxScore": float(r["max_score"] or 0),
                "percentage": float(r["percentage"] or 0),
                "rank": r["rank"],
                "percentile": float(r["percentile"]) if r["percentile"] is not None else None,
                "published": bool(r["published"]),
                "createdAt": r["created_at"].isoformat() if r["created_at"] else None,
                "totalCandidates": totals.get(r["exam_id"]),
                "exam": {
                    "title": r["exam_title"],
                    "code": r["exam_code"],
                    "settings": parse_json(r["exam_settings"]),
                },
            }
            for r in results
        ]
    }
