import asyncio
import json
import hashlib
import logging
import random
import uuid
from datetime import datetime, timezone
from pathlib import Path

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.config import settings
from app.core.security import get_current_user
from app.core.exam_utils import DEFAULT_EXAM_TIMEZONE, get_draft_exam_window
from app.models.user import User
from app.routers.batches import _uploaded_chapter_ids
from app.services.material_storage import extract_material_text, chunk_material_text

router = APIRouter(prefix="/ai", tags=["AI"])
logger = logging.getLogger(__name__)

_OPENAI_ENV_FILE = Path(__file__).resolve().parents[2] / ".env"
_OPENAI_ENV_NAMES = ("OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_MODEL")


def _refresh_openai_settings() -> None:
    """Pick up a replaced API key without restarting the dev server."""
    if not _OPENAI_ENV_FILE.is_file():
        return
    try:
        contents = _OPENAI_ENV_FILE.read_text(encoding="utf-8-sig")
    except OSError:
        logger.warning("Could not read %s for OpenAI settings", _OPENAI_ENV_FILE)
        return

    values: dict[str, str] = {}
    for raw_line in contents.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, raw_value = line.split("=", 1)
        name = name.strip()
        if name not in _OPENAI_ENV_NAMES:
            continue
        value = raw_value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        values[name] = value.strip()

    if "OPENAI_API_KEY" in values:
        settings.OPENAI_API_KEY = values["OPENAI_API_KEY"]
    if values.get("OPENAI_BASE_URL"):
        settings.OPENAI_BASE_URL = values["OPENAI_BASE_URL"]
    if values.get("OPENAI_MODEL"):
        settings.OPENAI_MODEL = values["OPENAI_MODEL"]


def _ai_provider_error_detail(action: str, exc: httpx.HTTPStatusError) -> str:
    status = exc.response.status_code
    code = ""
    try:
        body = exc.response.json()
    except ValueError:
        body = None
    error = body.get("error") if isinstance(body, dict) else None
    if isinstance(error, dict):
        code = str(error.get("code") or "")
    if status in (401, 403) or code in {"token_invalidated", "invalid_api_key"}:
        return (
            "OpenAI rejected this API key. "
            "Replace OPENAI_API_KEY in apps/api-fastapi/.env with a new key, then create the test again."
        )
    provider_detail = exc.response.text[:500].strip()
    return (
        f"AI provider rejected the {action} request ({status}): "
        f"{provider_detail or exc.response.reason_phrase}"
    )


class GenerateReferenceAnswerBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    question_text: str = Field(alias="questionText")
    question_type: str = Field("SUBJECTIVE", alias="questionType")
    subject_name: str | None = Field(None, alias="subjectName")
    chapter_title: str | None = Field(None, alias="chapterTitle")
    chapter_id: str | None = Field(None, alias="chapterId")
    options: dict[str, str] | None = None
    regenerate: bool = False


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
    shuffle_questions: bool = Field(True, alias="shuffleQuestions")


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

    if not uploaded and requested and not settings.OPENAI_API_KEY.strip():
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
        if chapter_ids:
            return chapter_ids

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


async def _load_rag_context(
    db: AsyncSession,
    tenant_id: str,
    chapter_ids: list[str],
    topic_ids: list[str] | None,
    retry_indexing: bool = True,
) -> list[dict]:
    if not chapter_ids:
        return []
    topic_clause = ""
    params: dict[str, object] = {
        "tenant_id": tenant_id,
        "chapter_ids": [str(chapter_id) for chapter_id in chapter_ids],
    }
    if topic_ids:
        topic_clause = """
        AND (
        dc.topic_id::text = ANY(CAST(:topic_ids AS text[]))
            OR dc.topic_id IS NULL
        )
        """
        params["topic_ids"] = [str(topic_id) for topic_id in topic_ids]

    rows = await db.execute(
        text(
            f"""
            SELECT dc.id::text, dc.chapter_id::text, dc.page_number, dc.content
            FROM document_chunks dc
            JOIN study_materials sm ON sm.id = dc.material_id
            WHERE sm.tenant_id::text = :tenant_id
              AND sm.status = 'READY'
              AND NULLIF(BTRIM(dc.content), '') IS NOT NULL
              AND (
                  dc.chapter_id::text = ANY(CAST(:chapter_ids AS text[]))
                  OR sm.chapter_id::text = ANY(CAST(:chapter_ids AS text[]))
                  OR (
                      dc.chapter_id IS NULL
                      AND sm.book_id::text IN (
                          SELECT c.book_id::text
                          FROM chapters c
                          WHERE c.id::text = ANY(CAST(:chapter_ids AS text[]))
                      )
                  )
                  OR (
                      dc.chapter_id IS NULL
                      AND sm.subject_id::text IN (
                          SELECT b.subject_id::text
                          FROM chapters c
                          JOIN books b ON b.id::text = c.book_id::text
                          WHERE c.id::text = ANY(CAST(:chapter_ids AS text[]))
                      )
                      AND sm.academic_class_id::text IN (
                          SELECT s.academic_class_id::text
                          FROM chapters c
                          JOIN books b ON b.id::text = c.book_id::text
                          JOIN subjects s ON s.id::text = b.subject_id::text
                          WHERE c.id::text = ANY(CAST(:chapter_ids AS text[]))
                      )
                  )
              )
              {topic_clause}
            ORDER BY dc.chapter_id, dc.chunk_index
            LIMIT 20
            """
        ),
        params,
    )
    context = [dict(row._mapping) for row in rows.all() if row.content]
    if context or not retry_indexing:
        return context

    await _reindex_selected_materials(db, tenant_id, chapter_ids)
    return await _load_rag_context(db, tenant_id, chapter_ids, topic_ids, retry_indexing=False)


