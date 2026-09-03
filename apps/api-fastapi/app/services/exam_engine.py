import json
import random
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.candidate_context import parse_json


def _duration_minutes(settings) -> int:
    s = parse_json(settings) or {}
    return int(s.get("durationMinutes") or 120)


def _time_remaining(started_at, duration_minutes: int, end_time) -> int:
    total = duration_minutes * 60
    now = datetime.now(timezone.utc)
    if started_at and getattr(started_at, "tzinfo", None) is None:
        started_at = started_at.replace(tzinfo=timezone.utc)
    if end_time and getattr(end_time, "tzinfo", None) is None:
        end_time = end_time.replace(tzinfo=timezone.utc)
    if not started_at:
        return total
    elapsed = int((now - started_at).total_seconds())
    remaining = max(0, total - elapsed)
    if end_time:
        until_end = int((end_time - now).total_seconds())
        remaining = max(0, min(remaining, until_end))
    return remaining


async def _load_questions(db: AsyncSession, exam_id: str, question_order: list[str]) -> list[dict]:
    if not question_order:
        rows = await db.execute(
            text(
                """
                SELECT eq.question_id, eq.section_id, eq.marks, eq.negative_marks,
                       q.type, q.title, qv.content, qv.options
                FROM exam_questions eq
                JOIN questions q ON q.id = eq.question_id
                LEFT JOIN question_versions qv ON qv.id = q.current_version_id
                WHERE eq.exam_id = :exam_id
                ORDER BY eq.order_index
                """
            ),
            {"exam_id": exam_id},
        )
        order = [r["question_id"] for r in rows.mappings()]
    else:
        order = question_order
        rows = await db.execute(
            text(
                """
                SELECT eq.question_id, eq.section_id, eq.marks, eq.negative_marks,
                       q.type, q.title, qv.content, qv.options
                FROM exam_questions eq
                JOIN questions q ON q.id = eq.question_id
                LEFT JOIN question_versions qv ON qv.id = q.current_version_id
                WHERE eq.exam_id = :exam_id
                """
            ),
            {"exam_id": exam_id},
        )
    by_id = {r["question_id"]: r for r in rows.mappings()}
    questions = []
    for qid in order:
        r = by_id.get(qid)
        if not r:
            continue
        questions.append(
            {
                "id": r["question_id"],
                "sectionId": r["section_id"],
                "type": r["type"],
                "title": r["title"],
                "content": parse_json(r["content"]),
                "options": parse_json(r["options"]),
                "marks": float(r["marks"] or 0),
                "negativeMarks": float(r["negative_marks"] or 0),
            }
        )
    return questions


