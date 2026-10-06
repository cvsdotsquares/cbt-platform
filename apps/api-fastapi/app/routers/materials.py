import asyncio
import re
import uuid
from datetime import datetime, timezone

from starlette.datastructures import UploadFile as StarletteUploadFile

from pydantic import BaseModel, ConfigDict, Field

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import AsyncSessionLocal, get_db
from app.core.security import fetch_role_names_for_user, get_current_user, require_permission
from app.models.curriculum import Batch, Book, Chapter, Subject
from app.models.material import StudyMaterial
from app.models.user import User
from app.services.material_indexing import (
    prepare_material_reindex,
    request_material_index_cancel,
    schedule_material_index,
    wait_for_material_index_idle,
)
from app.services.subject_guess import guess_subject_id, resolve_upload_subject_id
from app.services.syllabus_sync import (
    cleanup_syllabus_after_material_removal,
    repair_full_book_syllabus_if_empty,
    resync_syllabus_from_material_file,
)
from app.services.material_storage import (
    MAX_UPLOAD_BYTES,
    delete_material_file,
    read_material_file,
    save_material_upload_file,
)

router = APIRouter(prefix="/materials", tags=["Materials"])

MAX_BATCH_FILES = 25
_PURGE_ALL_MATERIALS_ROLES = frozenset(
    {"SUPER_ADMIN", "ORG_ADMIN", "EXAM_MANAGER"}
)
ALLOWED_MIMES = {
    "application/pdf",
    "text/plain",
    "text/markdown",
    "application/octet-stream",
}


def _dt(value: datetime | None) -> str | None:
    return value.isoformat() if value else None


def _material(m: StudyMaterial) -> dict:
    return {
        "id": m.id,
        "title": m.title,
        "type": m.type,
        "fileName": m.file_name,
        "fileSize": m.file_size,
        "mimeType": m.mime_type,
        "status": m.status,
        "chunkCount": m.chunk_count,
        "academicSession": m.academic_session,
        "errorMessage": m.error_message,
        "createdAt": _dt(m.created_at),
        "subjectId": m.subject_id,
        "academicClassId": m.academic_class_id,
        "batchId": m.batch_id,
        "batch": (
            {"id": m.batch.id, "name": m.batch.name}
            if m.batch
            else None
        ),
        "academicClass": (
            {"level": m.academic_class.level, "name": m.academic_class.name}
            if m.academic_class
            else None
        ),
        "subject": (
            {"id": m.subject.id, "name": m.subject.name, "code": m.subject.code}
            if m.subject
            else None
        ),
        "chapterId": m.chapter_id,
        "chapter": (
            {"id": m.chapter.id, "title": m.chapter.title, "number": m.chapter.number}
            if m.chapter
            else None
        ),
        "bookId": m.book_id,
        "topic": {"title": m.topic.title} if m.topic else None,
        "isFullBook": m.is_full_book,
    }


def _material_load_options():
    return (
        selectinload(StudyMaterial.academic_class),
        selectinload(StudyMaterial.batch),
        selectinload(StudyMaterial.subject),
        selectinload(StudyMaterial.chapter),
        selectinload(StudyMaterial.topic),
    )


async def _fetch_material(db: AsyncSession, material_id: str, tenant_id: str) -> StudyMaterial | None:
    result = await db.execute(
        select(StudyMaterial)
        .where(StudyMaterial.id == material_id, StudyMaterial.tenant_id == tenant_id)
        .options(*_material_load_options())
    )
    return result.scalar_one_or_none()


class MaterialUpdateBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    title: str | None = None
    academic_class_id: str | None = Field(default=None, alias="academicClassId")
    subject_id: str | None = Field(default=None, alias="subjectId")


def _title_from_file_name(file_name: str) -> str:
    return re.sub(r"\.[^.]+$", "", file_name) or file_name


def _resolve_upload_title(title_raw: object | None, file_name: str, *, has_class: bool) -> str:
    title_str = str(title_raw).strip() if title_raw else ""
    if title_str:
        return title_str
    if has_class:
        return _title_from_file_name(file_name)
    raise HTTPException(
        status_code=400,
        detail="Provide a document title or select class and subject before uploading.",
    )


def _normalize_mime(file_name: str, mime_type: str) -> str:
    if mime_type == "application/octet-stream" and file_name.lower().endswith(".pdf"):
        return "application/pdf"
    return mime_type


