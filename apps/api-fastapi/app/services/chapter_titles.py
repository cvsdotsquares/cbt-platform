"""Normalize chapter titles and fall back to NCERT catalog when PDF text is garbage."""

from __future__ import annotations

import re

from app.services.ncert_syllabus_catalog import catalog_chapter_title
from app.services.syllabus_extraction import display_chapter_title

_MCQ_ANSWER_FRAGMENTS = re.compile(r"\d+\.\s*\([a-zivx]+\)", re.I)


def is_garbage_chapter_title(title: str | None) -> bool:
    t = (title or "").strip()
    if len(t) < 3:
        return True
    if _MCQ_ANSWER_FRAGMENTS.search(t) and len(_MCQ_ANSWER_FRAGMENTS.findall(t)) >= 2:
        return True
    if re.match(r"^(?:\d+\.\s*\([a-zivx]+\)\s*)+$", t, re.I):
        return True
    return False


def resolve_chapter_title(
    title: str | None,
    *,
    chapter_number: int,
    class_level: int | None,
    subject_code: str | None,
    allow_catalog_fallback: bool = True,
) -> str:
    cleaned = display_chapter_title(title)
    if cleaned and not is_garbage_chapter_title(cleaned):
        return cleaned
    if allow_catalog_fallback and class_level is not None and subject_code:
        catalog = catalog_chapter_title(class_level, subject_code, chapter_number)
        if catalog:
            return catalog
    if cleaned:
        return cleaned
    return f"Chapter {chapter_number}"