async def _reindex_selected_materials(
    db: AsyncSession,
    tenant_id: str,
    chapter_ids: list[str],
) -> None:
    """Repair READY materials whose chunks are missing before AI generation."""
    materials = await db.execute(
        text(
            """
            SELECT DISTINCT sm.id, sm.file_url, sm.mime_type, sm.file_name,
                   sm.academic_class_id, sm.subject_id, sm.chapter_id, sm.topic_id
            FROM study_materials sm
            WHERE sm.tenant_id::text = :tenant_id
              AND sm.status IN ('READY', 'INDEXING', 'FAILED')
              AND (
                  sm.chapter_id::text = ANY(CAST(:chapter_ids AS text[]))
                  OR sm.book_id::text IN (
                      SELECT c.book_id::text
                      FROM chapters c
                      WHERE c.id::text = ANY(CAST(:chapter_ids AS text[]))
                  )
                  OR (
                      sm.subject_id::text IN (
                          SELECT b.subject_id::text
                          FROM chapters c
                          JOIN books b ON b.id::text = c.book_id::text
                          WHERE c.id::text = ANY(CAST(:chapter_ids AS text[]))
                      )
                      AND sm.academic_class_id::text IN (
                          SELECT s.academic_class_id::text
                          FROM chapters c
                          JOIN books b ON b.id::text = c.book_id::text
                          JOIN subjects s ON s.id::text = b.subject_id::text
                          WHERE c.id::text = ANY(CAST(:chapter_ids AS text[]))
                      )
                  )
              )
            """
        ),
        {"tenant_id": tenant_id, "chapter_ids": [str(cid) for cid in chapter_ids]},
    )

    now = datetime.now(timezone.utc)
    for material in materials.mappings().all():
        try:
            extracted = extract_material_text(
                material["file_url"], material["mime_type"], material["file_name"]
            )
            chunks = chunk_material_text(extracted)
            if not chunks:
                continue
            await db.execute(
                text("DELETE FROM document_chunks WHERE material_id = :material_id"),
                {"material_id": material["id"]},
            )
            for index, content in enumerate(chunks):
                await db.execute(
                    text(
                        """
                        INSERT INTO document_chunks
                          (id, material_id, content, chunk_index, academic_class_id, subject_id,
                           chapter_id, topic_id, created_at)
                        VALUES
                          (:id, :material_id, :content, :chunk_index, :academic_class_id, :subject_id,
                           :chapter_id, :topic_id, :created_at)
                        """
                    ),
                    {
                        "id": str(uuid.uuid4()),
                        "material_id": material["id"],
                        "content": content,
                        "chunk_index": index,
                        "academic_class_id": material["academic_class_id"],
                        "subject_id": material["subject_id"],
                        "chapter_id": material["chapter_id"],
                        "topic_id": material["topic_id"],
                        "created_at": now,
                    },
                )
            await db.execute(
                text(
                    """
                    UPDATE study_materials
                    SET status = 'READY', chunk_count = :chunk_count,
                        indexed_at = :indexed_at, updated_at = :updated_at,
                        error_message = NULL
                    WHERE id = :material_id
                    """
                ),
                {
                    "material_id": material["id"],
                    "chunk_count": len(chunks),
                    "indexed_at": now,
                    "updated_at": now,
                },
            )
        except Exception as exc:
            logger.warning("Automatic material reindex failed for %s: %s", material["id"], exc)


async def _load_recent_question_fingerprints(
    db: AsyncSession, tenant_id: str, limit: int = 200
) -> set[str]:
    rows = await db.execute(
        text(
            """
            SELECT qv.content->>'text' AS question_text
            FROM questions q
            JOIN question_versions qv ON qv.id = q.current_version_id
            WHERE q.tenant_id::text = :tenant_id
              AND qv.content->>'text' IS NOT NULL
            ORDER BY q.created_at DESC
            LIMIT :limit
            """
        ),
        {"tenant_id": tenant_id, "limit": limit},
    )
    return {
        hashlib.sha256(" ".join(str(row[0]).lower().split()).encode()).hexdigest()
        for row in rows.all()
        if row[0]
    }


def _question_fingerprint(text_value: str) -> str:
    normalized = " ".join(text_value.lower().split())
    return hashlib.sha256(normalized.encode()).hexdigest()


QUESTION_TYPE_ALIASES = {
    "MCQ": "MCQ",
    "MULTIPLE_CHOICE": "MCQ",
    "MULTIPLECHOICE": "MCQ",
    "MSQ": "MSQ",
    "MULTIPLE_SELECT": "MSQ",
    "MULTIPLESELECT": "MSQ",
    "NUMERICAL": "NUMERICAL",
    "SUBJECTIVE": "SUBJECTIVE",
    "CASE_STUDY": "CASE_STUDY",
    "CASESTUDY": "CASE_STUDY",
}


