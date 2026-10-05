"""Link chapter-wise uploads to syllabus chapters (FastAPI indexing path)."""

from __future__ import annotations

import asyncio
import logging
import os
import re
import uuid
from datetime import datetime, timezone

from sqlalchemy import delete, func, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.curriculum import AcademicClass, Book, Chapter, Subject, SyllabusProgress, SyllabusTopic
from app.models.material import StudyMaterial
from app.services.chapter_titles import resolve_chapter_title
from app.services.ncert_syllabus_catalog import ExtractedChapter, ExtractedTopic
from app.services.material_storage import extract_material_text_for_indexing
from app.services.syllabus_extraction import display_chapter_title, extract_chapters_from_text

logger = logging.getLogger(__name__)

# Chapter/TOC lives in front matter — never run extraction on the full indexed text blob.
_SYLLABUS_SOURCE_MAX_CHARS = 250_000
SYLLABUS_EXTRACT_TIMEOUT_SEC = float(os.getenv("SYLLABUS_EXTRACT_TIMEOUT_SEC", "45"))
SYLLABUS_TOC_EXTRACT_TIMEOUT_SEC = float(os.getenv("SYLLABUS_TOC_EXTRACT_TIMEOUT_SEC", "8"))


def _infer_class_level_from_labels(*labels: str | None) -> int | None:
    for raw in labels:
        if not raw:
            continue
        match = re.search(r"\bclass\s*(\d{1,2})\b", raw, re.I)
        if match:
            level = int(match.group(1))
            if 1 <= level <= 12:
                return level
    return None


async def _resolve_class_level(
    db: AsyncSession,
    material: StudyMaterial,
    subject: Subject,
) -> int | None:
    if subject.academic_class:
        return subject.academic_class.level
    if material.academic_class_id:
        cls_row = await db.get(AcademicClass, material.academic_class_id)
        if cls_row:
            return cls_row.level
    return _infer_class_level_from_labels(material.file_name, material.title, subject.name)


async def extract_chapters_for_full_book_upload(
    *,
    text: str,
    syllabus_source_text: str | None,
    fallback_title: str,
    class_level: int | None,
    subject_code: str | None,
    subject_name: str | None,
    material_id: str,
    file_name: str | None,
) -> list[ExtractedChapter]:
    """TOC-first extraction from this upload only (no NCERT catalog substitution)."""
    chapter_text = (syllabus_source_text if syllabus_source_text is not None else text) or ""
    extracted: list[ExtractedChapter] = []

    if len(chapter_text.strip()) >= 40:
        extracted = await _extract_chapters_from_text_async(
            chapter_text,
            single_chapter=False,
            fallback_title=fallback_title,
            class_level=class_level,
            subject_code=subject_code,
            subject_name=subject_name,
            material_id=material_id,
            file_name=file_name,
            timeout_sec=SYLLABUS_TOC_EXTRACT_TIMEOUT_SEC,
        )
        if len(extracted) >= 2:
            logger.info(
                "[BOOK-EXTRACTION] TOC/index path materialId=%s chapters=%s",
                material_id,
                len(extracted),
            )

    if len(extracted) < 2 and len(text.strip()) >= 40:
        extracted = await _extract_chapters_from_text_async(
            text[:_SYLLABUS_SOURCE_MAX_CHARS],
            single_chapter=False,
            fallback_title=fallback_title,
            class_level=class_level,
            subject_code=subject_code,
            subject_name=subject_name,
            material_id=material_id,
            file_name=file_name,
        )
        if len(extracted) >= 2:
            logger.info(
                "[BOOK-EXTRACTION] body/heuristic path materialId=%s chapters=%s",
                material_id,
                len(extracted),
            )

    if len(extracted) < 2 and len(text.strip()) >= 40:
        single = await _extract_chapters_from_text_async(
            text[:_SYLLABUS_SOURCE_MAX_CHARS],
            single_chapter=True,
            fallback_title=fallback_title,
            class_level=class_level,
            subject_code=subject_code,
            subject_name=subject_name,
            material_id=material_id,
            file_name=file_name,
        )
        if single:
            extracted = single
            logger.info(
                "[BOOK-EXTRACTION] single-chapter fallback materialId=%s title=%s",
                material_id,
                single[0].title if single else "",
            )

    if len(extracted) < 2:
        logger.warning(
            "[FALLBACK] materialId=%s reason=%s",
            material_id,
            "PDF extraction returned fewer than 2 chapters; NCERT catalog not applied for uploads",
        )

    return extracted