async def get_session_state(db: AsyncSession, session_id: str, candidate_id: str | None = None) -> dict:
    row = await db.execute(
        text(
            """
            SELECT es.id, es.exam_id, es.candidate_id, es.status, es.started_at,
                   es.time_remaining_seconds, es.question_order, es.risk_score,
                   e.title, e.settings, e.security_policy, e.end_time
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
    if candidate_id and str(session["candidate_id"]) != str(candidate_id):
        raise HTTPException(status_code=403, detail="Session does not belong to this candidate")

    order = session["question_order"]
    if isinstance(order, str):
        order = json.loads(order)
    order = order or []

    duration = _duration_minutes(session["settings"])
    remaining = _time_remaining(session["started_at"], duration, session["end_time"])

    responses = await db.execute(
        text(
            """
            SELECT question_id, answer, marked_for_review
            FROM session_responses WHERE session_id = :session_id
            """
        ),
        {"session_id": session_id},
    )

    return {
        "sessionId": session["id"],
        "examId": session["exam_id"],
        "status": session["status"],
        "timeRemainingSeconds": remaining,
        "exam": {
            "id": session["exam_id"],
            "title": session["title"],
            "settings": parse_json(session["settings"]),
            "securityPolicy": parse_json(session["security_policy"]),
        },
        "riskScore": float(session["risk_score"] or 0),
        "questions": await _load_questions(db, session["exam_id"], order),
        "responses": [
            {
                "questionId": r["question_id"],
                "answer": parse_json(r["answer"]),
                "markedForReview": bool(r["marked_for_review"]),
            }
            for r in responses.mappings()
        ],
    }


def _as_utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


async def _exam_access_window(db: AsyncSession, exam_id: str) -> dict:
    row = await db.execute(
        text(
            """
            SELECT status, settings, start_time, end_time,
                   (start_time IS NULL OR start_time <= NOW()) AS started,
                   (end_time IS NULL OR end_time >= NOW()) AS not_ended
            FROM exams
            WHERE id::text = :exam_id
            """
        ),
        {"exam_id": str(exam_id)},
    )
    ex = row.mappings().first()
    if not ex:
        raise HTTPException(status_code=404, detail="Exam not found")
    return dict(ex)


async def start_session(db: AsyncSession, exam_id: str, candidate_id: str) -> dict:
    exam_id = str(exam_id)
    candidate_id = str(candidate_id)

    existing = await db.execute(
        text(
            """
            SELECT id::text FROM exam_sessions
            WHERE exam_id::text = :exam_id
              AND candidate_id::text = :candidate_id
              AND status = 'IN_PROGRESS'
            LIMIT 1
            """
        ),
        {"exam_id": exam_id, "candidate_id": candidate_id},
    )
    sid = existing.scalar_one_or_none()
    if sid:
        return await get_session_state(db, sid, candidate_id)

    reg = await db.execute(
        text(
            """
            SELECT id::text FROM exam_registrations
            WHERE exam_id::text = :exam_id AND candidate_id::text = :candidate_id
            """
        ),
        {"exam_id": exam_id, "candidate_id": candidate_id},
    )
    registration_id = reg.scalar_one_or_none()
    if not registration_id:
        raise HTTPException(status_code=400, detail="Not registered for this exam")

    ex = await _exam_access_window(db, exam_id)
    if ex["status"] not in ("PUBLISHED", "IN_PROGRESS"):
        raise HTTPException(status_code=400, detail="Exam is not available")
    if not ex["not_ended"]:
        raise HTTPException(status_code=400, detail="Exam has ended")

    now = datetime.now(timezone.utc)
    end_time = _as_utc(ex["end_time"])

    qrows = await db.execute(
        text(
            """
            SELECT eq.question_id::text, es.id::text AS section_id
            FROM exam_questions eq
            JOIN exam_sections es ON es.id::text = eq.section_id::text
            WHERE eq.exam_id::text = :exam_id
            ORDER BY es.order_index, eq.order_index
            """
        ),
        {"exam_id": exam_id},
    )
    questions = qrows.mappings().all()
    if not questions:
        raise HTTPException(status_code=400, detail="Exam has no questions")

    question_order = [q["question_id"] for q in questions]
    settings = parse_json(ex["settings"]) or {}
    if settings.get("shuffleQuestions"):
        random.shuffle(question_order)

    duration = _duration_minutes(ex["settings"])
    remaining = _time_remaining(now, duration, end_time)
    session_id = str(uuid.uuid4())
    first_section = questions[0]["section_id"]

    await db.execute(
        text(
            """
            INSERT INTO exam_sessions
              (id, exam_id, candidate_id, registration_id, status, started_at,
               time_remaining_seconds, current_section_id, question_order, risk_score,
               created_at, updated_at)
            VALUES
              (:id, :exam_id, :candidate_id, :registration_id, 'IN_PROGRESS', :now,
               :remaining, :section_id, CAST(:question_order AS jsonb), 0, :now, :now)
            """
        ),
        {
            "id": session_id,
            "exam_id": exam_id,
            "candidate_id": candidate_id,
            "registration_id": registration_id,
            "now": now,
            "remaining": remaining,
            "section_id": first_section,
            "question_order": json.dumps(question_order),
        },
    )
    return await get_session_state(db, session_id, candidate_id)


async def _upsert_response(
    db: AsyncSession,
    session_id: str,
    question_id: str,
    answer,
    time_spent: int = 0,
    marked: bool = False,
):
    now = datetime.now(timezone.utc)
    answer_json = json.dumps(answer if isinstance(answer, (dict, list)) else {"value": answer})
    existing = await db.execute(
        text(
            "SELECT id FROM session_responses WHERE session_id = :sid AND question_id = :qid"
        ),
        {"sid": session_id, "qid": question_id},
    )
    if existing.scalar_one_or_none():
        await db.execute(
            text(
                """
                UPDATE session_responses
                SET answer = CAST(:answer AS jsonb), time_spent_seconds = :time_spent,
                    marked_for_review = :marked, answered_at = :now, updated_at = :now
                WHERE session_id = :sid AND question_id = :qid
                """
            ),
            {
                "answer": answer_json,
                "time_spent": time_spent,
                "marked": marked,
                "now": now,
                "sid": session_id,
                "qid": question_id,
            },
        )
    else:
        await db.execute(
            text(
                """
                INSERT INTO session_responses
                  (id, session_id, question_id, answer, marked_for_review,
                   time_spent_seconds, answered_at, updated_at)
                VALUES
                  (:id, :sid, :qid, CAST(:answer AS jsonb), :marked, :time_spent, :now, :now)
                """
            ),
            {
                "id": str(uuid.uuid4()),
                "sid": session_id,
                "qid": question_id,
                "answer": answer_json,
                "marked": marked,
                "time_spent": time_spent,
                "now": now,
            },
        )


async def evaluate_session(db: AsyncSession, session_id: str) -> dict:
    existing = await db.execute(
        text("SELECT id, total_score, max_score, percentage FROM exam_results WHERE session_id = :sid"),
        {"sid": session_id},
    )
    row = existing.mappings().first()
    if row:
        return {
            "id": row["id"],
            "totalScore": float(row["total_score"]),
            "maxScore": float(row["max_score"]),
            "percentage": float(row["percentage"]),
        }

    session = await db.execute(
        text("SELECT exam_id, candidate_id FROM exam_sessions WHERE id = :sid"),
        {"sid": session_id},
    )
    s = session.mappings().first()
    if not s:
        raise HTTPException(status_code=404, detail="Session not found")

    eq_rows = await db.execute(
        text(
            """
            SELECT eq.question_id, eq.marks, eq.negative_marks, qv.correct_answer, qv.marks AS v_marks
            FROM exam_questions eq
            JOIN questions q ON q.id = eq.question_id
            LEFT JOIN question_versions qv ON qv.id = q.current_version_id
            WHERE eq.exam_id = :exam_id
            """
        ),
        {"exam_id": s["exam_id"]},
    )
    max_score = 0.0
    correct_map: dict[str, dict] = {}
    for r in eq_rows.mappings():
        marks = float(r["marks"] or r["v_marks"] or 0)
        max_score += marks
        correct_map[r["question_id"]] = {
            "correct": parse_json(r["correct_answer"]),
            "marks": marks,
            "negative": float(r["negative_marks"] or 0),
        }

    resp_rows = await db.execute(
        text("SELECT question_id, answer FROM session_responses WHERE session_id = :sid"),
        {"sid": session_id},
    )
    total_score = 0.0
    for r in resp_rows.mappings():
        meta = correct_map.get(r["question_id"])
        if not meta:
            continue
        ans = parse_json(r["answer"]) or {}
        given = ans.get("value") if isinstance(ans, dict) else ans
        expected = (meta["correct"] or {}).get("value") if isinstance(meta["correct"], dict) else meta["correct"]
        if given is not None and str(given).lower() == str(expected).lower():
            total_score += meta["marks"]
        elif given not in (None, ""):
            total_score -= meta["negative"]

    percentage = (total_score / max_score * 100) if max_score > 0 else 0.0
    now = datetime.now(timezone.utc)
    result_id = str(uuid.uuid4())
    await db.execute(
        text(
            """
            INSERT INTO exam_results
              (id, session_id, exam_id, candidate_id, total_score, max_score, percentage,
               evaluation_status, published, created_at, updated_at)
            VALUES
              (:id, :sid, :exam_id, :candidate_id, :total, :max, :pct, 'AUTO_EVALUATED', false, :now, :now)
            """
        ),
        {
            "id": result_id,
            "sid": session_id,
            "exam_id": s["exam_id"],
            "candidate_id": s["candidate_id"],
            "total": total_score,
            "max": max_score,
            "pct": percentage,
            "now": now,
        },
    )
    return {"id": result_id, "totalScore": total_score, "maxScore": max_score, "percentage": percentage}