async def _user_can_purge_all_materials(db: AsyncSession, user: User) -> bool:
    role_names = await fetch_role_names_for_user(db, str(user.id))
    roles = {name.strip().upper() for name in role_names}
    return bool(roles & _PURGE_ALL_MATERIALS_ROLES)


async def _purge_material_from_db(material_id: str, tenant_id: str) -> str:
    """Delete chunks + material row; returns file_url for disk cleanup."""
    from sqlalchemy import text
    from sqlalchemy.exc import DBAPIError

    request_material_index_cancel(material_id)
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(StudyMaterial).where(
                StudyMaterial.id == material_id,
                StudyMaterial.tenant_id == tenant_id,
            )
        )
        material = result.scalar_one_or_none()
        if not material:
            raise HTTPException(status_code=404, detail="Material not found")

        file_url = material.file_url
        await db.execute(text("SET LOCAL lock_timeout = '20s'"))
        await db.execute(
            text("DELETE FROM document_chunks WHERE material_id = :material_id"),
            {"material_id": material_id},
        )
        await cleanup_syllabus_after_material_removal(db, material)
        await db.delete(material)
        try:
            await db.commit()
        except DBAPIError:
            await db.rollback()
            raise
        return file_url


def _validate_upload_file(file_name: str, mime_type: str) -> None:
    if mime_type not in ALLOWED_MIMES and not file_name.lower().endswith((".pdf", ".txt", ".md")):
        raise HTTPException(status_code=400, detail="Only PDF, TXT, and MD files are allowed.")


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


async def _subjects_for_class(db: AsyncSession, academic_class_id: str) -> list[Subject]:
    result = await db.execute(select(Subject).where(Subject.academic_class_id == academic_class_id))
    return list(result.scalars().all())


async def _resolve_subject_meta(db: AsyncSession, academic_class_id: str, subject_id: str) -> dict:
    result = await db.execute(
        select(Subject)
        .where(Subject.id == subject_id)
        .options(selectinload(Subject.books))
    )
    subject = result.scalar_one_or_none()
    if not subject or subject.academic_class_id != academic_class_id:
        raise HTTPException(status_code=400, detail="Invalid subject for selected class")
    book_id = await _ensure_subject_book(db, subject)
    return {
        "academic_class_id": academic_class_id,
        "subject_id": subject_id,
        "book_id": book_id,
        "chapter_id": None,
        "topic_id": None,
    }


async def _resolve_full_book_meta(
    db: AsyncSession,
    academic_class_id: str,
    subject_id: str,
    material_title: str,
) -> dict:
    from app.services.syllabus_sync import create_book_for_upload

    result = await db.execute(
        select(Subject)
        .where(Subject.id == subject_id)
        .options(selectinload(Subject.books))
    )
    subject = result.scalar_one_or_none()
    if not subject or subject.academic_class_id != academic_class_id:
        raise HTTPException(status_code=400, detail="Invalid subject for selected class")
    book_id = await create_book_for_upload(db, subject, material_title)
    return {
        "academic_class_id": academic_class_id,
        "subject_id": subject_id,
        "book_id": book_id,
        "chapter_id": None,
        "topic_id": None,
    }


async def _resolve_upload_target(
    db: AsyncSession,
    *,
    academic_class_id: str,
    subject_id: str,
    chapter_id: str | None,
    is_full_book: bool,
    material_title: str | None = None,
) -> dict:
    if is_full_book:
        return await _resolve_full_book_meta(
            db,
            academic_class_id,
            subject_id,
            material_title or "Uploaded book",
        )
    if not chapter_id:
        return await _resolve_subject_meta(db, academic_class_id, subject_id)
    ch_result = await db.execute(
        select(Chapter)
        .where(Chapter.id == str(chapter_id))
        .options(selectinload(Chapter.book).selectinload(Book.subject))
    )
    chapter = ch_result.scalar_one_or_none()
    if not chapter or chapter.book.subject.id != str(subject_id):
        raise HTTPException(status_code=400, detail="Invalid chapter for selected subject")
    if chapter.book.subject.academic_class_id != str(academic_class_id):
        raise HTTPException(status_code=400, detail="Subject does not belong to the selected class")
    return {
        "academic_class_id": academic_class_id,
        "subject_id": subject_id,
        "book_id": chapter.book_id,
        "chapter_id": str(chapter_id),
        "topic_id": None,
    }