def _normalize_question_types(question_types: list[str] | None) -> list[str]:
    requested = question_types or ["MCQ"]
    types = [QUESTION_TYPE_ALIASES.get(str(question_type).strip().upper()) for question_type in requested]
    if any(question_type is None for question_type in types):
        unsupported = [str(question_type) for question_type, normalized in zip(requested, types) if normalized is None]
        raise HTTPException(status_code=400, detail=f"Unsupported question type(s): {', '.join(unsupported)}")
    return [question_type for question_type in types if question_type]


def _normalize_multiple_choice_options(raw_options: object) -> dict[str, str]:
    """Accept common model variations while keeping the persisted shape stable."""
    if isinstance(raw_options, dict):
        entries = list(raw_options.items())
    elif isinstance(raw_options, list):
        entries = []
        for index, option in enumerate(raw_options):
            if isinstance(option, dict):
                value = option.get("text") or option.get("value") or option.get("content")
            else:
                value = option
            entries.append((str(index + 1), value))
    else:
        return {}

    label_aliases = {
        "a": "a",
        "b": "b",
        "c": "c",
        "d": "d",
        "1": "a",
        "2": "b",
        "3": "c",
        "4": "d",
    }
    options: dict[str, str] = {}
    for key, value in entries:
        cleaned_key = str(key).strip().lower().replace("option", "").strip()
        cleaned_key = cleaned_key.strip("()[]. :-")
        label = label_aliases.get(cleaned_key)
        text_value = str(value).strip() if value is not None else ""
        if label and text_value and label not in options:
            options[label] = text_value
    return options


def _normalize_answer_value(value: object) -> object:
    label_aliases = {"1": "a", "2": "b", "3": "c", "4": "d"}
    if isinstance(value, list):
        return [label_aliases.get(str(item).strip().lower(), str(item).strip().lower()) for item in value]
    normalized = str(value).strip().lower()
    return label_aliases.get(normalized, normalized)


def _is_placeholder_reference_answer(text: str) -> bool:
    normalized = text.strip().lower()
    if not normalized:
        return True
    placeholder_prefixes = (
        "a correct answer accurately explains",
        "a correct answer identifies and accurately explains",
        "a complete response should",
        "the response should correctly explain",
    )
    return any(normalized.startswith(prefix) for prefix in placeholder_prefixes)


def _generation_source_label(context_chunks: list[dict], used_fallback: bool) -> str:
    if used_fallback or not settings.OPENAI_API_KEY.strip():
        return "dummy"
    return "rag" if context_chunks else "openai"


def _generation_success_message(source: str) -> str:
    if source == "rag":
        return (
            "Draft exam generated with AI questions grounded in uploaded material. "
            "Review and edit it, then publish from Class Tests."
        )
    if source == "openai":
        return (
            "Draft exam generated with OpenAI (questions and reference answers). "
            "Upload and index books for NCERT-grounded content, then review before publishing."
        )
    return (
        "OpenAI was unavailable; draft exam contains type-correct fallback questions. "
        "Edit reference answers or regenerate them with AI before publishing."
    )


def _normalize_msq_answer_value(value: object) -> object:
    if isinstance(value, str):
        candidate = value.strip()
        if candidate.startswith("[") and candidate.endswith("]"):
            try:
                value = json.loads(candidate)
            except json.JSONDecodeError:
                pass
        if isinstance(value, str):
            value = candidate.replace(" and ", ",")
            value = [part.strip() for part in value.split(",") if part.strip()]
    return _normalize_answer_value(value)


def _try_accept_ai_question_candidate(
    item: dict,
    *,
    types: list[str],
    slot_index: int,
    seen_fingerprints: set[str],
    strict_type_order: bool,
) -> tuple[dict, str] | None:
    """Validate one AI question payload; return (item, type) or None if rejected."""
    if not isinstance(item, dict):
        return None

    correct_value = str(
        (item.get("correct_answer") or item.get("correctAnswer") or {}).get("value", "")
    ).strip()
    content_text = str((item.get("content") or {}).get("text", "")).strip()

    if not correct_value:
        return None
    if len(content_text) < 15:
        return None

    allowed_types = set(types)
    item_type_raw = str(item.get("type") or "").strip().upper()
    item_type = QUESTION_TYPE_ALIASES.get(item_type_raw)
    expected_type = types[slot_index % len(types)]
    if item_type is None:
        item_type = expected_type
    elif item_type != expected_type:
        if strict_type_order:
            return None
        if item_type not in allowed_types:
            return None

    if item_type in {"SUBJECTIVE", "CASE_STUDY"} and _is_placeholder_reference_answer(correct_value):
        return None

    raw_options = item.get("options")
    looks_like_choice = item_type in {"MCQ", "MSQ"} or (
        item_type is None and raw_options not in (None, {}, [])
    )
    if looks_like_choice:
        normalized_options = _normalize_multiple_choice_options(raw_options)
        if set(normalized_options) != set("abcd"):
            return None

    fp = _question_fingerprint(content_text)
    if fp in seen_fingerprints:
        return None

    seen_fingerprints.add(fp)
    return item, item_type