async def _extract_chapters_from_text_async(
    text: str,
    *,
    single_chapter: bool,
    fallback_title: str,
    class_level: int | None,
    subject_code: str | None,
    subject_name: str | None = None,
    material_id: str | None = None,
    file_name: str | None = None,
    timeout_sec: float | None = None,
) -> list[ExtractedChapter]:
    """CPU-heavy TOC/heuristic parsing — must not block the asyncio event loop."""
    source = text if len(text) <= _SYLLABUS_SOURCE_MAX_CHARS else text[:_SYLLABUS_SOURCE_MAX_CHARS]
    limit = timeout_sec if timeout_sec is not None else SYLLABUS_EXTRACT_TIMEOUT_SEC
    try:
        chapters = await asyncio.wait_for(
            asyncio.to_thread(
                extract_chapters_from_text,
                source,
                single_chapter=single_chapter,
                fallback_title=fallback_title,
                class_level=class_level,
                subject_code=subject_code,
                material_id=material_id,
                file_name=file_name,
            ),
            timeout=limit,
        )
    except asyncio.TimeoutError:
        logger.warning(
            "Chapter extraction timed out after %ss materialId=%s",
            int(limit),
            material_id,
        )
        chapters = []
    return chapters


def parse_chapter_number_from_upload(file_name: str, title: str) -> int | None:
    for raw in (file_name, title):
        base = re.sub(r"\.[^.]+$", "", raw or "").strip()
        if not base:
            continue
        match = re.search(r"(?:chapter|ch)[-_\s]?(\d{1,2})\b", base, re.I)
        if match:
            return int(match.group(1))
        match = re.search(r"\b(\d{1,2})\s*[.)]\s+\S", base)
        if match:
            return int(match.group(1))
    return None


def _chapter_title_from_material(material: StudyMaterial) -> str:
    title = (material.title or "").strip()
    if title:
        return title[:120]
    return re.sub(r"\.[^.]+$", "", material.file_name or "Chapter")[:120] or "Chapter"


async def create_book_for_upload(
    db: AsyncSession,
    subject: Subject,
    title: str,
) -> str:
    """One syllabus book row per uploaded full textbook."""
    book_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    order_index = len(subject.books)
    clean_title = (title or f"{subject.name} — upload").strip()[:200]
    db.add(
        Book(
            id=book_id,
            subject_id=subject.id,
            title=clean_title,
            publisher="NCERT",
            is_ncert=True,
            order_index=order_index,
            created_at=now,
        )
    )
    await db.flush()
    return book_id


async def ensure_dedicated_full_book(db: AsyncSession, material: StudyMaterial, subject: Subject) -> str:
    """If several full-book PDFs share one book_id, give this material its own book before re-index."""
    if not material.is_full_book:
        return material.book_id or await _ensure_subject_book(db, subject)

    if material.book_id:
        others = await db.execute(
            select(func.count())
            .select_from(StudyMaterial)
            .where(
                StudyMaterial.book_id == material.book_id,
                StudyMaterial.is_full_book.is_(True),
                StudyMaterial.id != material.id,
            )
        )
        if int(others.scalar() or 0) == 0:
            return material.book_id

    book_id = await create_book_for_upload(db, subject, material.title or material.file_name)
    material.book_id = book_id
    material.chapter_id = None
    material.topic_id = None
    await db.flush()
    return book_id


def _normalize_text(text: str) -> str:
    return re.sub(r"\n{3,}", "\n\n", (text or "").replace("\r\n", "\n")).strip()