async def _resolve_optional_batch_id(
    db: AsyncSession,
    *,
    tenant_id: str,
    batch_id: str | None,
    academic_class_id: str,
    academic_session: str,
) -> str | None:
    if not batch_id:
        return None
    result = await db.execute(
        select(Batch).where(
            Batch.id == batch_id,
            Batch.tenant_id == tenant_id,
            Batch.is_active.is_(True),
        )
    )
    batch = result.scalar_one_or_none()
    if not batch:
        raise HTTPException(status_code=400, detail="Invalid section (batch) for this institute.")
    if str(batch.academic_class_id) != str(academic_class_id):
        raise HTTPException(status_code=400, detail="Section does not belong to the selected class.")
    batch_year = (batch.academic_year or "").strip()
    upload_year = (academic_session or "").strip()
    if batch_year and upload_year and batch_year != upload_year:
        raise HTTPException(
            status_code=400,
            detail="Section academic session does not match the upload session.",
        )
    return str(batch.id)


async def _create_material_from_upload(
    db: AsyncSession,
    *,
    tenant_id: str,
    user_id: str,
    resolved: dict,
    file_name: str,
    file_url: str,
    file_size: int,
    mime_type: str,
    title: str,
    material_type: str,
    academic_session: str,
    is_full_book: bool,
    topic_id: str | None,
    batch_id: str | None = None,
) -> StudyMaterial:
    now = datetime.now(timezone.utc)
    material = StudyMaterial(
        id=str(uuid.uuid4()),
        tenant_id=tenant_id,
        title=title,
        type=material_type,
        academic_class_id=resolved["academic_class_id"],
        batch_id=batch_id,
        subject_id=resolved["subject_id"],
        book_id=resolved["book_id"],
        chapter_id=resolved.get("chapter_id"),
        topic_id=topic_id or resolved.get("topic_id"),
        is_full_book=is_full_book,
        academic_session=academic_session,
        uploaded_by_id=user_id,
        file_name=file_name,
        file_url=file_url,
        file_size=file_size,
        mime_type=mime_type,
        status="PENDING",
        chunk_count=0,
        created_at=now,
        updated_at=now,
    )
    db.add(material)
    return material