async def _generate_questions(
    chapters: list[dict],
    count: int,
    difficulty: str,
    question_types: list[str] | None,
    context_chunks: list[dict],
    existing_fingerprints: set[str] | None = None,
) -> tuple[list[dict], str]:
    if not chapters:
        return [], "dummy"
    difficulty = (difficulty or "MEDIUM").upper()
    types = _normalize_question_types(question_types)
    if not settings.OPENAI_API_KEY.strip():
        return _dummy_questions(chapters, count, difficulty, types), "dummy"

    topics = ", ".join(f'{chapter["subject_name"]}: {chapter["title"]}' for chapter in chapters)
    if context_chunks:
        context = "\n\n".join(
            f"[Chapter {chunk['chapter_id']}, page {chunk['page_number'] or 'unknown'}]\n{chunk['content']}"
            for chunk in context_chunks
        )
        system_prompt = (
            "You write original, accurate CBT exam questions grounded strictly in the supplied source context. "
            "Return only valid JSON with a questions array. "
            "Each item must include title, type, content.text, options, correct_answer.value, optional "
            "correct_answer.rubric, correct_answer.keywords (array of 5-10 important terms from the "
            "reference answer for auto-grading), marks, and negative_marks. Use only the requested types. "
            "For MCQ and MSQ, options must be an object with exactly the lowercase keys a, b, c, and d; "
            "for NUMERICAL, SUBJECTIVE, and CASE_STUDY, options must be an empty object. "
            "For SUBJECTIVE and CASE_STUDY, correct_answer.value must be a full model answer (3-6 sentences), "
            "never a meta sentence describing what a good answer should do."
        )
    else:
        context = ""
        logger.warning(
            "AI test generation has no indexed context; generating questions and answers from chapter topics via OpenAI"
        )
        system_prompt = (
            "You write original CBT exam questions for Indian NCERT-style syllabus chapters listed in topics. "
            "Return only valid JSON with a questions array. "
            "Each item must include title, type, content.text, options, correct_answer.value, optional "
            "correct_answer.rubric, correct_answer.keywords (array of 5-10 important terms from the "
            "reference answer for auto-grading), marks, and negative_marks. Use only the requested types. "
            "For MCQ and MSQ, write four distinct, chapter-specific options (keys a,b,c,d) and mark the correct key(s). "
            "For NUMERICAL, SUBJECTIVE, and CASE_STUDY, options must be an empty object. "
            "For SUBJECTIVE and CASE_STUDY, correct_answer.value must be a complete model answer with concrete facts, "
            "not a placeholder like 'A correct answer accurately explains...'. "
            "correct_answer.rubric must describe how to award marks."
        )
    prompt = {
        "count": count,
        "difficulty": difficulty,
        "question_types": types,
        "type_order": (
            "Use the requested question types in repeating order for the questions: "
            + ", ".join(types)
        ),
        "topics": topics,
        "source_context": context,
        "requirements": {
            "MCQ": "exactly four options a,b,c,d and one correct answer",
            "MSQ": "exactly four options a,b,c,d and at least two correct answers",
            "NUMERICAL": "a numerical answer in correct_answer.value and no options",
            "SUBJECTIVE": "an open-ended question with a full reference answer and rubric",
            "CASE_STUDY": "a case-based open-ended question with a full reference answer and rubric",
        },
    }
    request_payload = {
        "model": settings.OPENAI_MODEL,
        "temperature": 0.7,
        "max_completion_tokens": max(3000, count * 700),
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": json.dumps(prompt)},
        ],
    }

    seen_fingerprints = set(existing_fingerprints or ())
    items: list[tuple[dict, str]] = []
    max_attempts = 8

    try:
        for attempt in range(max_attempts):
            remaining = count - len(items)
            if remaining <= 0:
                break

            # Ask for extra candidates on retries so dropped/duplicate items
            # do not leave the test short.
            if attempt == 0:
                ask_for = remaining
            else:
                ask_for = remaining + max(3, len(types) * 2)

            slot_types = [types[(len(items) + i) % len(types)] for i in range(ask_for)]
            request_prompt = {
                **prompt,
                "count": ask_for,
                "question_type_slots": slot_types,
                "requirements": {
                    **prompt["requirements"],
                    "count_rule": (
                        f"Return exactly {ask_for} complete questions in the questions array. "
                        "Do not return fewer. Match each question's type to question_type_slots in order."
                    ),
                },
            }
            request_payload["messages"][-1] = {
                "role": "user",
                "content": json.dumps(request_prompt),
            }

            payload = await _post_openai_chat_completions(request_payload)
            content = payload["choices"][0]["message"]["content"]
            candidates = json.loads(content).get("questions", [])

            accepted_this_round = 0
            pending: list[dict] = [
                item for item in candidates if isinstance(item, dict)
            ]
            validation_passes = (True, False) if attempt < 2 else (False,)

            for use_strict in validation_passes:
                if len(items) >= count or not pending:
                    break
                still_pending: list[dict] = []
                for item in pending:
                    accepted = _try_accept_ai_question_candidate(
                        item,
                        types=types,
                        slot_index=len(items),
                        seen_fingerprints=seen_fingerprints,
                        strict_type_order=use_strict,
                    )
                    if accepted is None:
                        still_pending.append(item)
                        continue
                    items.append(accepted)
                    accepted_this_round += 1
                    if len(items) >= count:
                        break
                pending = still_pending

            logger.info(
                "AI test gen: attempt %d asked for %d, got %d candidates, accepted %d, total %d/%d",
                attempt, ask_for, len(candidates), accepted_this_round, len(items), count,
            )

            if len(items) >= count:
                break

    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=502,
            detail=_ai_provider_error_detail("question", exc),
        ) from exc
    except (httpx.ConnectError, httpx.ConnectTimeout, httpx.NetworkError, httpx.TimeoutException) as exc:
        logger.warning("OpenAI unreachable (%s); using offline fallback questions", exc)
        return _dummy_questions(chapters, count, difficulty, types), "dummy"
    except (httpx.HTTPError, KeyError, TypeError, IndexError, ValueError, json.JSONDecodeError) as exc:
        logger.warning("AI question generation error (%s); using offline fallback questions", exc)
        return _dummy_questions(chapters, count, difficulty, types), "dummy"

    used_fallback_padding = False
    if len(items) < count:
        logger.warning(
            "AI test gen: exhausted %d attempts, only got %d/%d questions; padding remainder",
            max_attempts, len(items), count,
        )

    items = items[:count]

    questions: list[dict] = []
    for index, (item, question_type) in enumerate(items):
        chapter = chapters[index % len(chapters)]
        content_text = str((item.get("content") or {}).get("text", "")).strip()
        options = _normalize_multiple_choice_options(item.get("options"))
        if question_type in {"SUBJECTIVE", "CASE_STUDY", "NUMERICAL"}:
            options = {}
        if question_type in {"MCQ", "MSQ"} and set(options) != set("abcd"):
            raise HTTPException(status_code=502, detail="AI returned incomplete multiple-choice options")
        correct_answer = item.get("correct_answer") or item.get("correctAnswer") or {}
        correct_value = correct_answer.get("value")
        if question_type == "MCQ":
            correct_value = _normalize_answer_value(correct_value)
            correct_answer["value"] = correct_value
        elif question_type == "MSQ":
            correct_value = _normalize_msq_answer_value(correct_value)
            correct_answer["value"] = correct_value
        if question_type == "MCQ" and correct_value not in set("abcd"):
            raise HTTPException(status_code=502, detail="AI returned an invalid MCQ answer")
        if question_type == "MSQ":
            if not isinstance(correct_value, list) or len(set(correct_value)) < 2 or not set(correct_value) <= set("abcd"):
                raise HTTPException(status_code=502, detail="AI returned an invalid MSQ answer")
        if question_type in {"SUBJECTIVE", "CASE_STUDY", "NUMERICAL"} and not str(correct_value or "").strip():
            raise HTTPException(status_code=502, detail="AI returned an empty reference answer")
        if question_type in {"SUBJECTIVE", "CASE_STUDY"} and _is_placeholder_reference_answer(str(correct_value)):
            raise HTTPException(status_code=502, detail="AI returned a placeholder reference answer")
        if question_type in {"SUBJECTIVE", "CASE_STUDY"}:
            from app.services.subjective_grading import extract_keywords

            if not correct_answer.get("keywords"):
                correct_answer["keywords"] = extract_keywords(correct_answer)
        questions.append(
            {
                "title": str(item.get("title") or f"{chapter['subject_name']}: Question {index + 1}"),
                "type": question_type,
                "content": {"text": content_text},
                "options": options,
                "correct_answer": correct_answer,
                "marks": float(item.get("marks", 2)),
                "negative_marks": float(item.get("negative_marks", item.get("negativeMarks", 0))),
                "difficulty": difficulty,
                "chapter_id": chapter["id"],
            }
        )
    if len(questions) < count:
        used_fallback_padding = True
        questions.extend(_dummy_questions(chapters, count, difficulty, types)[len(questions) : count])
    generation_source = _generation_source_label(
        context_chunks, used_fallback=used_fallback_padding
    )
    return questions, generation_source


