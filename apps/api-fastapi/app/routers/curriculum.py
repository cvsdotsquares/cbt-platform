import re
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import delete as sql_delete
from sqlalchemy import func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.security import get_current_user, require_permission
from app.models.curriculum import (
    AcademicClass,
    Book,
    Chapter,
    Subject,
    SyllabusTopic,
    TeacherAssignment,
    TenantOfferedSubject,
)
from app.models.material import StudyMaterial
from app.models.user import User
from app.services.ncert_syllabus_catalog import normalize_catalog_subject_code
from app.services.offered_subjects import (
    filter_subjects_for_offering,
    offered_subject_ids_by_class,
    offered_subject_ids_for_class,
    replace_offered_subjects,
)

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


def _apply_tenant_offered_subjects(
    classes: list[dict],
    offered_by_class: dict[str, set[str] | None],
) -> list[dict]:
    if not offered_by_class:
        return classes
    out: list[dict] = []
    for cls in classes:
        cid = str(cls["id"])
        offered = offered_by_class.get(cid)
        if offered is None:
            out.append(cls)
            continue
        subjects = filter_subjects_for_offering(cls["subjects"], offered)
        if subjects:
            out.append({**cls, "subjects": subjects})
    return out


async def _subject_ids_with_materials(
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
            SELECT DISTINCT sm.subject_id
            FROM study_materials sm
            WHERE sm.tenant_id::text = :tenant_id
              AND sm.status = 'READY'
              AND sm.subject_id IS NOT NULL
              {subject_clause}
            """
        ),
        params,
    )
    return {str(row[0]) for row in result.all() if row[0]}


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


async def _attach_full_book_materials_to_classes(
    db: AsyncSession,
    tenant_id: str,
    classes: list[dict],
    *,
    include_topics: bool,
) -> list[dict]:
    """Ensure indexed full-book uploads appear under their subject with chapter rows."""
    result = await db.execute(
        select(StudyMaterial).where(
            StudyMaterial.tenant_id == tenant_id,
            StudyMaterial.status == "READY",
            StudyMaterial.is_full_book.is_(True),
            StudyMaterial.book_id.isnot(None),
            StudyMaterial.subject_id.isnot(None),
        )
    )
    materials = list(result.scalars().all())
    if not materials:
        return classes

    book_ids = {str(m.book_id) for m in materials if m.book_id}
    chapter_load = selectinload(Book.chapters)
    if include_topics:
        chapter_load = chapter_load.selectinload(Chapter.topics)
    books_result = await db.execute(
        select(Book).where(Book.id.in_(book_ids)).options(chapter_load)
    )
    books_by_id = {str(b.id): _book(b, include_topics) for b in books_result.scalars().all()}
    subject_to_books: dict[str, dict[str, dict]] = {}
    for material in materials:
        if not material.book_id or not material.subject_id:
            continue
        book_payload = books_by_id.get(str(material.book_id))
        if book_payload:
            sid = str(material.subject_id)
            subject_to_books.setdefault(sid, {})[str(book_payload["id"])] = book_payload

    if not subject_to_books:
        return classes

    out: list[dict] = []
    for cls in classes:
        subjects: list[dict] = []
        for subject in cls.get("subjects") or []:
            sid = str(subject["id"])
            extras = subject_to_books.get(sid)
            if not extras:
                subjects.append(subject)
                continue
            books = list(subject.get("books") or [])
            by_book = {str(b["id"]): b for b in books}
            by_book.update(extras)
            subjects.append(
                {
                    **subject,
                    "books": sorted(by_book.values(), key=lambda b: b.get("orderIndex", 0)),
                }
            )
        out.append({**cls, "subjects": subjects})
    return out


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
        material_subject_ids = await _subject_ids_with_materials(db, tenant_id)
        if not chapter_ids and not material_subject_ids:
            return []
        classes = await _load_classes(db, tenant_id, include_topics=include_topics)
        filtered = _filter_classes_by_chapters(classes, chapter_ids)
        if not material_subject_ids:
            return filtered
        by_class_id = {str(c["id"]): c for c in filtered}
        for cls in classes:
            cid = str(cls["id"])
            subjects_out: list[dict] = []
            existing = by_class_id.get(cid)
            existing_by_subj = {
                str(s["id"]): s for s in (existing or {}).get("subjects", [])
            }
            for subject in cls["subjects"]:
                sid = str(subject["id"])
                if sid not in material_subject_ids:
                    if sid in existing_by_subj:
                        subjects_out.append(existing_by_subj[sid])
                    continue
                if sid in existing_by_subj:
                    subjects_out.append(existing_by_subj[sid])
                else:
                    subjects_out.append({**subject, "books": []})
            if subjects_out:
                by_class_id[cid] = {**cls, "subjects": subjects_out}
        classes_out = sorted(by_class_id.values(), key=lambda c: c["level"])
        classes_out = await _attach_full_book_materials_to_classes(
            db,
            str(tenant_id),
            classes_out,
            include_topics=include_topics,
        )
        offered_by_class = await offered_subject_ids_by_class(db, str(tenant_id))
        return _apply_tenant_offered_subjects(classes_out, offered_by_class)

    classes = await _load_classes(db, tenant_id, include_topics=include_topics)
    offered_by_class = await offered_subject_ids_by_class(db, str(tenant_id))
    return _apply_tenant_offered_subjects(classes, offered_by_class)


@router.get("/classes/{class_id}")
async def get_class(
    class_id: str,
    include_topics: bool = Query(False, alias="includeTopics"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tenant_id = current_user.tenant_id
    chapter_load = selectinload(AcademicClass.subjects).selectinload(Subject.books).selectinload(Book.chapters)
    if include_topics:
        chapter_load = chapter_load.selectinload(Chapter.topics)
    result = await db.execute(
        select(AcademicClass)
        .where(
            AcademicClass.id == class_id,
            or_(AcademicClass.tenant_id == tenant_id, AcademicClass.tenant_id.is_(None)),
        )
        .options(chapter_load)
    )
    cls = result.scalar_one_or_none()
    if not cls:
        raise HTTPException(status_code=404, detail="Class not found")
    payload = _class(cls, include_topics)
    offered_by_class = await offered_subject_ids_by_class(db, str(tenant_id))
    filtered = _apply_tenant_offered_subjects([payload], offered_by_class)
    return filtered[0] if filtered else payload


async def _subject_deletable(db: AsyncSession, tenant_id: str, subject: Subject) -> bool:
    if subject.books:
        return False
    materials = await db.execute(
        select(func.count())
        .select_from(StudyMaterial)
        .where(
            StudyMaterial.subject_id == subject.id,
            StudyMaterial.tenant_id == tenant_id,
        )
    )
    if (materials.scalar() or 0) > 0:
        return False
    assignments = await db.execute(
        select(func.count())
        .select_from(TeacherAssignment)
        .where(TeacherAssignment.subject_id == subject.id)
    )
    return (assignments.scalar() or 0) == 0


async def _remove_subject_from_class_offering(
    db: AsyncSession,
    tenant_id: str,
    academic_class: AcademicClass,
    subject_id: str,
) -> list[str]:
    sorted_subjects = sorted(academic_class.subjects, key=lambda x: x.order_index)
    all_ids = [str(s.id) for s in sorted_subjects]
    if subject_id not in all_ids:
        raise HTTPException(status_code=400, detail="Subject does not belong to this class")

    class_id = str(academic_class.id)
    offered = await offered_subject_ids_for_class(db, tenant_id, class_id)
    if offered is None:
        remaining = [sid for sid in all_ids if sid != subject_id]
    else:
        remaining = [sid for sid in offered if sid != subject_id]

    if len(remaining) < 1:
        raise HTTPException(status_code=400, detail="At least one subject must remain for this class")

    await replace_offered_subjects(db, tenant_id, class_id, remaining)
    return remaining


def _subject_payload(
    s: Subject,
    *,
    offered: bool,
) -> dict:
    return {
        "id": s.id,
        "name": s.name,
        "code": s.code,
        "orderIndex": s.order_index,
        "offered": offered,
        "canDelete": True,
    }


def _offered_subjects_response(
    class_id: str,
    sorted_subjects: list[Subject],
    offered: set[str] | None,
) -> dict:
    if offered is None:
        active = sorted_subjects
        configured = False
        offered_ids = [s.id for s in sorted_subjects]
        catalog: list[dict] = []
    else:
        configured = True
        offered_ids = sorted(offered)
        active = [s for s in sorted_subjects if str(s.id) in offered]
        catalog = [
            _subject_payload(s, offered=False)
            for s in sorted_subjects
            if str(s.id) not in offered
        ]

    return {
        "academicClassId": class_id,
        "configured": configured,
        "offeredSubjectIds": offered_ids,
        "subjects": [_subject_payload(s, offered=True) for s in active],
        "catalogSubjects": catalog,
    }


def _class_subjects_load():
    return selectinload(AcademicClass.subjects).selectinload(Subject.books)


class CreateSubjectBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    academic_class_id: str = Field(alias="academicClassId")
    name: str
    code: str | None = None
    description: str | None = None


def _slug_subject_code(name: str) -> str:
    parts = re.findall(r"[A-Za-z0-9]+", name.strip().upper())
    if not parts:
        return "SUBJ"
    if len(parts) == 1:
        return parts[0][:8]
    initials = "".join(p[0] for p in parts if p)
    return (initials or parts[0][:8])[:8]


async def _resolve_subject_code(
    db: AsyncSession,
    academic_class_id: str,
    name: str,
    provided: str | None,
) -> str:
    base = normalize_catalog_subject_code((provided or _slug_subject_code(name)).strip())
    if not base:
        base = "SUBJ"
    base = re.sub(r"[^A-Z0-9_]", "", base)[:12] or "SUBJ"
    code = base
    suffix = 2
    while True:
        existing = await db.execute(
            select(Subject.id).where(
                Subject.academic_class_id == academic_class_id,
                Subject.code == code,
            )
        )
        if existing.scalar_one_or_none() is None:
            return code
        code = f"{base[:8]}{suffix}"
        suffix += 1


@router.post("/subjects")
async def create_subject(
    body: CreateSubjectBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("curriculum:manage")),
):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Subject name is required")

    cls_result = await db.execute(
        select(AcademicClass).where(AcademicClass.id == body.academic_class_id)
    )
    academic_class = cls_result.scalar_one_or_none()
    if not academic_class:
        raise HTTPException(status_code=404, detail="Class not found")
    tenant_id = current_user.tenant_id
    if academic_class.tenant_id and str(academic_class.tenant_id) != str(tenant_id):
        raise HTTPException(status_code=404, detail="Class not found")

    max_order = await db.execute(
        select(func.coalesce(func.max(Subject.order_index), -1)).where(
            Subject.academic_class_id == body.academic_class_id
        )
    )
    order_index = int(max_order.scalar_one()) + 1
    code = await _resolve_subject_code(db, body.academic_class_id, name, body.code)
    now = datetime.now(timezone.utc)

    subject = Subject(
        id=str(uuid.uuid4()),
        academic_class_id=body.academic_class_id,
        name=name,
        code=code,
        description=body.description.strip() if body.description else None,
        order_index=order_index,
        created_at=now,
    )
    db.add(subject)
    await db.flush()
    await db.refresh(subject)

    offered = await offered_subject_ids_for_class(db, str(tenant_id), body.academic_class_id)
    if offered is not None:
        await replace_offered_subjects(
            db,
            str(tenant_id),
            body.academic_class_id,
            [*offered, subject.id],
        )

    payload = _subject(subject, include_topics=False)
    payload["academicClassId"] = body.academic_class_id
    return payload


class SetOfferedSubjectsBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    subject_ids: list[str] = Field(alias="subjectIds", min_length=1)


@router.get("/classes/{class_id}/offered-subjects")
async def get_offered_subjects(
    class_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    cls_result = await db.execute(
        select(AcademicClass)
        .where(
            AcademicClass.id == class_id,
            or_(AcademicClass.tenant_id == current_user.tenant_id, AcademicClass.tenant_id.is_(None)),
        )
        .options(_class_subjects_load())
    )
    academic_class = cls_result.scalar_one_or_none()
    if not academic_class:
        raise HTTPException(status_code=404, detail="Class not found")

    tenant_id = str(current_user.tenant_id)
    offered = await offered_subject_ids_for_class(db, tenant_id, class_id)
    sorted_subjects = sorted(academic_class.subjects, key=lambda x: x.order_index)
    return _offered_subjects_response(class_id, sorted_subjects, offered)


@router.put("/classes/{class_id}/offered-subjects")
async def set_offered_subjects(
    class_id: str,
    body: SetOfferedSubjectsBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("curriculum:manage")),
):
    cls_result = await db.execute(
        select(AcademicClass)
        .where(
            AcademicClass.id == class_id,
            or_(AcademicClass.tenant_id == current_user.tenant_id, AcademicClass.tenant_id.is_(None)),
        )
        .options(_class_subjects_load())
    )
    academic_class = cls_result.scalar_one_or_none()
    if not academic_class:
        raise HTTPException(status_code=404, detail="Class not found")

    class_subject_ids = {str(s.id) for s in academic_class.subjects}
    unique = list(dict.fromkeys(str(sid) for sid in body.subject_ids if sid))
    invalid = [sid for sid in unique if sid not in class_subject_ids]
    if invalid:
        raise HTTPException(status_code=400, detail="One or more subjects do not belong to this class")

    tenant_id = str(current_user.tenant_id)
    saved = await replace_offered_subjects(db, tenant_id, class_id, unique)
    sorted_subjects = sorted(academic_class.subjects, key=lambda x: x.order_index)
    return _offered_subjects_response(class_id, sorted_subjects, saved)


@router.delete("/subjects/{subject_id}")
async def delete_subject(
    subject_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("curriculum:manage")),
):
    tenant_id = str(current_user.tenant_id)
    result = await db.execute(
        select(Subject)
        .where(Subject.id == subject_id)
        .options(selectinload(Subject.books), selectinload(Subject.academic_class))
    )
    subject = result.scalar_one_or_none()
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found")

    cls = subject.academic_class
    if cls.tenant_id and str(cls.tenant_id) != tenant_id:
        raise HTTPException(status_code=404, detail="Subject not found")

    if subject.books:
        cls_result = await db.execute(
            select(AcademicClass)
            .where(AcademicClass.id == subject.academic_class_id)
            .options(_class_subjects_load())
        )
        academic_class = cls_result.scalar_one()
        await _remove_subject_from_class_offering(db, tenant_id, academic_class, subject_id)
        return {"ok": True, "id": subject_id, "removedFromClass": True}

    if not await _subject_deletable(db, tenant_id, subject):
        raise HTTPException(
            status_code=400,
            detail="Remove teacher assignments and uploaded books for this subject before deleting it.",
        )

    cls_result = await db.execute(
        select(AcademicClass)
        .where(AcademicClass.id == subject.academic_class_id)
        .options(_class_subjects_load())
    )
    academic_class = cls_result.scalar_one()
    await _remove_subject_from_class_offering(db, tenant_id, academic_class, subject_id)

    await db.execute(
        sql_delete(TenantOfferedSubject).where(TenantOfferedSubject.subject_id == subject_id)
    )
    await db.delete(subject)
    return {"ok": True, "id": subject_id, "removedFromClass": False}