@router.get("")
async def list_materials(
    chapter_id: str | None = Query(None, alias="chapterId"),
    type: str | None = Query(None),
    academic_class_id: str | None = Query(None, alias="academicClassId"),
    subject_id: str | None = Query(None, alias="subjectId"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    stmt = (
        select(StudyMaterial)
        .where(StudyMaterial.tenant_id == current_user.tenant_id)
        .order_by(StudyMaterial.created_at.desc())
        .options(
            selectinload(StudyMaterial.academic_class),
            selectinload(StudyMaterial.subject),
            selectinload(StudyMaterial.chapter),
            selectinload(StudyMaterial.topic),
        )
    )
    if chapter_id:
        stmt = stmt.where(StudyMaterial.chapter_id == chapter_id)
    if type:
        stmt = stmt.where(StudyMaterial.type == type)
    if academic_class_id:
        stmt = stmt.where(StudyMaterial.academic_class_id == academic_class_id)
    if subject_id:
        stmt = stmt.where(StudyMaterial.subject_id == subject_id)

    result = await db.execute(stmt)
    return [_material(m) for m in result.scalars().all()]


@router.post("/upload-batch")
async def upload_materials_batch(
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(require_permission("material:upload")),
):
    """Upload many files in one request (single syllabus lookup, queued indexing)."""
    form = await request.form()
    uploads = [f for f in form.getlist("files") if isinstance(f, StarletteUploadFile)]
    if not uploads:
        single = form.get("file")
        if isinstance(single, StarletteUploadFile):
            uploads = [single]
    if not uploads:
        raise HTTPException(status_code=400, detail='No files uploaded. Use field name "files".')
    if len(uploads) > MAX_BATCH_FILES:
        raise HTTPException(status_code=400, detail=f"Maximum {MAX_BATCH_FILES} files per batch.")

    academic_class_id = str(form.get("academicClassId") or form.get("academic_class_id") or "").strip()
    subject_id = str(form.get("subjectId") or form.get("subject_id") or "").strip()
    if not academic_class_id:
        raise HTTPException(
            status_code=400,
            detail="Class is required. Select a class or add a title and retag the document after upload.",
        )
    if not subject_id:
        raise HTTPException(status_code=400, detail="Subject is required for the selected class.")

    material_type = "NCERT"
    academic_session = str(form.get("academicSession") or form.get("academic_session") or "2025-26")
    batch_id_raw = str(form.get("batchId") or form.get("batch_id") or "").strip() or None
    full_book = form.get("fullBook") or form.get("full_book")
    is_full_book = str(full_book or "").lower() in ("true", "1")
    chapter_id = form.get("chapterId") or form.get("chapter_id")
    topic_id = str(form.get("topicId") or form.get("topic_id") or "") or None
    shared_title = str(form.get("title") or "").strip()
    titles_raw = form.get("titles")
    titles_list = [t.strip() for t in str(titles_raw).split("\n")] if titles_raw else []

    staged: list[dict] = []
    for index, upload in enumerate(uploads):
        file_name = upload.filename or f"upload-{index + 1}.pdf"
        mime_type = _normalize_mime(file_name, upload.content_type or "application/octet-stream")
        _validate_upload_file(file_name, mime_type)
        try:
            file_url, file_size = await save_material_upload_file(
                current_user.tenant_id, file_name, upload
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        if file_size <= 0:
            raise HTTPException(status_code=400, detail=f"Empty file: {file_name}")

        if len(uploads) == 1 and shared_title:
            per_file_title = shared_title
        elif index < len(titles_list) and titles_list[index]:
            per_file_title = titles_list[index]
        else:
            per_file_title = ""
        title = _resolve_upload_title(per_file_title, file_name, has_class=True)

        staged.append(
            {
                "file_name": file_name,
                "file_url": file_url,
                "file_size": file_size,
                "mime_type": mime_type,
                "title": title,
            }
        )

    created: list[StudyMaterial] = []
    async with AsyncSessionLocal() as db:
        try:
            batch_id = await _resolve_optional_batch_id(
                db,
                tenant_id=current_user.tenant_id,
                batch_id=batch_id_raw,
                academic_class_id=academic_class_id,
                academic_session=academic_session,
            )
            class_subjects = await _subjects_for_class(db, academic_class_id)
            resolve_cache: dict[tuple[str, str | None, bool], dict] = {}
            for item in staged:
                effective_subject_id = (
                    guess_subject_id(
                        item["file_name"],
                        item["title"],
                        class_subjects,
                        fallback_subject_id=subject_id,
                    )
                    or subject_id
                )
                if is_full_book:
                    resolved = await _resolve_upload_target(
                        db,
                        academic_class_id=academic_class_id,
                        subject_id=effective_subject_id,
                        chapter_id=str(chapter_id) if chapter_id else None,
                        is_full_book=True,
                        material_title=item["title"],
                    )
                    if topic_id and not resolved.get("topic_id"):
                        resolved = {**resolved, "topic_id": topic_id}
                else:
                    cache_key = (
                        effective_subject_id,
                        str(chapter_id) if chapter_id else None,
                        False,
                    )
                    if cache_key not in resolve_cache:
                        resolved = await _resolve_upload_target(
                            db,
                            academic_class_id=academic_class_id,
                            subject_id=effective_subject_id,
                            chapter_id=str(chapter_id) if chapter_id else None,
                            is_full_book=False,
                        )
                        if topic_id and not resolved.get("topic_id"):
                            resolved = {**resolved, "topic_id": topic_id}
                        resolve_cache[cache_key] = resolved
                    resolved = resolve_cache[cache_key]

                material = await _create_material_from_upload(
                    db,
                    tenant_id=current_user.tenant_id,
                    user_id=current_user.id,
                    resolved=resolved,
                    file_name=item["file_name"],
                    file_url=item["file_url"],
                    file_size=item["file_size"],
                    mime_type=item["mime_type"],
                    title=item["title"],
                    material_type=material_type,
                    academic_session=academic_session,
                    is_full_book=is_full_book,
                    topic_id=topic_id,
                    batch_id=batch_id,
                )
                created.append(material)
            await db.commit()
            created_ids = [m.id for m in created]
            loaded: list[StudyMaterial] = []
            for material_id in created_ids:
                row = await _fetch_material(db, material_id, current_user.tenant_id)
                if row:
                    loaded.append(row)
            created = loaded
        except HTTPException:
            await db.rollback()
            raise
        except Exception:
            await db.rollback()
            raise

    for material in created:
        schedule_material_index(background_tasks, material.id, current_user.tenant_id)

    scope = "FULL_BOOK" if is_full_book else "CHAPTER"
    return {
        "count": len(created),
        "materials": [{**_material(m), "scope": scope} for m in created],
    }


@router.post("/upload")
async def upload_material(
    request: Request,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(require_permission("material:upload")),
):
    form = await request.form()
    file = form.get("file")
    if not isinstance(file, StarletteUploadFile):
        raise HTTPException(status_code=400, detail='No file uploaded. Use field name "file".')

    title = form.get("title")
    material_type = "NCERT"
    academic_class_id = form.get("academicClassId") or form.get("academic_class_id")
    subject_id = form.get("subjectId") or form.get("subject_id")
    chapter_id = form.get("chapterId") or form.get("chapter_id")
    topic_id = form.get("topicId") or form.get("topic_id")
    academic_session = form.get("academicSession") or form.get("academic_session") or "2025-26"
    batch_id_raw = str(form.get("batchId") or form.get("batch_id") or "").strip() or None
    full_book = form.get("fullBook") or form.get("full_book")

    academic_class_id = str(academic_class_id).strip() if academic_class_id else ""
    subject_id = str(subject_id).strip() if subject_id else ""

    if not academic_class_id:
        raise HTTPException(
            status_code=400,
            detail="Class is required. Select a class or add a title and retag the document after upload.",
        )
    if not subject_id:
        raise HTTPException(status_code=400, detail="Subject is required for the selected class.")

    file_name = file.filename or "upload.pdf"
    mime_type = _normalize_mime(file_name, file.content_type or "application/octet-stream")
    _validate_upload_file(file_name, mime_type)

    is_full_book = str(full_book or "").lower() in ("true", "1")

    try:
        file_url, file_size = await save_material_upload_file(
            current_user.tenant_id, file_name, file
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if file_size <= 0:
        raise HTTPException(status_code=400, detail='No file uploaded. Use field name "file".')

    title_str = _resolve_upload_title(title, file_name, has_class=True)

    async with AsyncSessionLocal() as db:
        try:
            batch_id = await _resolve_optional_batch_id(
                db,
                tenant_id=current_user.tenant_id,
                batch_id=batch_id_raw,
                academic_class_id=academic_class_id,
                academic_session=str(academic_session),
            )
            class_subjects = await _subjects_for_class(db, academic_class_id)
            effective_subject_id = resolve_upload_subject_id(
                file_name, title_str, class_subjects, subject_id
            ) or subject_id
            resolved = await _resolve_upload_target(
                db,
                academic_class_id=academic_class_id,
                subject_id=effective_subject_id,
                chapter_id=str(chapter_id) if chapter_id else None,
                is_full_book=is_full_book,
                material_title=title_str if is_full_book else None,
            )
            if topic_id:
                resolved = {**resolved, "topic_id": str(topic_id)}

            material = await _create_material_from_upload(
                db,
                tenant_id=current_user.tenant_id,
                user_id=current_user.id,
                resolved=resolved,
                file_name=file_name,
                file_url=file_url,
                file_size=file_size,
                mime_type=mime_type,
                title=title_str,
                material_type=str(material_type),
                academic_session=str(academic_session),
                is_full_book=is_full_book,
                topic_id=str(topic_id) if topic_id else None,
                batch_id=batch_id,
            )
            await db.commit()
            loaded = await _fetch_material(db, material.id, current_user.tenant_id)
            if loaded:
                material = loaded
        except Exception:
            await db.rollback()
            raise

    payload = {**_material(material), "scope": "FULL_BOOK" if is_full_book else "CHAPTER"}
    schedule_material_index(background_tasks, material.id, current_user.tenant_id)
    return payload


@router.patch("/{material_id}")
async def update_material(
    material_id: str,
    body: MaterialUpdateBody,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("material:upload")),
):
    """Update title and/or class & subject (retag) for an uploaded document."""
    material = await _fetch_material(db, material_id, current_user.tenant_id)
    if not material:
        raise HTTPException(status_code=404, detail="Material not found")

    if body.title is not None and not body.title.strip():
        raise HTTPException(status_code=400, detail="Title cannot be empty.")

    next_class_id = (
        str(body.academic_class_id).strip()
        if body.academic_class_id is not None
        else material.academic_class_id
    )
    next_subject_id = (
        str(body.subject_id).strip() if body.subject_id is not None else material.subject_id
    )
    next_title = body.title.strip() if body.title is not None else material.title

    if not next_class_id and not (next_title or "").strip():
        raise HTTPException(status_code=400, detail="Provide a title or select a class.")

    retag = (
        body.academic_class_id is not None
        or body.subject_id is not None
    )
    if retag:
        if not next_class_id or not next_subject_id:
            raise HTTPException(
                status_code=400,
                detail="Class and subject are both required when moving a document.",
            )
        resolved = await _resolve_subject_meta(db, next_class_id, next_subject_id)
        material.academic_class_id = resolved["academic_class_id"]
        material.subject_id = resolved["subject_id"]
        material.book_id = resolved["book_id"]
        if material.is_full_book:
            material.chapter_id = None
            material.topic_id = None

    if body.title is not None:
        material.title = next_title

    now = datetime.now(timezone.utc)
    material.updated_at = now

    if retag or body.title is not None:
        material.status = "INDEXING"
        material.error_message = None

    await db.flush()
    if retag or body.title is not None:
        schedule_material_index(background_tasks, material.id, current_user.tenant_id)

    loaded = await _fetch_material(db, material.id, current_user.tenant_id)
    if not loaded:
        raise HTTPException(status_code=404, detail="Material not found")
    return _material(loaded)


@router.post("/reconcile-subjects")
async def reconcile_material_subjects(
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("material:upload")),
):
    """Fix subject tags from file/title hints (e.g. bulk upload with one subject selected)."""
    result = await db.execute(
        select(StudyMaterial).where(StudyMaterial.tenant_id == current_user.tenant_id)
    )
    materials = result.scalars().all()
    updated = 0
    reindex_ids: list[str] = []
    now = datetime.now(timezone.utc)
    for material in materials:
        if not material.academic_class_id:
            continue
        subjects = await _subjects_for_class(db, material.academic_class_id)
        guessed = resolve_upload_subject_id(
            material.file_name,
            material.title,
            subjects,
            material.subject_id,
        )
        if not guessed or guessed == material.subject_id:
            continue
        resolved = await _resolve_subject_meta(db, material.academic_class_id, guessed)
        material.subject_id = resolved["subject_id"]
        material.book_id = resolved["book_id"]
        material.updated_at = now
        reindex_ids.append(material.id)
        updated += 1

    await db.flush()
    repaired = 0
    for material in materials:
        if material.is_full_book and material.status == "READY":
            if await repair_full_book_syllabus_if_empty(db, material):
                repaired += 1
    if repaired:
        await db.flush()
    for material_id in reindex_ids:
        schedule_material_index(background_tasks, material_id, current_user.tenant_id)
    return {"updated": updated, "syllabusRepaired": repaired}


@router.get("/{material_id}/file")
async def get_material_file(
    material_id: str,
    download: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(StudyMaterial).where(
            StudyMaterial.id == material_id,
            StudyMaterial.tenant_id == current_user.tenant_id,
        )
    )
    material = result.scalar_one_or_none()
    if not material:
        raise HTTPException(status_code=404, detail="Material not found")

    try:
        content = read_material_file(material.file_url)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="File not found on server.") from exc

    disposition = "attachment" if download == "1" else "inline"
    safe_name = re.sub(r"[^\w.\-() ]", "_", material.file_name)
    return Response(
        content=content,
        media_type=material.mime_type or "application/octet-stream",
        headers={"Content-Disposition": f'{disposition}; filename="{safe_name}"'},
    )


@router.get("/{material_id}/chapters")
async def list_material_chapters(
    material_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Chapters extracted for this uploaded book (scoped by material → book_id)."""
    material = await _fetch_material(db, material_id, current_user.tenant_id)
    if not material:
        raise HTTPException(status_code=404, detail="Material not found")
    if not material.book_id:
        return {"materialId": material_id, "chapters": [], "extractionFailed": False}

    if material.is_full_book and material.status == "READY":
        synced = await resync_syllabus_from_material_file(db, material)
        if synced:
            await db.commit()

    chapters_result = await db.execute(
        select(Chapter)
        .where(Chapter.book_id == material.book_id)
        .options(selectinload(Chapter.topics))
        .order_by(Chapter.order_index, Chapter.number)
    )
    chapters = chapters_result.scalars().all()
    extraction_failed = bool(
        material.is_full_book
        and material.error_message
        and material.error_message.startswith("SYLLABUS_EXTRACTION_FAILED")
    )
    return {
        "materialId": material_id,
        "bookId": material.book_id,
        "extractionFailed": extraction_failed,
        "chapters": [
            {
                "id": ch.id,
                "chapterNumber": ch.number,
                "title": ch.title,
                "topics": [
                    {"id": t.id, "title": t.title}
                    for t in sorted(ch.topics, key=lambda x: x.order_index)
                ],
            }
            for ch in chapters
        ],
    }


@router.post("/{material_id}/reindex")
async def reindex_material(
    material_id: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Queue PDF/text extraction and chunk indexing (runs in background)."""
    result = await db.execute(
        select(StudyMaterial).where(
            StudyMaterial.id == material_id,
            StudyMaterial.tenant_id == current_user.tenant_id,
        )
    )
    material = result.scalar_one_or_none()
    if not material:
        raise HTTPException(status_code=404, detail="Material not found")

    await prepare_material_reindex(material_id)

    now = datetime.now(timezone.utc)
    material.status = "INDEXING"
    material.error_message = None
    material.updated_at = now
    await db.flush()
    schedule_material_index(
        background_tasks,
        material.id,
        current_user.tenant_id,
        force=True,
    )
    return _material(material)


@router.delete("/all")
async def delete_all_materials(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("material:delete")),
):
    """Remove every study material for this tenant (elevated admins only)."""
    from sqlalchemy.exc import DBAPIError

    if not await _user_can_purge_all_materials(db, current_user):
        raise HTTPException(
            status_code=403,
            detail="Only institute admins can delete all documents.",
        )

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(StudyMaterial.id).where(StudyMaterial.tenant_id == current_user.tenant_id)
        )
        material_ids = [str(row[0]) for row in result.all()]

    if not material_ids:
        return {"deleted": 0, "ids": [], "failed": []}

    for material_id in material_ids:
        request_material_index_cancel(material_id)
    await wait_for_material_index_idle(material_ids, timeout_sec=30.0)

    deleted_ids: list[str] = []
    file_urls: list[str] = []
    failed_ids: list[str] = []

    for material_id in material_ids:
        purged = False
        for attempt in range(5):
            try:
                file_url = await _purge_material_from_db(material_id, current_user.tenant_id)
                file_urls.append(file_url)
                deleted_ids.append(material_id)
                purged = True
                break
            except HTTPException as exc:
                if exc.status_code == 404:
                    purged = True
                    break
                raise
            except DBAPIError as exc:
                message = str(exc).lower()
                if (
                    attempt < 4
                    and ("lock timeout" in message or "canceling statement" in message)
                ):
                    await wait_for_material_index_idle([material_id], timeout_sec=8.0)
                    await asyncio.sleep(0.4 * (attempt + 1))
                    continue
                failed_ids.append(material_id)
                break
            except Exception:
                failed_ids.append(material_id)
                break
        if not purged and material_id not in failed_ids:
            failed_ids.append(material_id)

    for file_url in file_urls:
        delete_material_file(file_url)

    if failed_ids and not deleted_ids:
        raise HTTPException(
            status_code=409,
            detail="Could not delete documents yet. Wait a few seconds and try again.",
        )

    return {"deleted": len(deleted_ids), "ids": deleted_ids, "failed": failed_ids}


@router.delete("/{material_id}")
async def delete_material(
    material_id: str,
    current_user: User = Depends(require_permission("material:delete")),
):
    from sqlalchemy.exc import DBAPIError

    await wait_for_material_index_idle([material_id], timeout_sec=15.0)
    try:
        file_url = await _purge_material_from_db(material_id, current_user.tenant_id)
    except DBAPIError as exc:
        message = str(exc).lower()
        if "lock timeout" in message or "canceling statement" in message:
            raise HTTPException(
                status_code=409,
                detail="Document is still indexing. Wait a few seconds and try delete again.",
            ) from exc
        raise HTTPException(status_code=500, detail=f"Delete failed: {exc}") from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Delete failed: {exc}") from exc

    delete_material_file(file_url)
    return {"deleted": True, "id": material_id}