_openai_http_client: httpx.AsyncClient | None = None


def _openai_chat_completions_url() -> str:
    base = (settings.OPENAI_BASE_URL or "https://api.openai.com/v1").strip().rstrip("/")
    if not base.startswith("http"):
        base = "https://api.openai.com/v1"
    return f"{base}/chat/completions"


def _openai_request_headers() -> dict[str, str]:
    _refresh_openai_settings()
    return {"Authorization": f"Bearer {settings.OPENAI_API_KEY.strip()}"}


def _is_transient_openai_transport_error(exc: BaseException) -> bool:
    if isinstance(
        exc,
        (
            httpx.ConnectError,
            httpx.ConnectTimeout,
            httpx.ReadTimeout,
            httpx.WriteError,
            httpx.NetworkError,
            httpx.TimeoutException,
            httpx.PoolTimeout,
        ),
    ):
        return True
    if isinstance(exc, OSError):
        if getattr(exc, "winerror", None) in (11001, 11002, 10051, 10060, 10061):
            return True
        if exc.errno in (8, 11, 11001):
            return True
    lowered = str(exc).lower()
    return "getaddrinfo failed" in lowered or "temporary failure in name resolution" in lowered


def _should_retry_openai_http_status(status_code: int) -> bool:
    return status_code in (408, 429, 500, 502, 503, 504)


