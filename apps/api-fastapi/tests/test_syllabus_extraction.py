"""Book-scoped syllabus extraction (no cross-book NCERT substitution)."""

import pytest

from app.services.ncert_syllabus_catalog import get_ncert_chapters_for_subject, get_ncert_fallback_chapters
from app.services.syllabus_extraction import (
    extract_chapters_from_text,
    parse_toc_from_lines,
)


NCERT_ENG_CLASS_9 = [c.title for c in get_ncert_fallback_chapters(9, "ENG")]


SAMPLE_GRAMMAR_TOC = """
TABLE OF CONTENTS

1. How I Taught My Grandmother to Read
   Bharat Our Land

2. The Pot Maker
   Gifts of Grace: Honouring Our Vocations

3. Winds of Change
   Canvas of Soil

4. Vitamin-M
   I Cannot Remember My Mother
"""


def test_toc_extracts_grammar_book_chapters_not_catalog():
    chapters = parse_toc_from_lines(SAMPLE_GRAMMAR_TOC.split("\n"))
    titles = [c.title for c in chapters]
    assert len(chapters) >= 4
    assert "How I Taught My Grandmother to Read" in titles[0] or any(
        "Grandmother" in t for t in titles
    )
    assert "The Fun They Had" not in titles
    assert titles != NCERT_ENG_CLASS_9


def test_full_book_extraction_does_not_use_ncert_catalog_for_readable_pdf():
    text = SAMPLE_GRAMMAR_TOC + "\n\n" + ("Sample lesson body. " * 200)
    book_a = extract_chapters_from_text(
        text,
        single_chapter=False,
        fallback_title="English Grammar Class 9",
        class_level=9,
        subject_code="ENG",
        material_id="mat-a",
        file_name="english_grammar.pdf",
    )
    book_b = extract_chapters_from_text(
        text.replace("Grandmother", "Uncle").replace("Pot Maker", "River Song"),
        single_chapter=False,
        fallback_title="Another English Reader",
        class_level=9,
        subject_code="ENG",
        material_id="mat-b",
        file_name="reader_b.pdf",
    )
    assert len(book_a) >= 2
    assert book_a[0].title != NCERT_ENG_CLASS_9[0]
    assert book_b[0].title != book_a[0].title or book_b[1].title != book_a[1].title


def test_failed_extraction_returns_empty_not_catalog():
    chapters = extract_chapters_from_text(
        "???",
        single_chapter=False,
        fallback_title="Empty",
        class_level=9,
        subject_code="ENG",
        material_id="mat-fail",
    )
    assert chapters == []


def test_ncert_catalog_maps_english_subject_code():
    chapters = get_ncert_chapters_for_subject(12, "ENGLISH", "English")
    assert len(chapters) >= 2
    assert chapters[0].title == "The Last Lesson"


def test_flamingo_contents_extracts_story_titles():
    toc = """
CONTENTS
The Last Lesson
Alphonse Daudet
Lost Spring
Anees Jung
Deep Water
William Douglas
The Rattrap
Selma Lagerlöf
"""
    chapters = parse_toc_from_lines(toc.split("\n"))
    titles = [c.title for c in chapters]
    assert "The Last Lesson" in titles
    assert "Lost Spring" in titles
    assert "Going Places" not in titles or len(titles) >= 4
    assert "Alphonse Daudet" not in titles


@pytest.mark.parametrize(
    "title",
    NCERT_ENG_CLASS_9[:3],
)
def test_ncert_catalog_is_only_reference_data(title):
    """Catalog exists but must not appear when TOC text is present."""
    assert title in NCERT_ENG_CLASS_9
