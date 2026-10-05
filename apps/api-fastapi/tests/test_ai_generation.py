import json

import httpx
import pytest
from fastapi import HTTPException

from app.core.config import settings
from app.routers.ai import (
    _generate_questions,
    _is_placeholder_reference_answer,
    _normalize_msq_answer_value,
    _resolve_chapter_ids,
    _try_accept_ai_question_candidate,
)


class _Rows:
    def __init__(self, values):
        self._values = values

    def all(self):
        return self._values


class _Result:
    def __init__(self, values):
        self._values = values

    def all(self):
        return _Rows(self._values).all()


class _Db:
    async def execute(self, statement, params):
        return _Result([("chapter-1",)])


@pytest.mark.parametrize(
    "value",
    [["a", "c"], '["a", "c"]', "['a', 'c']", "a,c", "a and c", "1,3", "ac", "A|C"],
)
def test_normalize_msq_answer_value_accepts_common_provider_formats(value):
    assert _normalize_msq_answer_value(value) == ["a", "c"]


def test_try_accept_accepts_msq_with_array_correct_answer():
    item = {
        "type": "MSQ",
        "content": {"text": "Which statements about evaporation are correct? Select all that apply."},
        "options": {"a": "A", "b": "B", "c": "C", "d": "D"},
        "correct_answer": {"value": ["a", "c"]},
    }
    accepted = _try_accept_ai_question_candidate(
        item,
        types=["MSQ"],
        slot_index=0,
        seen_fingerprints=set(),
        strict_type_order=True,
    )
    assert accepted is not None
    assert accepted[1] == "MSQ"


@pytest.mark.anyio
async def test_generate_questions_requires_openai_key(monkeypatch):
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "")

    with pytest.raises(HTTPException) as exc:
        await _generate_questions(
            chapters=[
                {
                    "id": "chapter-1",
                    "title": "Matter",
                    "subject_name": "Science",
                }
            ],
            count=2,
            difficulty="MEDIUM",
            question_types=["MCQ"],
            context_chunks=[],
        )

    assert exc.value.status_code == 503


@pytest.mark.anyio
@pytest.mark.parametrize(
    "question_types",
    [
        ["MCQ"],
        ["MSQ"],
        ["SUBJECTIVE"],
        ["CASE_STUDY"],
        ["MCQ", "MSQ"],
        ["MCQ", "SUBJECTIVE"],
        ["MSQ", "CASE_STUDY"],
        ["MCQ", "MSQ", "SUBJECTIVE"],
        ["MCQ", "MSQ", "SUBJECTIVE", "CASE_STUDY"],
    ],
)
async def test_generate_questions_supports_every_question_type_combination(monkeypatch, question_types):
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "")

    with pytest.raises(HTTPException) as exc:
        await _generate_questions(
            chapters=[{"id": "chapter-1", "title": "Matter", "subject_name": "Science"}],
            count=len(question_types) * 2,
            difficulty="MEDIUM",
            question_types=question_types,
            context_chunks=[],
        )

    assert exc.value.status_code == 503


@pytest.mark.anyio
async def test_configured_ai_without_indexed_context_uses_openai(monkeypatch):
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "configured-for-test")

    open_ended_answer = (
        "Evaporation is the change of water from liquid to vapor. It drives the water cycle "
        "by moving moisture into the atmosphere where it condenses and returns as precipitation."
    )

    async def fake_openai_chat(_payload):
        return {
            "choices": [
                {
                    "message": {
                        "content": json.dumps(
                            {
                                "questions": [
                                    {
                                        "title": "Science: Matter",
                                        "type": "SUBJECTIVE",
                                        "content": {
                                            "text": "Explain evaporation and describe its importance in the water cycle."
                                        },
                                        "options": {},
                                        "correct_answer": {
                                            "value": open_ended_answer,
                                            "rubric": "Award marks for definition and water-cycle link.",
                                        },
                                        "marks": 2,
                                        "negative_marks": 0,
                                    }
                                ]
                            }
                        )
                    }
                }
            ]
        }

    monkeypatch.setattr(
        "app.routers.ai._post_openai_chat_completions",
        fake_openai_chat,
    )

    questions, source = await _generate_questions(
        chapters=[{"id": "chapter-1", "title": "Matter", "subject_name": "Science"}],
        count=1,
        difficulty="MEDIUM",
        question_types=["SUBJECTIVE"],
        context_chunks=[],
    )

    assert source == "openai"
    assert len(questions) == 1
    assert not _is_placeholder_reference_answer(questions[0]["correct_answer"]["value"])


@pytest.mark.anyio
async def test_resolve_requested_chapter_without_indexing(monkeypatch):
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "")

    async def no_uploaded_chapters(*args, **kwargs):
        return set()

    monkeypatch.setattr("app.routers.ai._uploaded_chapter_ids", no_uploaded_chapters)

    chapter_ids = await _resolve_chapter_ids(
        _Db(),
        tenant_id="tenant-1",
        batch_id=None,
        subject_id="subject-1",
        class_level=10,
        chapter_ids_req=["chapter-1"],
        syllabus_scope="COMPLETED_ONLY",
    )

    assert chapter_ids == ["chapter-1"]


class _ProgressDb:
    def __init__(self, completed: list[str]):
        self.completed = completed

    async def execute(self, statement, params):
        sql = str(statement)
        if "syllabus_progress" in sql:
            return _Result([(chapter_id,) for chapter_id in self.completed])
        return _Result([])


@pytest.mark.anyio
async def test_resolve_chapter_ids_keeps_only_done_chapters(monkeypatch):
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "test-key")

    async def uploaded(*_args, **_kwargs):
        return {"ch-done", "ch-studying"}

    monkeypatch.setattr("app.routers.ai._uploaded_chapter_ids", uploaded)

    chapter_ids = await _resolve_chapter_ids(
        _ProgressDb(["ch-done"]),
        tenant_id="tenant-1",
        batch_id="batch-1",
        subject_id="subject-1",
        class_level=10,
        chapter_ids_req=["ch-done", "ch-studying"],
        syllabus_scope="SELECTED",
    )

    assert chapter_ids == ["ch-done"]


@pytest.mark.anyio
async def test_resolve_chapter_ids_does_not_fall_back_to_every_upload(monkeypatch):
    monkeypatch.setattr(settings, "OPENAI_API_KEY", "test-key")

    async def uploaded(*_args, **_kwargs):
        return {"ch-1", "ch-2"}

    monkeypatch.setattr("app.routers.ai._uploaded_chapter_ids", uploaded)

    with pytest.raises(HTTPException) as exc:
        await _resolve_chapter_ids(
            _ProgressDb([]),
            tenant_id="tenant-1",
            batch_id="batch-1",
            subject_id="subject-1",
            class_level=10,
            chapter_ids_req=None,
            syllabus_scope="COMPLETED_ONLY",
        )

    assert exc.value.status_code == 400
    assert "Done" in str(exc.value.detail)