def _extract_topics_heuristic(text: str, chapter_title: str) -> list[ExtractedTopic]:
    topics: list[ExtractedTopic] = []
    for line in text.split("\n"):
        stripped = line.strip()
        if not stripped or len(stripped) > 100:
            continue
        if stripped.isupper() and len(stripped.split()) <= 8:
            topics.append(
                ExtractedTopic(title=stripped.title(), content="", order_index=len(topics)),
            )
        if len(topics) >= 12:
            break
    if not topics and chapter_title:
        topics.append(ExtractedTopic(title=chapter_title, content=text[:500], order_index=0))
    return topics


async def _clear_chapter_topics(db: AsyncSession, chapter_id: str) -> None:
    topic_rows = await db.execute(
        select(SyllabusTopic.id).where(SyllabusTopic.chapter_id == chapter_id)
    )
    topic_ids = [str(row[0]) for row in topic_rows.all()]
    if not topic_ids:
        return
    await db.execute(
        text("UPDATE document_chunks SET topic_id = NULL WHERE topic_id::text = ANY(:ids)"),
        {"ids": topic_ids},
    )
    await db.execute(
        update(StudyMaterial)
        .where(StudyMaterial.topic_id.in_(topic_ids))
        .values(topic_id=None)
    )
    await db.execute(delete(SyllabusTopic).where(SyllabusTopic.chapter_id == chapter_id))


async def sync_topics_for_chapter(
    db: AsyncSession,
    chapter_id: str,
    topics: list[ExtractedTopic],
    chapter_content: str,
    chapter_title: str,
) -> None:
    await _clear_chapter_topics(db, chapter_id)
    now = datetime.now(timezone.utc)
    resolved = topics
    if not resolved and chapter_content.strip():
        resolved = [ExtractedTopic(title=chapter_title, content=chapter_content[:500], order_index=0)]
    for i, topic in enumerate(resolved[:15]):
        db.add(
            SyllabusTopic(
                id=str(uuid.uuid4()),
                chapter_id=chapter_id,
                title=topic.title[:200],
                description=topic.content[:500] if topic.content else None,
                order_index=topic.order_index if topic.order_index is not None else i,
                created_at=now,
            )
        )
    await db.flush()


async def _clear_unlinked_book_chapters(db: AsyncSession, book_id: str) -> None:
    orphan_rows = await db.execute(select(Chapter).where(Chapter.book_id == book_id))
    for orphan in orphan_rows.scalars().all():
        linked = await db.execute(
            select(func.count())
            .select_from(StudyMaterial)
            .where(StudyMaterial.chapter_id == orphan.id)
        )
        if int(linked.scalar() or 0) > 0:
            continue
        chunk_linked = await db.execute(
            text("SELECT COUNT(*) FROM document_chunks WHERE chapter_id::text = :chapter_id"),
            {"chapter_id": str(orphan.id)},
        )
        if int(chunk_linked.scalar() or 0) > 0:
            continue
        await _clear_chapter_topics(db, orphan.id)
        await db.delete(orphan)
    await db.flush()


async def _remap_syllabus_progress_to_book_chapters(
    db: AsyncSession,
    book_id: str,
    subject_id: str,
) -> None:
    """Point batch progress at canonical full-book chapters (same subject + chapter number)."""
    canonical_rows = await db.execute(
        select(Chapter.id, Chapter.number).where(Chapter.book_id == book_id)
    )
    canonical = {int(num): str(cid) for cid, num in canonical_rows.all()}

    for number, new_id in canonical.items():
        old_rows = await db.execute(
            select(Chapter.id)
            .join(Book, Chapter.book_id == Book.id)
            .where(
                Book.subject_id == subject_id,
                Chapter.number == number,
                Chapter.id != new_id,
            )
        )
        for (old_id,) in old_rows.all():
            stale = await db.execute(
                select(SyllabusProgress).where(
                    SyllabusProgress.chapter_id == old_id,
                    SyllabusProgress.topic_id.is_(None),
                )
            )
            for progress in stale.scalars().all():
                conflict = await db.execute(
                    select(SyllabusProgress.id).where(
                        SyllabusProgress.batch_id == progress.batch_id,
                        SyllabusProgress.chapter_id == new_id,
                        SyllabusProgress.topic_id.is_(None),
                    )
                )
                if conflict.scalar_one_or_none():
                    await db.delete(progress)
                else:
                    progress.chapter_id = new_id
    await db.flush()