async def _get_openai_http_client() -> httpx.AsyncClient:
    global _openai_http_client
    if _openai_http_client is None or _openai_http_client.is_closed:
        _openai_http_client = httpx.AsyncClient(
            timeout=httpx.Timeout(90.0, connect=30.0),
            limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
        )
    return _openai_http_client


async def _post_openai_chat_completions(request_payload: dict, *, max_attempts: int = 7) -> dict:
    url = _openai_chat_completions_url()
    headers = _openai_request_headers()
    last_exc: BaseException | None = None

    for attempt in range(max_attempts):
        try:
            client = await _get_openai_http_client()
            response = await client.post(url, headers=headers, json=request_payload)
            if response.status_code >= 400:
                if _should_retry_openai_http_status(response.status_code) and attempt < max_attempts - 1:
                    logger.warning(
                        "OpenAI HTTP %s on attempt %d/%d; retrying",
                        response.status_code,
                        attempt + 1,
                        max_attempts,
                    )
                    await asyncio.sleep(min(8.0, 0.75 * (2**attempt)))
                    continue
                response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError:
            raise
        except Exception as exc:
            if not _is_transient_openai_transport_error(exc) or attempt >= max_attempts - 1:
                raise
            last_exc = exc
            logger.warning(
                "OpenAI transport error on attempt %d/%d: %s",
                attempt + 1,
                max_attempts,
                exc,
            )
            await asyncio.sleep(min(8.0, 0.75 * (2**attempt)))

    if last_exc is not None:
        raise last_exc
    raise RuntimeError("OpenAI chat completion request failed")


async def _openai_chat_completion(
    messages: list[dict],
    max_completion_tokens: int = 1200,
    *,
    temperature: float = 0.5,
) -> str:
    request_payload = {
        "model": settings.OPENAI_MODEL,
        "temperature": temperature,
        "max_completion_tokens": max_completion_tokens,
        "response_format": {"type": "json_object"},
        "messages": messages,
    }
    payload = await _post_openai_chat_completions(request_payload)
    return payload["choices"][0]["message"]["content"]


def _normalize_option_text(value: object) -> str:
    return " ".join(str(value or "").strip().lower().split())


def _options_unchanged(previous: dict[str, str], generated: dict[str, str]) -> bool:
    if not previous or not generated:
        return False
    previous_texts = {
        _normalize_option_text(previous.get(label))
        for label in "abcd"
        if _normalize_option_text(previous.get(label))
    }
    if not previous_texts:
        return False
    generated_texts = {
        _normalize_option_text(generated.get(label))
        for label in "abcd"
        if _normalize_option_text(generated.get(label))
    }
    return generated_texts == previous_texts


def _options_reuse_previous(previous: dict[str, str], generated: dict[str, str]) -> bool:
    if not previous or not generated:
        return False
    previous_texts = {
        _normalize_option_text(previous.get(label))
        for label in "abcd"
        if _normalize_option_text(previous.get(label))
    }
    if not previous_texts:
        return False
    for label in "abcd":
        generated_text = _normalize_option_text(generated.get(label))
        if generated_text and generated_text in previous_texts:
            return True
    return False


def _extract_choice_options_blob(parsed: dict) -> object:
    for key in ("options", "choices", "answer_options", "answerOptions"):
        if parsed.get(key) not in (None, {}, []):
            return parsed.get(key)
    question = parsed.get("question")
    if isinstance(question, dict):
        for key in ("options", "choices"):
            if question.get(key) not in (None, {}, []):
                return question.get(key)
    return parsed.get("options")


