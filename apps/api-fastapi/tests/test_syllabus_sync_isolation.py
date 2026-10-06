"""Full-book syllabus sync must stay scoped per material (no NCERT catalog substitution)."""

from unittest.mock import AsyncMock, patch

import pytest

from app.services.ncert_syllabus_catalog import get_ncert_fallback_chapters
from app.services.syllabus_extraction import parse_toc_from_lines
from app.services.syllabus_sync import extract_chapters_for_full_book_upload

NCERT_ENG_CLASS_9 = [c.title for c in get_ncert_fallback_chapters(9, "ENG")]

GRAMMAR_TOC = """
TABLE OF CONTENTS

1. How I Taught My Grandmother to Read
   Bharat Our Land

2. The Pot Maker
   Gifts of Grace: Honouring Our Vocations

3. Winds of Change
   Canvas of Soil
"""


@pytest.mark.asyncio
async def test_extract_chapters_for_full_book_uses_pdf_not_catalog():
    body = GRAMMAR_TOC + "\n\n" + ("Lesson text. " * 100)
    with patch(
        "app.services.syllabus_sync._extract_chapters_from_text_async",
        new_callable=AsyncMock,
    ) as mock_extract:
        mock_extract.side_effect = [
            parse_toc_from_lines(GRAMMAR_TOC.split("\n")),
        ]
        chapters = await extract_chapters_for_full_book_upload(
            text=body,
            syllabus_source_text=GRAMMAR_TOC,
            fallback_title="English Grammar",
            class_level=9,
            subject_code="ENG",
            subject_name="English",
            material_id="mat-grammar",
            file_name="english_grammar.pdf",
        )
    assert len(chapters) >= 2
    titles = [c.title for c in chapters]
    assert "The Fun They Had" not in titles
    assert titles != NCERT_ENG_CLASS_9[: len(titles)]


@pytest.mark.asyncio
async def test_failed_extraction_returns_empty_not_catalog():
    with patch(
        "app.services.syllabus_sync._extract_chapters_from_text_async",
        new_callable=AsyncMock,
        return_value=[],
    ):
        chapters = await extract_chapters_for_full_book_upload(
            text="unreadable ???",
            syllabus_source_text="???",
            fallback_title="Book",
            class_level=9,
            subject_code="ENG",
            subject_name="English",
            material_id="mat-empty",
            file_name="bad.pdf",
        )
    assert chapters == []


def test_two_materials_same_subject_get_different_toc_titles():
    toc_a = parse_toc_from_lines(GRAMMAR_TOC.split("\n"))
    toc_b_text = GRAMMAR_TOC.replace("Grandmother", "Uncle").replace("Pot Maker", "River Song")
    toc_b = parse_toc_from_lines(toc_b_text.split("\n"))
    assert [c.title for c in toc_a] != [c.title for c in toc_b]
    assert "The Fun They Had" not in [c.title for c in toc_a]