async def sync_extracted_syllabus(
    db: AsyncSession,
    book_id: str,
    chapters: list[ExtractedChapter],
    *,
    replace_orphans: bool = False,
    class_level: int | None = None,
    subject_code: str | None = None,
    subject_id: str | None = None,
    allow_catalog_title_fallback: bool = True,
) -> list[str]:
    if not chapters:
        if replace_orphans:
            await _clear_unlinked_book_chapters(db, book_id)
        return []

    numbers = [c.number for c in chapters]
    if replace_orphans and numbers:
        orphan_rows = await db.execute(
            select(Chapter).where(Chapter.book_id == book_id, Chapter.number.not_in(numbers))
        )
        for orphan in orphan_rows.scalars().all():
            linked = await db.execute(
                select(func.count())
                .select_from(StudyMaterial)
                .where(StudyMaterial.chapter_id == orphan.id)
            )
            if int(linked.scalar() or 0) > 0:
                continue
            chunk_linked = await db.execute(
                text(
                    "SELECT COUNT(*) FROM document_chunks WHERE chapter_id::text = :chapter_id"
                ),
                {"chapter_id": str(orphan.id)},
            )
            if int(chunk_linked.scalar() or 0) > 0:
                continue
            await _clear_chapter_topics(db, orphan.id)
            await db.delete(orphan)

    now = datetime.now(timezone.utc)
    for ch in chapters:
        existing = await db.execute(
            select(Chapter).where(Chapter.book_id == book_id, Chapter.number == ch.number)
        )
        chapter = existing.scalar_one_or_none()
        resolved_title = resolve_chapter_title(
            ch.title,
            chapter_number=ch.number,
            class_level=class_level,
            subject_code=subject_code,
            allow_catalog_fallback=allow_catalog_title_fallback,
        )[:200]
        if chapter:
            chapter.title = resolved_title
            chapter.order_index = max(ch.number - 1, 0)
        else:
            chapter = Chapter(
                id=str(uuid.uuid4()),
                book_id=book_id,
                number=ch.number,
                title=resolved_title,
                order_index=max(ch.number - 1, 0),
                created_at=now,
            )
            db.add(chapter)
        await db.flush()
        await sync_topics_for_chapter(
            db,
            chapter.id,
            ch.topics,
            ch.content,
            ch.title,
        )

    if subject_id and replace_orphans:
        await _remap_syllabus_progress_to_book_chapters(db, book_id, subject_id)

    persisted = await db.execute(select(Chapter.id).where(Chapter.book_id == book_id))
    return [str(row[0]) for row in persisted.all()]


async def resync_syllabus_from_material_file(
    db: AsyncSession,
    material: StudyMaterial,
) -> bool:
    """Replace syllabus chapters from this upload's PDF/text (never another book's catalog)."""
    if not material.is_full_book or not material.book_id or not material.subject_id:
        return False
    if material.status != "READY" or not material.file_url:
        return False

    result = await db.execute(
        select(Subject)
        .where(Subject.id == material.subject_id)
        .options(selectinload(Subject.academic_class))
    )
    subject = result.scalar_one_or_none()
    if not subject:
        return False

    class_level = await _resolve_class_level(db, material, subject)
    try:
        body, toc = await asyncio.to_thread(
            extract_material_text_for_indexing,
            material.file_url,
            material.mime_type or "application/pdf",
            material.file_name or "",
        )
    except Exception:
        logger.exception("syllabus resync file read failed materialId=%s", material.id)
        return False

    extracted = await extract_chapters_for_full_book_upload(
        text=body or "",
        syllabus_source_text=toc,
        fallback_title=material.title or material.file_name,
        class_level=class_level,
        subject_code=subject.code,
        subject_name=subject.name,
        material_id=str(material.id),
        file_name=material.file_name,
    )

    if len(extracted) < 2:
        return False

    await sync_extracted_syllabus(
        db,
        str(material.book_id),
        extracted,
        replace_orphans=True,
        class_level=class_level,
        subject_code=subject.code,
        subject_id=str(subject.id),
        allow_catalog_title_fallback=False,
    )
    if material.error_message and material.error_message.startswith("SYLLABUS_EXTRACTION_FAILED"):
        material.error_message = None
    await db.flush()
    logger.info(
        "[BOOK-EXTRACTION] resynced from upload materialId=%s chapters=%s",
        material.id,
        [(c.number, c.title) for c in extracted],
    )
    return True