async def _generate_reference_answer_payload(
    *,
    question_text: str,
    question_type: str,
    subject_name: str | None,
    chapter_title: str | None,
    options: dict[str, str] | None,
    context_chunks: list[dict],
    regenerate: bool = False,
) -> dict:
    qtype = (question_type or "SUBJECTIVE").upper()
    topics = " · ".join(part for part in [subject_name, chapter_title] if part)
    context = "\n\n".join(
        f"[Chapter {chunk['chapter_id']}, page {chunk['page_number'] or 'unknown'}]\n{chunk['content']}"
        for chunk in context_chunks
    )
    is_choice = qtype in {"MCQ", "MSQ"}
    system_prompt = (
        "You generate exam answer keys for Indian NCERT-style CBT questions. "
        "Return only valid JSON. Never use placeholder meta-answers."
    )
    previous_options = _normalize_multiple_choice_options(options or {})
    user_prompt = {
        "question_type": qtype,
        "question_text": question_text.strip(),
        "topics": topics or None,
        "source_context": context or None,
        "output_shape": (
            {
                "options": {"a": "...", "b": "...", "c": "...", "d": "..."},
                "correct_answer": {"value": "a" if qtype == "MCQ" else ["a", "c"]},
            }
            if is_choice
            else {
                "correct_answer": {
                    "value": "Full model answer (3-6 sentences with concrete facts)",
                    "rubric": "How to award marks",
                    "keywords": ["term1", "term2"],
                }
            }
        ),
        "rules": [
            "Ground answers in source_context when provided; otherwise use syllabus knowledge for the topics.",
            "For SUBJECTIVE/CASE_STUDY, value must be a complete model answer, not a description of grading criteria only.",
            "For MCQ/MSQ, all four options must be distinct and chapter-specific.",
        ],
    }
    if is_choice and regenerate:
        user_prompt["regenerate"] = True
        user_prompt["forbidden_option_texts"] = [
            _normalize_option_text(previous_options.get(label))
            for label in "abcd"
            if _normalize_option_text(previous_options.get(label))
        ]
        user_prompt["variation_hint"] = random.randint(1, 1_000_000)
        user_prompt["rules"].append(
            "Regenerate mode: invent four brand-new option texts from the question and syllabus only. "
            "Do not reuse any forbidden_option_texts verbatim or with minor edits."
        )
    elif is_choice and previous_options and not regenerate:
        user_prompt["existing_options"] = previous_options

    max_regen_attempts = 5 if is_choice and regenerate else 1
    parsed: dict = {}
    normalized_options: dict[str, str] = {}
    for regen_attempt in range(max_regen_attempts):
        temperature = min(1.0, 0.75 + (regen_attempt * 0.05)) if regenerate else 0.5
        attempt_prompt = dict(user_prompt)
        if is_choice and regenerate:
            attempt_prompt["variation_hint"] = random.randint(1, 1_000_000)
            attempt_prompt["attempt"] = regen_attempt + 1
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": json.dumps(attempt_prompt)},
        ]
        content = await _openai_chat_completion(
            messages,
            max_completion_tokens=1600,
            temperature=temperature,
        )
        parsed = json.loads(content)
        if not is_choice:
            break
        normalized_options = _normalize_multiple_choice_options(_extract_choice_options_blob(parsed))
        if set(normalized_options) != set("abcd"):
            continue
        if not regenerate:
            break
        if not _options_unchanged(previous_options, normalized_options) and not _options_reuse_previous(
            previous_options, normalized_options
        ):
            break

    if is_choice:
        if set(normalized_options) != set("abcd"):
            raise HTTPException(status_code=502, detail="AI returned incomplete multiple-choice options")
        if regenerate and previous_options and (
            _options_unchanged(previous_options, normalized_options)
            or _options_reuse_previous(previous_options, normalized_options)
        ):
            raise HTTPException(
                status_code=502,
                detail=(
                    "AI returned the same or overlapping options. "
                    "Edit the question text slightly or try again."
                ),
            )
        correct_answer = parsed.get("correct_answer") or parsed.get("correctAnswer") or {}
        value = correct_answer.get("value")
        if qtype == "MCQ":
            value = _normalize_answer_value(value)
            if value not in set("abcd"):
                raise HTTPException(status_code=502, detail="AI returned an invalid MCQ answer key")
        else:
            value = _normalize_msq_answer_value(value)
            if not isinstance(value, list) or len(set(value)) < 2 or not set(value) <= set("abcd"):
                raise HTTPException(status_code=502, detail="AI returned an invalid MSQ answer key")
        return {"options": normalized_options, "correctAnswer": {"value": value}}

    correct_answer = parsed.get("correct_answer") or parsed.get("correctAnswer") or {}
    reference = str(correct_answer.get("value") or "").strip()
    rubric = str(correct_answer.get("rubric") or "").strip()
    if not reference or _is_placeholder_reference_answer(reference):
        raise HTTPException(status_code=502, detail="AI returned an empty or placeholder reference answer")
    if not rubric:
        rubric = "Award marks for accuracy, relevant reasoning, and clarity."
    from app.services.subjective_grading import extract_keywords

    keywords = correct_answer.get("keywords")
    if not keywords:
        keywords = extract_keywords({"value": reference, "rubric": rubric})
    return {
        "referenceAnswer": reference,
        "rubric": rubric,
        "keywords": keywords,
        "correctAnswer": {"value": reference, "rubric": rubric, "keywords": keywords},
    }


