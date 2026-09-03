import re
import uuid
from datetime import datetime, timezone

from starlette.datastructures import UploadFile as StarletteUploadFile

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.curriculum import Book, Chapter, Subject
from app.models.material import StudyMaterial
from app.models.user import User
from app.services.material_storage import delete_material_file, read_material_file, save_material_file

router = APIRouter(prefix="/materials", tags=["Materials"])

MAX_UPLOAD_BYTES = 100 * 1024 * 1024
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
        "chapter": (
            {"title": m.chapter.title, "number": m.chapter.number}
            if m.chapter
            else None
        ),
        "topic": {"title": m.topic.title} if m.topic else None,
    }


async def _resolve_subject_meta(db: AsyncSession, academic_class_id: str, subject_id: str) -> dict:
    result = await db.execute(
        select(Subject)
        .where(Subject.id == subject_id)
        .options(selectinload(Subject.books))
    )
    subject = result.scalar_one_or_none()
    if not subject or subject.academic_class_id != academic_class_id:
        raise HTTPException(status_code=400, detail="Invalid subject for selected class")
    book_id = sorted(subject.books, key=lambda b: b.order_index)[0].id if subject.books else None
    return {
        "academic_class_id": academic_class_id,
        "subject_id": subject_id,
        "book_id": book_id,
        "chapter_id": None,
        "topic_id": None,
    }


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


@router.post("/upload")
async def upload_material(
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    form = await request.form()
    file = form.get("file")
    if not isinstance(file, StarletteUploadFile):
        raise HTTPException(status_code=400, detail='No file uploaded. Use field name "file".')

    title = form.get("title")
    material_type = form.get("type") or "NCERT"
    academic_class_id = form.get("academicClassId") or form.get("academic_class_id")
    subject_id = form.get("subjectId") or form.get("subject_id")
    chapter_id = form.get("chapterId") or form.get("chapter_id")
    topic_id = form.get("topicId") or form.get("topic_id")
    academic_session = form.get("academicSession") or form.get("academic_session") or "2025-26"
    full_book = form.get("fullBook") or form.get("full_book")

    academic_class_id = str(academic_class_id).strip() if academic_class_id else ""
    subject_id = str(subject_id).strip() if subject_id else ""

    if not academic_class_id or not subject_id:
        raise HTTPException(status_code=400, detail="Class and Subject are required.")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail='No file uploaded. Use field name "file".')
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail="File exceeds 100 MB limit.")

    file_name = file.filename or "upload.pdf"
    mime_type = file.content_type or "application/octet-stream"
    if mime_type not in ALLOWED_MIMES and not file_name.lower().endswith((".pdf", ".txt", ".md")):
        raise HTTPException(status_code=400, detail="Only PDF, TXT, and MD files are allowed.")
    if mime_type == "application/octet-stream" and file_name.lower().endswith(".pdf"):
        mime_type = "application/pdf"

    is_full_book = str(full_book or "").lower() in ("true", "1")
    if is_full_book or not chapter_id:
        resolved = await _resolve_subject_meta(db, str(academic_class_id), str(subject_id))
    else:
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
        resolved = {
            "academic_class_id": str(academic_class_id),
            "subject_id": str(subject_id),
            "book_id": chapter.book_id,
            "chapter_id": str(chapter_id),
            "topic_id": str(topic_id) if topic_id else None,
        }

    file_url = save_material_file(current_user.tenant_id, file_name, content, mime_type)
    now = datetime.now(timezone.utc)
    material = StudyMaterial(
        id=str(uuid.uuid4()),
        tenant_id=current_user.tenant_id,
        title=(str(title).strip() if title else file_name),
        type=str(material_type),
        academic_class_id=resolved["academic_class_id"],
        subject_id=resolved["subject_id"],
        book_id=resolved["book_id"],
        chapter_id=resolved["chapter_id"],
        topic_id=resolved["topic_id"],
        is_full_book=is_full_book,
        academic_session=str(academic_session),
        uploaded_by_id=current_user.id,
        file_name=file_name,
        file_url=file_url,
        file_size=len(content),
        mime_type=mime_type,
        status="READY",
        chunk_count=0,
        created_at=now,
        updated_at=now,
    )
    db.add(material)
    await db.flush()
    await db.refresh(material, ["academic_class", "subject", "chapter", "topic"])
    payload = _material(material)
    payload["scope"] = "FULL_BOOK" if is_full_book else "CHAPTER"
    return payload


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


@router.post("/{material_id}/reindex")
async def reindex_material(
    material_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Re-index a material. Full RAG indexing requires the NestJS API; FastAPI marks it ready."""
    result = await db.execute(
        select(StudyMaterial).where(
            StudyMaterial.id == material_id,
            StudyMaterial.tenant_id == current_user.tenant_id,
        )
    )
    material = result.scalar_one_or_none()
    if not material:
        raise HTTPException(status_code=404, detail="Material not found")

    now = datetime.now(timezone.utc)
    material.status = "READY"
    material.error_message = None
    material.updated_at = now
    await db.flush()
    return _material(material)


@router.delete("/{material_id}")
async def delete_material(
    material_id: str,
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

    delete_material_file(material.file_url)
    await db.delete(material)
    return {"deleted": True}