async def repair_full_book_syllabus_if_empty(
    db: AsyncSession,
    material: StudyMaterial,
) -> bool:
    """Create chapter rows for indexed full books that still have an empty syllabus book."""
    if not material.is_full_book or not material.book_id or not material.subject_id:
        return False
    if material.status not in ("READY", "INDEXING"):
        return False

    count_result = await db.execute(
        select(func.count()).select_from(Chapter).where(Chapter.book_id == material.book_id)
    )
    if int(count_result.scalar() or 0) > 0:
        return False

    return await resync_syllabus_from_material_file(db, material)


async def sync_material_syllabus_from_text(
    db: AsyncSession,
    material: StudyMaterial,
    text: str,
    *,
    syllabus_source_text: str | None = None,
) -> None:
    if not material.subject_id:
        return

    result = await db.execute(
        select(Subject)
        .where(Subject.id == material.subject_id)
        .options(
            selectinload(Subject.books),
            selectinload(Subject.academic_class),
        )
    )
    subject = result.scalar_one_or_none()
    if not subject:
        return

    class_level = await _resolve_class_level(db, material, subject)

    if material.is_full_book:
        book_id = await ensure_dedicated_full_book(db, material, subject)
        logger.info(
            "[BOOK-EXTRACTION] materialId=%s fileName=%s academicClassId=%s subjectId=%s isFullBook=true",
            material.id,
            material.file_name,
            material.academic_class_id,
            material.subject_id,
        )
        extracted = await extract_chapters_for_full_book_upload(
            text=text,
            syllabus_source_text=syllabus_source_text,
            fallback_title=material.title or material.file_name,
            class_level=class_level,
            subject_code=subject.code,
            subject_name=subject.name,
            material_id=str(material.id),
            file_name=material.file_name,
        )
        logger.info(
            "[BOOK-EXTRACTION] materialId=%s extracted chapters=%s",
            material.id,
            [(c.number, c.title) for c in extracted],
        )
        chapter_ids = await sync_extracted_syllabus(
            db,
            book_id,
            extracted,
            replace_orphans=True,
            class_level=class_level,
            subject_code=subject.code,
            subject_id=str(subject.id),
            allow_catalog_title_fallback=False,
        )
        logger.info(
            "[BOOK-EXTRACTION] materialId=%s persisted chapters=%s chapter IDs=%s",
            material.id,
            len(chapter_ids),
            chapter_ids,
        )
        if not chapter_ids:
            material.error_message = (
                "SYLLABUS_EXTRACTION_FAILED: Could not extract a chapter list from this PDF. "
                "Re-upload or check that the file contains a readable table of contents."
            )
        elif material.error_message and material.error_message.startswith("SYLLABUS_EXTRACTION_FAILED"):
            material.error_message = None
        book = await db.get(Book, book_id)
        if book and material.title:
            book.title = material.title.strip()[:200]
        material.chapter_id = None
        material.topic_id = None
        await db.flush()
        return

    await link_chapter_wise_material(db, material)
    if not material.chapter_id:
        return
    extracted = await _extract_chapters_from_text_async(
        text,
        single_chapter=True,
        fallback_title=material.title or material.file_name,
        class_level=class_level,
        subject_code=subject.code,
        subject_name=subject.name,
        material_id=str(material.id),
        file_name=material.file_name,
    )
    if not extracted:
        return
    single = extracted[0]
    if not single.topics:
        single.topics = _extract_topics_heuristic(
            _normalize_text(text),
            single.title,
        )
    chapter = await db.get(Chapter, material.chapter_id)
    if chapter and single.title:
        chapter.title = resolve_chapter_title(
            single.title,
            chapter_number=chapter.number,
            class_level=class_level,
            subject_code=subject.code,
        )[:200]
    await sync_topics_for_chapter(
        db,
        material.chapter_id,
        single.topics,
        single.content,
        single.title,
    )


