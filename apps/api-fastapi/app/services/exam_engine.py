import json
import random
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.candidate_context import parse_json
from app.services.subjective_grading import grade_subjective_answer


def _negative_marking_enabled(settings) -> bool:
    s = parse_json(settings) or {}
    return s.get("negativeMarking") is True or s.get("negative_marking") is True


def _duration_minutes(settings, start_time=None, end_time=None) -> int:
    s = parse_json(settings) or {}
    configured = s.get("durationMinutes") or s.get("duration_minutes")
    if configured:
        duration = max(1, int(configured))
        if start_time and end_time:
            window_minutes = int((end_time - start_time).total_seconds() // 60)
            if window_minutes > 0:
                return min(duration, window_minutes)
        return duration
    if start_time and end_time:
        window_minutes = int((end_time - start_time).total_seconds() // 60)
        if window_minutes > 0:
            return window_minutes
    return 120


def _time_remaining(started_at, duration_minutes: int, end_time) -> int:
    now = datetime.now(timezone.utc)
    if end_time and getattr(end_time, "tzinfo", None) is None:
        end_time = end_time.replace(tzinfo=timezone.utc)
    if started_at and getattr(started_at, "tzinfo", None) is None:
        started_at = started_at.replace(tzinfo=timezone.utc)

    total = duration_minutes * 60
    if not started_at:
        from_duration = total
    else:
        elapsed = int((now - started_at).total_seconds())
        from_duration = max(0, total - elapsed)

    if not end_time:
        return from_duration
    until_end = max(0, int((end_time - now).total_seconds()))
    return max(0, min(from_duration, until_end))


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


async def _auto_submit_if_expired(db: AsyncSession, session_id: str) -> bool:
    """If session time is up or exam window ended, auto-submit. Returns True if submitted."""
    row = await db.execute(
        text(
            """
            SELECT es.status, es.started_at, e.settings, e.start_time, e.end_time, e.status AS exam_status
            FROM exam_sessions es
            JOIN exams e ON e.id = es.exam_id
            WHERE es.id::text = :sid
            """
        ),
        {"sid": session_id},
    )
    session = row.mappings().first()
    if not session or session["status"] != "IN_PROGRESS":
        return False

    now = datetime.now(timezone.utc)
    end_time = _as_utc(session["end_time"])
    duration = _duration_minutes(session["settings"], session["start_time"], session["end_time"])
    remaining = _time_remaining(session["started_at"], duration, end_time)
    exam_ended = end_time is not None and end_time < now
    exam_unpublished = session["exam_status"] != "PUBLISHED"

    if remaining > 0 and not exam_ended and not exam_unpublished:
        return False

    await db.execute(
        text(
            """
            UPDATE exam_sessions
            SET status = 'AUTO_SUBMITTED', submitted_at = :now, time_remaining_seconds = 0, updated_at = :now
            WHERE id::text = :sid AND status = 'IN_PROGRESS'
            """
        ),
        {"sid": session_id, "now": now},
    )
    await evaluate_session(db, session_id)
    return True


async def reconcile_candidate_sessions(db: AsyncSession, candidate_id: str) -> None:
    rows = await db.execute(
        text(
            """
            SELECT es.id::text AS sid
            FROM exam_sessions es
            WHERE es.candidate_id::text = :cid AND es.status = 'IN_PROGRESS'
            """
        ),
        {"cid": candidate_id},
    )
    for (sid,) in rows.all():
        await _auto_submit_if_expired(db, str(sid))


async def get_session_state(db: AsyncSession, session_id: str, candidate_id: str | None = None) -> dict:
    row = await db.execute(
        text(
            """
            SELECT es.id, es.exam_id, es.candidate_id, es.status, es.started_at,
                   es.time_remaining_seconds, es.question_order, es.risk_score,
                   e.title, e.settings, e.security_policy, e.start_time, e.end_time
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

    if session["status"] == "IN_PROGRESS":
        if await _auto_submit_if_expired(db, session_id):
            return await get_session_state(db, session_id, candidate_id)

    order = session["question_order"]
    if isinstance(order, str):
        order = json.loads(order)
    order = order or []

    duration = _duration_minutes(session["settings"], session["start_time"], session["end_time"])
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
            "endTime": session["end_time"].isoformat() if session["end_time"] else None,
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

    await reconcile_candidate_sessions(db, candidate_id)

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
    if ex["status"] != "PUBLISHED":
        raise HTTPException(
            status_code=400,
            detail="This test is not available yet. An administrator must publish it first.",
        )
    if not ex.get("started"):
        raise HTTPException(status_code=400, detail="Exam has not started yet")
    if not ex["not_ended"]:
        raise HTTPException(status_code=400, detail="Exam has ended")

    settings = parse_json(ex["settings"]) or {}
    max_attempts = int(settings.get("maxAttempts") or settings.get("max_attempts") or 1)
    if max_attempts < 1:
        max_attempts = 1
    completed = await db.execute(
        text(
            """
            SELECT COUNT(*)::int AS cnt FROM exam_sessions
            WHERE exam_id::text = :exam_id
              AND candidate_id::text = :candidate_id
              AND status IN ('SUBMITTED', 'AUTO_SUBMITTED')
            """
        ),
        {"exam_id": exam_id, "candidate_id": candidate_id},
    )
    completed_count = completed.scalar_one() or 0
    if completed_count >= max_attempts:
        raise HTTPException(status_code=400, detail="You have used all allowed attempts for this exam")

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

    duration = _duration_minutes(ex["settings"], ex.get("start_time"), ex.get("end_time"))
    remaining = min(duration * 60, _time_remaining(now, duration, end_time))
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
    *,
    update_answer: bool = True,
):
    now = datetime.now(timezone.utc)
    existing = await db.execute(
        text(
            "SELECT id FROM session_responses WHERE session_id = :sid AND question_id = :qid"
        ),
        {"sid": session_id, "qid": question_id},
    )
    if existing.scalar_one_or_none():
        if update_answer:
            answer_json = json.dumps(answer if isinstance(answer, (dict, list)) else {"value": answer})
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
                    UPDATE session_responses
                    SET marked_for_review = :marked, updated_at = :now
                    WHERE session_id = :sid AND question_id = :qid
                    """
                ),
                {
                    "marked": marked,
                    "now": now,
                    "sid": session_id,
                    "qid": question_id,
                },
            )
        return

    answer_json = (
        json.dumps(answer if isinstance(answer, (dict, list)) else {"value": answer})
        if update_answer and answer is not None
        else None
    )
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


def _normalize_answer_values(answer) -> list[str]:
    if not answer:
        return []
    parsed = parse_json(answer)
    raw = parsed.get("value") if isinstance(parsed, dict) and "value" in parsed else parsed
    if raw is None:
        return []
    if isinstance(raw, list):
        return [str(v) for v in raw if v is not None and str(v).strip()]
    text_val = str(raw).strip()
    return [text_val] if text_val else []


def _infer_is_correct(question_type: str, given: list[str], expected: list[str]) -> bool | None:
    if not given:
        return None
    if not expected:
        return None
    qtype = (question_type or "MCQ").upper()
    if qtype == "MSQ":
        exp_set = {a.lower() for a in expected}
        giv_set = {a.lower() for a in given}
        return (
            all(a.lower() in giv_set for a in expected)
            and all(a.lower() in exp_set for a in given)
            and len(expected) > 0
        )
    if qtype == "NUMERICAL":
        try:
            return abs(float(given[0]) - float(expected[0])) < 0.001
        except (ValueError, IndexError):
            return False
    if qtype in {"SUBJECTIVE", "CASE_STUDY", "CODING", "AUDIO", "VIDEO"}:
        return None
    return str(given[0]).strip().lower() == str(expected[0]).strip().lower()


def _score_response(
    question_type: str,
    given: list[str],
    expected: list[str],
    marks: float,
    negative: float,
    correct_raw=None,
) -> tuple[bool | None, float | None]:
    qtype = (question_type or "MCQ").upper()
    if qtype in {"SUBJECTIVE", "CASE_STUDY"}:
        answer_text = " ".join(given) if given else ""
        return grade_subjective_answer(answer_text, correct_raw, marks)

    if not given:
        return None, 0.0
    is_correct = _infer_is_correct(question_type, given, expected)
    if is_correct is True:
        return True, marks
    if is_correct is False:
        awarded = -negative if negative > 0 else 0.0
        return False, awarded
    return None, None


async def grade_session_responses(db: AsyncSession, session_id: str, exam_id: str) -> tuple[float, float]:
    """Persist is_correct and marks_awarded on each response; return (total_score, max_score)."""
    exam_row = await db.execute(
        text("SELECT settings FROM exams WHERE id::text = :exam_id"),
        {"exam_id": str(exam_id)},
    )
    exam = exam_row.mappings().first()
    negative_marking_enabled = _negative_marking_enabled(exam["settings"] if exam else None)

    eq_rows = await db.execute(
        text(
            """
            SELECT eq.question_id::text, eq.marks, eq.negative_marks, q.type,
                   qv.correct_answer, qv.marks AS v_marks
            FROM exam_questions eq
            JOIN questions q ON q.id::text = eq.question_id::text
            LEFT JOIN question_versions qv ON qv.id::text = q.current_version_id::text
            WHERE eq.exam_id::text = :exam_id
            """
        ),
        {"exam_id": str(exam_id)},
    )
    question_meta: dict[str, dict] = {}
    max_score = 0.0
    for r in eq_rows.mappings():
        marks = float(r["marks"] or r["v_marks"] or 0)
        max_score += marks
        correct = parse_json(r["correct_answer"])
        expected = _normalize_answer_values(correct if correct is not None else None)
        if not expected and isinstance(correct, dict) and "value" in correct:
            expected = _normalize_answer_values(correct)
        elif not expected and correct is not None:
            expected = _normalize_answer_values({"value": correct})
        question_meta[r["question_id"]] = {
            "type": r["type"] or "MCQ",
            "marks": marks,
            "negative": float(r["negative_marks"] or 0),
            "expected": expected,
            "correct": correct,
        }

    resp_rows = await db.execute(
        text(
            """
            SELECT question_id::text, answer, marks_awarded
            FROM session_responses
            WHERE session_id::text = :sid
            """
        ),
        {"sid": str(session_id)},
    )
    responses = {r["question_id"]: r for r in resp_rows.mappings().all()}
    now = datetime.now(timezone.utc)
    total_score = 0.0

    for qid, meta in question_meta.items():
        response = responses.get(qid)
        qtype = (meta["type"] or "MCQ").upper()
        preserve_marks = qtype in {"SUBJECTIVE", "CASE_STUDY", "MSQ"}
        if response and preserve_marks and response.get("marks_awarded") is not None:
            total_score += float(response["marks_awarded"])
            continue

        given = _normalize_answer_values(response["answer"] if response else None)
        effective_negative = meta["negative"] if negative_marking_enabled else 0.0
        is_correct, marks_awarded = _score_response(
            meta["type"],
            given,
            meta["expected"],
            meta["marks"],
            effective_negative,
            meta.get("correct"),
        )
        if marks_awarded is None:
            continue
        total_score += marks_awarded

        if response:
            await db.execute(
                text(
                    """
                    UPDATE session_responses
                    SET is_correct = :is_correct,
                        marks_awarded = :marks,
                        updated_at = :now
                    WHERE session_id::text = :sid AND question_id::text = :qid
                    """
                ),
                {
                    "is_correct": is_correct,
                    "marks": marks_awarded,
                    "now": now,
                    "sid": str(session_id),
                    "qid": qid,
                },
            )

    return total_score, max_score


async def evaluate_session(db: AsyncSession, session_id: str) -> dict:
    session = await db.execute(
        text("SELECT exam_id, candidate_id FROM exam_sessions WHERE id = :sid"),
        {"sid": session_id},
    )
    s = session.mappings().first()
    if not s:
        raise HTTPException(status_code=404, detail="Session not found")

    total_score, max_score = await grade_session_responses(db, str(session_id), str(s["exam_id"]))
    percentage = (total_score / max_score * 100) if max_score > 0 else 0.0
    now = datetime.now(timezone.utc)

    existing = await db.execute(
        text("SELECT id FROM exam_results WHERE session_id = :sid"),
        {"sid": session_id},
    )
    row = existing.mappings().first()
    if row:
        await db.execute(
            text(
                """
                UPDATE exam_results
                SET total_score = :total, max_score = :max, percentage = :pct, updated_at = :now
                WHERE session_id = :sid
                """
            ),
            {"total": total_score, "max": max_score, "pct": percentage, "now": now, "sid": session_id},
        )
        return {
            "id": row["id"],
            "totalScore": total_score,
            "maxScore": max_score,
            "percentage": percentage,
        }

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