def _dummy_questions(
    chapters: list[dict], count: int, difficulty: str, types: list[str]
) -> list[dict]:
    questions: list[dict] = []
    for index in range(count):
        chapter = chapters[index % len(chapters)]
        question_type = types[index % len(types)]
        title = chapter["title"]
        subject = chapter["subject_name"]
        if question_type in {"SUBJECTIVE", "CASE_STUDY"}:
            question_text = (
                f'Explain an important concept from "{title}" in {subject} '
                "and describe its significance."
            )
            options = {}
            correct_answer = {
                "value": f"A correct answer accurately explains a relevant concept from {title}.",
                "rubric": "Award marks for accuracy, relevant reasoning, and clarity.",
            }
        elif question_type == "MSQ":
            question_text = f"Which statements correctly relate to {title}? Select all that apply."
            options = {
                "a": f"A key concept from {title}",
                "b": "An unrelated statement",
                "c": f"A relevant application of {title}",
                "d": "A different subject's topic",
            }
            correct_answer = {"value": ["a", "c"]}
        elif question_type == "NUMERICAL":
            question_text = f"Calculate a value using the key numerical concept from {title}."
            options = {}
            correct_answer = {"value": "0"}
        else:
            question_text = f'Which statement best relates to "{title}" in {subject}?'
            options = {
                "a": f"A key concept from {title}",
                "b": "An unrelated statement",
                "c": "The opposite of the chapter theme",
                "d": "A detail from a different subject",
            }
            correct_answer = {"value": "a"}
        questions.append(
            {
                "title": f"{subject}: {title} - Q{index + 1}",
                "type": question_type,
                "content": {"text": question_text},
                "options": options,
                "correct_answer": correct_answer,
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
              (:id, :tenant_id, :type, :difficulty, :title, 'DRAFT', :user_id, :version_id, :now, :now)
            """
        ),
        {
            "id": question_id,
            "tenant_id": tenant_id,
            "type": q["type"],
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
    start, end = get_draft_exam_window(duration_minutes, now)
    exam_settings = {
        "durationMinutes": duration_minutes,
        "passingScore": 40,
        "negativeMarking": False,
        **settings_extra,
    }
    security_policy = {
        "proctoringEnabled": True,
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
              (:id, :tenant_id, :title, :code, 'AI_ASSESSMENT', 'DRAFT', :start, :end, :timezone,
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
            "timezone": DEFAULT_EXAM_TIMEZONE,
            "settings": json.dumps(exam_settings),
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
    _refresh_openai_settings()
    tenant_id = current_user.tenant_id
    user_id = current_user.id
    now = datetime.now(timezone.utc)
    title = await _unique_title(db, tenant_id, body.title)
    question_types = _normalize_question_types(body.question_types)
    existing_fingerprints = await _load_recent_question_fingerprints(db, tenant_id)

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
            {
                "aiGenerated": True,
                "combinedSubjects": True,
                "batchId": body.batch_id,
                "shuffleQuestions": body.shuffle_questions,
            },
            [s["name"] for s in subject_rows],
            now,
        )

        total_questions = 0
        context_used = 0
        order_index = 0
        generation_sources: list[str] = []
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
            context_chunks = (
                await _load_rag_context(db, tenant_id, chapter_ids, body.topic_ids)
                if settings.OPENAI_API_KEY.strip()
                else []
            )
            context_used += len(context_chunks)
            generated, gen_source = await _generate_questions(
                chapters,
                per_subject,
                body.difficulty,
                question_types,
                context_chunks,
                existing_fingerprints,
            )
            generation_sources.append(gen_source)
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
                "question_types": json.dumps(question_types),
                "syllabus_scope": body.syllabus_scope,
                "exam_id": exam_id,
                "user_id": user_id,
                "now": now,
            },
        )
        if body.assign_to_batch:
            await _assign_batch_candidates(db, exam_id, body.batch_id, now)

        if "dummy" in generation_sources:
            overall_source = "dummy"
        elif context_used:
            overall_source = "rag"
        else:
            overall_source = "openai"

        return {
            "exam": {"id": exam_id, "title": title, "status": "DRAFT", "code": code},
            "questionCount": total_questions,
            "source": overall_source,
            "contextUsed": context_used,
            "message": _generation_success_message(overall_source),
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
    context_chunks = (
        await _load_rag_context(db, tenant_id, chapter_ids, body.topic_ids)
        if settings.OPENAI_API_KEY.strip()
        else []
    )
    expected_count = body.question_count or 10
    generated, generation_source = await _generate_questions(
        chapters,
        expected_count,
        body.difficulty,
        question_types,
        context_chunks,
        existing_fingerprints,
    )
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
        {
            "aiGenerated": True,
            "subjectId": body.subject_id,
            "chapterIds": chapter_ids,
            "shuffleQuestions": body.shuffle_questions,
        },
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
            "question_types": json.dumps(question_types),
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
        "source": generation_source,
        "contextUsed": len(context_chunks),
        "message": _generation_success_message(generation_source),
    }


@router.get("/status")
async def ai_status():
    _refresh_openai_settings()
    return {
        "openaiConfigured": bool(settings.OPENAI_API_KEY.strip()),
        "model": settings.OPENAI_MODEL,
    }


@router.post("/reference-answer/generate")
async def generate_reference_answer(
    body: GenerateReferenceAnswerBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _refresh_openai_settings()
    question_text = body.question_text.strip()
    if len(question_text) < 10:
        raise HTTPException(status_code=400, detail="Question text is too short")

    if not settings.OPENAI_API_KEY.strip():
        raise HTTPException(
            status_code=400,
            detail="Set OPENAI_API_KEY to generate reference answers with AI.",
        )

    context_chunks: list[dict] = []
    if body.chapter_id:
        context_chunks = await _load_rag_context(
            db,
            current_user.tenant_id,
            [body.chapter_id],
            None,
        )

    try:
        return await _generate_reference_answer_payload(
            question_text=question_text,
            question_type=body.question_type,
            subject_name=body.subject_name,
            chapter_title=body.chapter_title,
            options=body.options,
            context_chunks=context_chunks,
            regenerate=body.regenerate,
        )
    except httpx.HTTPStatusError as exc:
        raise HTTPException(
            status_code=502,
            detail=_ai_provider_error_detail("answer", exc),
        ) from exc
    except (httpx.HTTPError, OSError) as exc:
        if _is_transient_openai_transport_error(exc):
            raise HTTPException(
                status_code=502,
                detail=(
                    "Could not reach the AI provider (network/DNS). "
                    "Check your internet connection and try again in a few seconds."
                ),
            ) from exc
        raise HTTPException(status_code=502, detail=f"AI answer generation failed: {exc}") from exc
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=502, detail=f"AI answer generation failed: {exc}") from exc