async def _ensure_subject_book(db: AsyncSession, subject: Subject) -> str:
    if subject.books:
        return sorted(subject.books, key=lambda b: b.order_index)[0].id
    book_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    db.add(
        Book(
            id=book_id,
            subject_id=subject.id,
            title=f"{subject.name} — uploaded materials",
            publisher="NCERT",
            is_ncert=True,
            order_index=0,
            created_at=now,
        )
    )
    await db.flush()
    return book_id


async def link_chapter_wise_material(db: AsyncSession, material: StudyMaterial) -> None:
    """Create or match a syllabus chapter row for a chapter-wise PDF before chunk insert."""
    if material.is_full_book or material.chapter_id:
        return
    if not material.subject_id or not material.academic_class_id:
        return

    result = await db.execute(
        select(Subject)
        .where(Subject.id == material.subject_id)
        .options(selectinload(Subject.books), selectinload(Subject.academic_class))
    )
    subject = result.scalar_one_or_none()
    if not subject:
        return

    book_id = material.book_id or await _ensure_subject_book(db, subject)
    chapter_number = parse_chapter_number_from_upload(material.file_name, material.title)
    if chapter_number is None:
        max_result = await db.execute(
            select(func.max(Chapter.number)).where(Chapter.book_id == book_id)
        )
        chapter_number = int(max_result.scalar() or 0) + 1

    class_level = subject.academic_class.level if subject.academic_class else None
    chapter_title = resolve_chapter_title(
        _chapter_title_from_material(material),
        chapter_number=chapter_number,
        class_level=class_level,
        subject_code=subject.code,
    )
    existing = await db.execute(
        select(Chapter).where(
            Chapter.book_id == book_id,
            Chapter.number == chapter_number,
        )
    )
    chapter = existing.scalar_one_or_none()
    now = datetime.now(timezone.utc)
    if chapter:
        if chapter_title and chapter.title != chapter_title:
            chapter.title = chapter_title
    else:
        chapter = Chapter(
            id=str(uuid.uuid4()),
            book_id=book_id,
            number=chapter_number,
            title=chapter_title,
            order_index=max(chapter_number - 1, 0),
            created_at=now,
        )
        db.add(chapter)

    await db.flush()
    material.book_id = book_id
    material.chapter_id = chapter.id


async def _delete_book_tree(db: AsyncSession, book_id: str) -> None:
    chapter_rows = await db.execute(select(Chapter.id).where(Chapter.book_id == book_id))
    for (chapter_id,) in chapter_rows.all():
        await _clear_chapter_topics(db, str(chapter_id))
    await db.execute(delete(Chapter).where(Chapter.book_id == book_id))
    book = await db.get(Book, book_id)
    if book:
        await db.delete(book)


async def cleanup_syllabus_after_material_removal(
    db: AsyncSession,
    material: StudyMaterial,
) -> None:
    """Drop upload-owned syllabus rows when nothing else references them."""
    mat_id = str(material.id)
    book_id = material.book_id
    chapter_id = material.chapter_id

    if material.is_full_book and book_id:
        others = await db.execute(
            select(func.count())
            .select_from(StudyMaterial)
            .where(
                StudyMaterial.book_id == book_id,
                StudyMaterial.id != mat_id,
            )
        )
        if int(others.scalar() or 0) == 0:
            await _delete_book_tree(db, str(book_id))
            return

    if chapter_id and not material.is_full_book:
        others = await db.execute(
            select(func.count())
            .select_from(StudyMaterial)
            .where(
                StudyMaterial.chapter_id == chapter_id,
                StudyMaterial.id != mat_id,
            )
        )
        if int(others.scalar() or 0) > 0:
            return
        chunk_linked = await db.execute(
            text(
                """
                SELECT COUNT(*)
                FROM document_chunks
                WHERE chapter_id::text = :chapter_id
                  AND material_id::text != :material_id
                """
            ),
            {"chapter_id": str(chapter_id), "material_id": mat_id},
        )
        if int(chunk_linked.scalar() or 0) > 0:
            return
        await _clear_chapter_topics(db, str(chapter_id))
        orphan = await db.get(Chapter, chapter_id)
        if orphan:
            await db.delete(orphan)
