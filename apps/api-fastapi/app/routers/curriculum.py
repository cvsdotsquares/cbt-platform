from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.curriculum import AcademicClass, Book, Chapter, Subject, SyllabusTopic
from app.models.user import User

router = APIRouter(prefix="/curriculum", tags=["Curriculum"])


def _topic(t: SyllabusTopic) -> dict:
    return {"id": t.id, "title": t.title, "orderIndex": t.order_index}


def _chapter(c: Chapter, include_topics: bool) -> dict:
    topics = []
    if include_topics:
        topics = [_topic(t) for t in sorted(c.topics, key=lambda x: x.order_index)]
    return {
        "id": c.id,
        "number": c.number,
        "title": c.title,
        "orderIndex": c.order_index,
        "topics": topics,
    }


def _book(b: Book, include_topics: bool) -> dict:
    return {
        "id": b.id,
        "title": b.title,
        "publisher": b.publisher,
        "isNcert": b.is_ncert,
        "orderIndex": b.order_index,
        "chapters": [_chapter(c, include_topics) for c in sorted(b.chapters, key=lambda x: x.order_index)],
    }


def _subject(s: Subject, include_topics: bool) -> dict:
    return {
        "id": s.id,
        "name": s.name,
        "code": s.code,
        "orderIndex": s.order_index,
        "books": [_book(b, include_topics) for b in sorted(s.books, key=lambda x: x.order_index)],
    }


def _class(cls: AcademicClass, include_topics: bool) -> dict:
    return {
        "id": cls.id,
        "level": cls.level,
        "name": cls.name,
        "description": cls.description,
        "subjects": [_subject(s, include_topics) for s in sorted(cls.subjects, key=lambda x: x.order_index)],
    }


def _filter_classes_by_chapters(classes: list[dict], chapter_ids: set[str]) -> list[dict]:
    filtered: list[dict] = []
    for cls in classes:
        subjects: list[dict] = []
        for subject in cls["subjects"]:
            books: list[dict] = []
            for book in subject["books"]:
                chapters = [ch for ch in book["chapters"] if str(ch["id"]) in chapter_ids]
                if chapters:
                    books.append({**book, "chapters": chapters})
            if books:
                subjects.append({**subject, "books": books})
        if subjects:
            filtered.append({**cls, "subjects": subjects})
    return filtered


async def _load_classes(
    db: AsyncSession,
    tenant_id: str,
    allowed_subject_ids: list[str] | None = None,
    include_topics: bool = False,
) -> list[dict]:
    chapter_load = selectinload(AcademicClass.subjects).selectinload(Subject.books).selectinload(Book.chapters)
    if include_topics:
        chapter_load = chapter_load.selectinload(Chapter.topics)
    stmt = (
        select(AcademicClass)
        .where(or_(AcademicClass.tenant_id == tenant_id, AcademicClass.tenant_id.is_(None)))
        .order_by(AcademicClass.level)
        .options(chapter_load)
    )
    if allowed_subject_ids is not None:
        if not allowed_subject_ids:
            return []
        allowed = {str(sid) for sid in allowed_subject_ids}
        stmt = stmt.where(AcademicClass.subjects.any(Subject.id.in_(allowed_subject_ids)))

    result = await db.execute(stmt)
    classes = [_class(c, include_topics) for c in result.scalars().all()]
    if allowed_subject_ids is None:
        return classes

    allowed = {str(sid) for sid in allowed_subject_ids}
    return [
        {
            **cls,
            "subjects": [s for s in cls["subjects"] if str(s["id"]) in allowed],
        }
        for cls in classes
        if any(str(s["id"]) in allowed for s in cls["subjects"])
    ]


async def _uploaded_chapter_ids_for_tenant(
    db: AsyncSession,
    tenant_id: str,
    allowed_subject_ids: list[str] | None = None,
) -> set[str]:
    if allowed_subject_ids is not None and not allowed_subject_ids:
        return set()

    params: dict[str, object] = {"tenant_id": str(tenant_id)}
    subject_clause = ""
    if allowed_subject_ids:
        params["subject_ids"] = [str(sid) for sid in allowed_subject_ids]
        subject_clause = "AND sm.subject_id::text = ANY(CAST(:subject_ids AS text[]))"

    result = await db.execute(
        text(
            f"""
            SELECT sm.chapter_id, sm.book_id, sm.is_full_book, sm.id
            FROM study_materials sm
            WHERE sm.tenant_id::text = :tenant_id
              AND sm.status = 'READY'
              {subject_clause}
            """
        ),
        params,
    )

    ids: set[str] = set()
    book_ids: set[str] = set()
    full_book_material_ids: list[str] = []
    for chapter_id, book_id, is_full_book, material_id in result.all():
        if chapter_id:
            ids.add(str(chapter_id))
        if book_id:
            book_ids.add(str(book_id))
        if is_full_book:
            full_book_material_ids.append(str(material_id))

    if book_ids:
        book_rows = await db.execute(
            text(
                """
                SELECT c.id
                FROM chapters c
                WHERE c.book_id::text = ANY(CAST(:book_ids AS text[]))
                """
            ),
            {"book_ids": list(book_ids)},
        )
        ids.update(str(row[0]) for row in book_rows.all())

    if full_book_material_ids:
        try:
            chunk_rows = await db.execute(
                text(
                    """
                    SELECT DISTINCT dc.chapter_id
                    FROM document_chunks dc
                    WHERE dc.material_id::text = ANY(CAST(:material_ids AS text[]))
                      AND dc.chapter_id IS NOT NULL
                    """
                ),
                {"material_ids": full_book_material_ids},
            )
            ids.update(str(row[0]) for row in chunk_rows.all() if row[0])
        except Exception:
            await db.rollback()

    return ids


@router.get("/classes")
async def list_classes(
    uploaded_only: bool = Query(False, alias="uploadedOnly"),
    include_topics: bool = Query(False, alias="includeTopics"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tenant_id = current_user.tenant_id
    if uploaded_only:
        chapter_ids = await _uploaded_chapter_ids_for_tenant(db, tenant_id)
        if not chapter_ids:
            return []
        classes = await _load_classes(db, tenant_id, include_topics=include_topics)
        return _filter_classes_by_chapters(classes, chapter_ids)

    return await _load_classes(db, tenant_id, include_topics=include_topics)
