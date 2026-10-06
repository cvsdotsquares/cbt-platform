import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import delete, func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.feature_flags import SYLLABUS_MARK_PROGRESS_ENABLED
from app.core.security import get_current_user
from app.models.curriculum import (
    AcademicClass,
    Batch,
    BatchEnrollment,
    Book,
    Chapter,
    Subject,
    SyllabusProgress,
    SyllabusTopic,
    TeacherAssignment,
)
from app.models.material import StudyMaterial
from app.models.user import User
from app.services.roll_numbers import sync_batch_roll_numbers
from app.services.teacher_scope import (
    get_teacher_batch_ids,
    get_teacher_subject_ids,
    is_teacher_scoped,
)

router = APIRouter(prefix="/batches", tags=["Batches"])


class BatchCreate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    academic_class_id: str = Field(..., alias="academicClassId")
    name: str
    academic_year: str = Field(..., alias="academicYear")


class BatchUpdate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    academic_class_id: str | None = Field(None, alias="academicClassId")
    name: str | None = None
    academic_year: str | None = Field(None, alias="academicYear")
    is_active: bool | None = Field(None, alias="isActive")


class EnrollBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    candidate_id: str = Field(..., alias="candidateId")
    roll_number: str | None = Field(None, alias="rollNumber")


class AssignTeacherBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    user_id: str = Field(..., alias="userId")
    subject_id: str | None = Field(None, alias="subjectId")
    subject_ids: list[str] | None = Field(None, alias="subjectIds")


class SyllabusProgressUpdate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    chapter_id: str | None = Field(None, alias="chapterId")
    topic_id: str | None = Field(None, alias="topicId")
    status: str


def _normalize_batch_fields(
    name: str | None,
    academic_year: str | None,
    academic_class_id: str | None,
) -> tuple[str, str, str]:
    clean_name = (name or "").strip()
    clean_year = (academic_year or "").strip()
    if not clean_name:
        raise HTTPException(status_code=400, detail="Batch name is required")
    if not clean_year:
        raise HTTPException(status_code=400, detail="Academic year is required")
    if not academic_class_id:
        raise HTTPException(status_code=400, detail="Class is required")
    return clean_name, clean_year, academic_class_id


async def _assert_batch_unique(
    db: AsyncSession,
    tenant_id: str,
    name: str,
    academic_year: str,
    academic_class_id: str,
    exclude_id: str | None = None,
) -> None:
    stmt = select(Batch, AcademicClass.level).join(
        AcademicClass, Batch.academic_class_id == AcademicClass.id
    ).where(
        Batch.tenant_id == tenant_id,
        Batch.name == name,
        Batch.academic_year == academic_year,
        Batch.academic_class_id == academic_class_id,
    )
    if exclude_id:
        stmt = stmt.where(Batch.id != exclude_id)

    result = await db.execute(stmt)
    row = result.first()
    if row:
        _, level = row
        raise HTTPException(
            status_code=409,
            detail=(
                f'A batch named "{name}" already exists for Class {level} '
                f"in {academic_year}"
            ),
        )


async def _get_batch_or_404(db: AsyncSession, batch_id: str, tenant_id: str) -> Batch:
    result = await db.execute(
        select(Batch)
        .where(Batch.id == batch_id, Batch.tenant_id == tenant_id)
        .options(
            selectinload(Batch.academic_class).selectinload(AcademicClass.subjects),
            selectinload(Batch.enrollments),
        )
    )
    batch = result.scalar_one_or_none()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    return batch


def _batch(
    b: Batch,
    enrollment_count: int,
    *,
    assignment_user_id: str | None = None,
) -> dict:
    cls = b.academic_class
    payload: dict = {
        "id": b.id,
        "name": b.name,
        "academicYear": b.academic_year,
        "isActive": b.is_active,
        "academicClassId": b.academic_class_id,
        "academicClass": {
            "id": cls.id,
            "name": cls.name,
            "level": cls.level,
        },
        "_count": {"enrollments": enrollment_count},
    }
    if assignment_user_id is not None:
        payload["teacherAssignments"] = [
            {
                "subject": {
                    "id": a.subject.id,
                    "name": a.subject.name,
                    "code": a.subject.code,
                },
            }
            for a in b.teacher_assignments
            if str(a.user_id) == assignment_user_id and a.subject is not None
        ]
    return payload


def _batch_detail(batch: Batch, enrollments: list[dict]) -> dict:
    cls = batch.academic_class
    return {
        "id": batch.id,
        "name": batch.name,
        "academicYear": batch.academic_year,
        "isActive": batch.is_active,
        "academicClassId": batch.academic_class_id,
        "academicClass": {
            "id": cls.id,
            "name": cls.name,
            "level": cls.level,
            "subjects": [
                {"id": s.id, "name": s.name, "code": s.code}
                for s in sorted(cls.subjects, key=lambda x: x.order_index)
            ],
        },
        "enrollments": enrollments,
    }


@router.get("")
async def list_batches(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    teacher_scoped = is_teacher_scoped(current_user)
    teacher_batch_ids: list[str] | None = None
    if teacher_scoped:
        teacher_batch_ids = await get_teacher_batch_ids(db, str(current_user.id))
        if not teacher_batch_ids:
            return []

    enrollment_counts = (
        select(
            BatchEnrollment.batch_id,
            func.count(BatchEnrollment.id).label("count"),
        )
        .group_by(BatchEnrollment.batch_id)
        .subquery()
    )

    load_opts = [selectinload(Batch.academic_class)]
    assignment_user_id: str | None = None
    if teacher_scoped:
        assignment_user_id = str(current_user.id)
        load_opts.append(
            selectinload(Batch.teacher_assignments).selectinload(TeacherAssignment.subject)
        )

    stmt = (
        select(Batch, func.coalesce(enrollment_counts.c.count, 0))
        .outerjoin(enrollment_counts, Batch.id == enrollment_counts.c.batch_id)
        .where(Batch.tenant_id == current_user.tenant_id)
        .order_by(Batch.created_at.desc())
        .options(*load_opts)
    )
    if teacher_batch_ids is not None:
        stmt = stmt.where(Batch.id.in_(teacher_batch_ids))

    result = await db.execute(stmt)
    return [
        _batch(batch, int(count), assignment_user_id=assignment_user_id)
        for batch, count in result.all()
    ]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_batch(
    body: BatchCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    name, academic_year, academic_class_id = _normalize_batch_fields(
        body.name, body.academic_year, body.academic_class_id
    )

    cls_result = await db.execute(
        select(AcademicClass).where(AcademicClass.id == academic_class_id)
    )
    if cls_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=400, detail="Invalid class")

    await _assert_batch_unique(
        db, current_user.tenant_id, name, academic_year, academic_class_id
    )

    now = datetime.now(timezone.utc)
    batch = Batch(
        id=str(uuid.uuid4()),
        tenant_id=current_user.tenant_id,
        academic_class_id=academic_class_id,
        name=name,
        academic_year=academic_year,
        is_active=True,
        created_at=now,
        updated_at=now,
    )
    db.add(batch)

    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=409,
            detail="A batch with this name already exists for this class and academic year",
        )

    await db.refresh(batch, attribute_names=["academic_class"])
    return _batch(batch, 0)


@router.get("/teacher-assignments")
async def list_teacher_assignments_by_user(
    user_id: str | None = Query(None, alias="userId"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    stmt = (
        select(TeacherAssignment)
        .join(Batch, TeacherAssignment.batch_id == Batch.id)
        .where(Batch.tenant_id == current_user.tenant_id)
        .options(
            selectinload(TeacherAssignment.subject),
            selectinload(TeacherAssignment.batch).selectinload(Batch.academic_class),
        )
        .order_by(TeacherAssignment.assigned_at.desc())
    )
    if user_id:
        stmt = stmt.where(TeacherAssignment.user_id == user_id)

    assignments = (await db.execute(stmt)).scalars().all()
    if not assignments:
        return []

    user_ids = list({a.user_id for a in assignments})
    users_result = await db.execute(
        select(User.id, User.first_name, User.last_name, User.email).where(
            User.id.in_(user_ids),
            User.tenant_id == current_user.tenant_id,
        )
    )
    user_map = {
        row.id: {
            "id": row.id,
            "firstName": row.first_name or "",
            "lastName": row.last_name or "",
            "email": row.email,
        }
        for row in users_result.all()
    }

    return [
        {
            "id": a.id,
            "userId": a.user_id,
            "batchId": a.batch_id,
            "subjectId": a.subject_id,
            "subject": {"id": a.subject.id, "name": a.subject.name, "code": a.subject.code},
            "batch": {
                "id": a.batch.id,
                "name": a.batch.name,
                "academicYear": a.batch.academic_year,
                "academicClass": {
                    "id": a.batch.academic_class.id,
                    "name": a.batch.academic_class.name,
                    "level": a.batch.academic_class.level,
                },
            },
            "user": user_map.get(a.user_id),
        }
        for a in assignments
    ]


@router.get("/{batch_id}")
async def get_batch(
    batch_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    batch = await _get_batch_or_404(db, batch_id, current_user.tenant_id)

    enrollment_rows = await db.execute(
        text(
            """
            SELECT be.id, be.roll_number, c.id AS candidate_id, c.registration_number,
                   u.first_name, u.last_name, u.email
            FROM batch_enrollments be
            JOIN candidates c ON c.id = be.candidate_id
            JOIN users u ON u.id = c.user_id
            WHERE be.batch_id = :batch_id
            ORDER BY
                CASE
                    WHEN be.roll_number ~ '^[0-9]+$' THEN CAST(be.roll_number AS integer)
                    ELSE 2147483647
                END,
                LOWER(u.first_name),
                LOWER(u.last_name)
            """
        ),
        {"batch_id": batch_id},
    )

    enrollments = [
        {
            "id": row.id,
            "rollNumber": row.roll_number,
            "candidate": {
                "id": row.candidate_id,
                "registrationNumber": row.registration_number,
                "user": {
                    "firstName": row.first_name or "",
                    "lastName": row.last_name or "",
                    "email": row.email,
                },
            },
        }
        for row in enrollment_rows.mappings()
    ]
    return _batch_detail(batch, enrollments)


@router.get("/{batch_id}/teachers")
async def list_batch_teachers(
    batch_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _get_batch_or_404(db, batch_id, current_user.tenant_id)

    assignments_result = await db.execute(
        select(TeacherAssignment)
        .where(TeacherAssignment.batch_id == batch_id)
        .options(selectinload(TeacherAssignment.subject))
        .order_by(TeacherAssignment.assigned_at.desc())
    )
    assignments = assignments_result.scalars().all()
    if not assignments:
        return []

    user_ids = list({a.user_id for a in assignments})
    users_result = await db.execute(
        select(User.id, User.first_name, User.last_name, User.email).where(
            User.id.in_(user_ids),
            User.tenant_id == current_user.tenant_id,
        )
    )
    user_map = {
        row.id: {
            "id": row.id,
            "firstName": row.first_name or "",
            "lastName": row.last_name or "",
            "email": row.email,
        }
        for row in users_result.all()
    }

    return [
        {
            "id": a.id,
            "userId": a.user_id,
            "batchId": a.batch_id,
            "subjectId": a.subject_id,
            "subject": {"id": a.subject.id, "name": a.subject.name, "code": a.subject.code},
            "user": user_map.get(a.user_id),
        }
        for a in assignments
    ]


@router.patch("/{batch_id}")
async def update_batch(
    batch_id: str,
    body: BatchUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    batch = await _get_batch_or_404(db, batch_id, current_user.tenant_id)

    name, academic_year, academic_class_id = _normalize_batch_fields(
        body.name if body.name is not None else batch.name,
        body.academic_year if body.academic_year is not None else batch.academic_year,
        body.academic_class_id if body.academic_class_id is not None else batch.academic_class_id,
    )

    if body.academic_class_id and body.academic_class_id != batch.academic_class_id:
        cls_result = await db.execute(
            select(AcademicClass).where(AcademicClass.id == academic_class_id)
        )
        if cls_result.scalar_one_or_none() is None:
            raise HTTPException(status_code=400, detail="Invalid class")

    await _assert_batch_unique(
        db,
        current_user.tenant_id,
        name,
        academic_year,
        academic_class_id,
        exclude_id=batch_id,
    )

    batch.name = name
    batch.academic_year = academic_year
    batch.academic_class_id = academic_class_id
    if body.is_active is not None:
        batch.is_active = body.is_active
    batch.updated_at = datetime.now(timezone.utc)

    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=409,
            detail="A batch with this name already exists for this class and academic year",
        )

    await db.refresh(batch, attribute_names=["academic_class"])
    enrollment_count = len(batch.enrollments or [])
    return _batch(batch, enrollment_count)


@router.delete("/{batch_id}")
async def delete_batch(
    batch_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    batch = await _get_batch_or_404(db, batch_id, current_user.tenant_id)
    enrollment_count = len(batch.enrollments or [])
    class_name = batch.academic_class.name if batch.academic_class else ""
    batch_name = batch.name
    batch_uuid = batch.id

    await db.delete(batch)
    await db.flush()

    return {
        "deleted": True,
        "id": batch_uuid,
        "name": batch_name,
        "className": class_name,
        "studentsUnassigned": enrollment_count,
    }


@router.get("/{batch_id}/next-roll-number")
async def next_roll_number(
    batch_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _get_batch_or_404(db, batch_id, current_user.tenant_id)
    rows = await db.execute(
        text("SELECT roll_number FROM batch_enrollments WHERE batch_id = :batch_id"),
        {"batch_id": batch_id},
    )
    used = {int(raw) for (raw,) in rows.all() if raw and str(raw).strip().isdigit()}
    number = 1
    while number in used:
        number += 1
    return {"rollNumber": str(number)}


@router.post("/{batch_id}/enroll", status_code=status.HTTP_201_CREATED)
async def enroll_student(
    batch_id: str,
    body: EnrollBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _get_batch_or_404(db, batch_id, current_user.tenant_id)

    candidate_result = await db.execute(
        text(
            """
            SELECT id FROM candidates
            WHERE id = :candidate_id AND tenant_id = :tenant_id
            """
        ),
        {
            "candidate_id": body.candidate_id,
            "tenant_id": str(current_user.tenant_id),
        },
    )
    if candidate_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Candidate not found")

    roll = body.roll_number.strip() if body.roll_number else None
    now = datetime.now(timezone.utc)

    existing_result = await db.execute(
        select(BatchEnrollment).where(
            BatchEnrollment.batch_id == batch_id,
            BatchEnrollment.candidate_id == body.candidate_id,
        )
    )
    existing = existing_result.scalar_one_or_none()
    previous_batches = await db.execute(
        text(
            """
            SELECT DISTINCT batch_id
            FROM batch_enrollments
            WHERE candidate_id = :candidate_id AND batch_id <> :batch_id
            """
        ),
        {"candidate_id": body.candidate_id, "batch_id": batch_id},
    )
    previous_batch_ids = [str(row) for row in previous_batches.scalars()]

    if existing:
        enrollment = existing
    else:
        await db.execute(
            delete(BatchEnrollment).where(
                BatchEnrollment.candidate_id == body.candidate_id
            )
        )
        enrollment = BatchEnrollment(
            id=str(uuid.uuid4()),
            batch_id=batch_id,
            candidate_id=body.candidate_id,
            enrolled_at=now,
        )
        db.add(enrollment)

    enrollment.roll_locked = bool(roll)
    enrollment.roll_number = roll
    await db.flush()
    planned = await sync_batch_roll_numbers(db, batch_id)
    for previous_batch_id in previous_batch_ids:
        await sync_batch_roll_numbers(db, previous_batch_id)

    return {
        "id": enrollment.id,
        "batchId": enrollment.batch_id,
        "candidateId": enrollment.candidate_id,
        "rollNumber": planned.get(enrollment.id, enrollment.roll_number),
    }


@router.post("/{batch_id}/teachers", status_code=status.HTTP_201_CREATED)
async def assign_teacher(
    batch_id: str,
    body: AssignTeacherBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    batch = await _get_batch_or_404(db, batch_id, current_user.tenant_id)
    class_subject_ids = {s.id for s in batch.academic_class.subjects}

    subject_ids = body.subject_ids or []
    if body.subject_id:
        subject_ids = [body.subject_id, *subject_ids]
    subject_ids = list(dict.fromkeys(sid.strip() for sid in subject_ids if sid and sid.strip()))

    if not subject_ids:
        raise HTTPException(status_code=400, detail="At least one subject is required")

    for subject_id in subject_ids:
        if subject_id not in class_subject_ids:
            raise HTTPException(
                status_code=400,
                detail="Subject does not belong to this batch class",
            )

    user_result = await db.execute(
        select(User).where(
            User.id == body.user_id,
            User.tenant_id == current_user.tenant_id,
        )
    )
    if user_result.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Teacher user not found")

    now = datetime.now(timezone.utc)
    assignments: list[dict] = []

    for subject_id in subject_ids:
        existing_result = await db.execute(
            select(TeacherAssignment).where(
                TeacherAssignment.user_id == body.user_id,
                TeacherAssignment.batch_id == batch_id,
                TeacherAssignment.subject_id == subject_id,
            )
        )
        existing = existing_result.scalar_one_or_none()
        if existing:
            await db.refresh(existing, attribute_names=["subject"])
            assignment = existing
        else:
            assignment = TeacherAssignment(
                id=str(uuid.uuid4()),
                user_id=body.user_id,
                batch_id=batch_id,
                subject_id=subject_id,
                assigned_at=now,
            )
            db.add(assignment)
            await db.flush()
            await db.refresh(assignment, attribute_names=["subject"])

        assignments.append(
            {
                "id": assignment.id,
                "userId": assignment.user_id,
                "subjectId": assignment.subject_id,
                "subject": {
                    "id": assignment.subject.id,
                    "name": assignment.subject.name,
                    "code": assignment.subject.code,
                },
            }
        )

    return {"count": len(assignments), "assignments": assignments}


@router.delete("/{batch_id}/teachers/{assignment_id}", status_code=status.HTTP_200_OK)
async def remove_teacher(
    batch_id: str,
    assignment_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await _get_batch_or_404(db, batch_id, current_user.tenant_id)

    result = await db.execute(
        select(TeacherAssignment).where(
            TeacherAssignment.id == assignment_id,
            TeacherAssignment.batch_id == batch_id,
        )
    )
    assignment = result.scalar_one_or_none()
    if assignment is None:
        raise HTTPException(status_code=404, detail="Teacher assignment not found")

    await db.delete(assignment)
    await db.flush()
    return {"deleted": True}


async def _uploaded_chapter_ids(
    db: AsyncSession,
    tenant_id: str,
    class_level: int,
    subject_id: str | None,
) -> set[str]:
    params: dict[str, object] = {
        "tenant_id": str(tenant_id),
        "class_level": class_level,
    }
    subject_clause = ""
    if subject_id:
        params["subject_id"] = str(subject_id)
        subject_clause = """
          AND (
            sm.subject_id::text = :subject_id
            OR b.subject_id::text = :subject_id
          )
        """

    result = await db.execute(
        text(
            f"""
            SELECT sm.chapter_id, sm.book_id, sm.is_full_book, sm.id
            FROM study_materials sm
            LEFT JOIN books b ON b.id::text = sm.book_id::text
            LEFT JOIN subjects s ON s.id::text = COALESCE(sm.subject_id::text, b.subject_id::text)
            LEFT JOIN academic_classes ac
              ON ac.id::text = COALESCE(sm.academic_class_id::text, s.academic_class_id::text)
            WHERE sm.tenant_id::text = :tenant_id
              AND sm.status IN ('READY', 'INDEXING', 'PENDING')
              AND ac.level = :class_level
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

    return ids


async def _batch_marked_chapter_ids(
    db: AsyncSession,
    batch_id: str,
    class_level: int,
    subject_id: str | None,
) -> set[str]:
    """Chapters the teacher already marked on this batch (keep visible even if upload filter changes)."""
    stmt = (
        select(Chapter.id)
        .join(SyllabusProgress, SyllabusProgress.chapter_id == Chapter.id)
        .join(Book, Chapter.book_id == Book.id)
        .join(Subject, Book.subject_id == Subject.id)
        .join(AcademicClass, Subject.academic_class_id == AcademicClass.id)
        .where(
            SyllabusProgress.batch_id == batch_id,
            SyllabusProgress.chapter_id.isnot(None),
            SyllabusProgress.topic_id.is_(None),
            AcademicClass.level == class_level,
        )
    )
    if subject_id:
        stmt = stmt.where(Subject.id == subject_id)
    rows = await db.execute(stmt)
    return {str(row[0]) for row in rows.all()}


async def _subject_id_for_progress_target(
    db: AsyncSession,
    chapter_id: str | None,
    topic_id: str | None,
) -> str | None:
    if chapter_id:
        result = await db.execute(
            select(Book.subject_id)
            .join(Chapter, Chapter.book_id == Book.id)
            .where(Chapter.id == chapter_id)
        )
        value = result.scalar_one_or_none()
        return str(value) if value else None
    if topic_id:
        result = await db.execute(
            select(Book.subject_id)
            .join(Chapter, Chapter.book_id == Book.id)
            .join(SyllabusTopic, SyllabusTopic.chapter_id == Chapter.id)
            .where(SyllabusTopic.id == topic_id)
        )
        value = result.scalar_one_or_none()
        return str(value) if value else None
    return None


async def _teacher_allowed_subject_ids(
    db: AsyncSession,
    current_user: User,
    batch_id: str,
) -> set[str] | None:
    """None means the caller is not limited to assigned subjects."""
    if not is_teacher_scoped(current_user):
        return None
    return set(await get_teacher_subject_ids(db, str(current_user.id), batch_id))


@router.get("/{batch_id}/syllabus-progress")
async def get_syllabus_progress(
    batch_id: str,
    subject_id: str | None = Query(None, alias="subjectId"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    batch = await _get_batch_or_404(db, batch_id, current_user.tenant_id)
    class_level = batch.academic_class.level
    allowed_subject_ids = await _teacher_allowed_subject_ids(db, current_user, batch_id)
    if allowed_subject_ids is not None and not allowed_subject_ids:
        return []
    if (
        allowed_subject_ids is not None
        and subject_id
        and subject_id not in allowed_subject_ids
    ):
        return []

    chapter_ids = await _uploaded_chapter_ids(
        db, current_user.tenant_id, class_level, subject_id
    )
    chapter_ids |= await _batch_marked_chapter_ids(db, batch_id, class_level, subject_id)
    if not chapter_ids:
        return []

    chapters_result = await db.execute(
        select(Chapter)
        .where(Chapter.id.in_(chapter_ids))
        .options(
            selectinload(Chapter.topics),
            selectinload(Chapter.book).selectinload(Book.subject).selectinload(Subject.academic_class),
        )
        .order_by(Chapter.order_index)
    )
    chapters = [
        ch
        for ch in chapters_result.scalars().all()
        if ch.book.subject.academic_class.level == class_level
        and (not subject_id or ch.book.subject.id == subject_id)
        and (allowed_subject_ids is None or ch.book.subject.id in allowed_subject_ids)
    ]

    progress_result = await db.execute(
        select(SyllabusProgress).where(SyllabusProgress.batch_id == batch_id)
    )
    progress_map = {
        f"{p.chapter_id or ''}:{p.topic_id or ''}": p.status
        for p in progress_result.scalars().all()
    }

    by_subject: dict[str, dict] = {}
    for chapter in chapters:
        subject = chapter.book.subject
        if subject.id not in by_subject:
            by_subject[subject.id] = {
                "subject": {"id": subject.id, "name": subject.name},
                "chapters": [],
            }
        by_subject[subject.id]["chapters"].append(
            {
                "id": chapter.id,
                "number": chapter.number,
                "title": chapter.title,
                "status": progress_map.get(f"{chapter.id}:", "NOT_STARTED"),
                "topics": [
                    {
                        "id": topic.id,
                        "title": topic.title,
                        "status": progress_map.get(f":{topic.id}")
                        or progress_map.get(f"{chapter.id}:{topic.id}")
                        or "NOT_STARTED",
                    }
                    for topic in sorted(chapter.topics, key=lambda t: t.order_index)
                ],
            }
        )

    return [
        {
            "subject": entry["subject"],
            "chapters": sorted(entry["chapters"], key=lambda c: c["number"]),
        }
        for entry in by_subject.values()
        if entry["chapters"]
    ]


@router.patch("/{batch_id}/syllabus-progress")
async def update_syllabus_progress(
    batch_id: str,
    body: SyllabusProgressUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not SYLLABUS_MARK_PROGRESS_ENABLED:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Syllabus mark progress is temporarily disabled.",
        )
    await _get_batch_or_404(db, batch_id, current_user.tenant_id)
    allowed_subject_ids = await _teacher_allowed_subject_ids(db, current_user, batch_id)
    if allowed_subject_ids is not None:
        target_subject_id = await _subject_id_for_progress_target(
            db, body.chapter_id, body.topic_id
        )
        if not target_subject_id or target_subject_id not in allowed_subject_ids:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You can only mark progress for a subject assigned to you",
            )

    stmt = select(SyllabusProgress).where(SyllabusProgress.batch_id == batch_id)
    if body.chapter_id:
        stmt = stmt.where(SyllabusProgress.chapter_id == body.chapter_id)
    else:
        stmt = stmt.where(SyllabusProgress.chapter_id.is_(None))
    if body.topic_id:
        stmt = stmt.where(SyllabusProgress.topic_id == body.topic_id)
    else:
        stmt = stmt.where(SyllabusProgress.topic_id.is_(None))

    result = await db.execute(stmt)
    existing = result.scalar_one_or_none()
    now = datetime.now(timezone.utc)
    completed_at = now if body.status == "COMPLETED" else None

    if existing:
        existing.status = body.status
        existing.updated_at = now
        existing.updated_by_id = current_user.id
        existing.completed_at = completed_at
        record = existing
    else:
        record = SyllabusProgress(
            id=str(uuid.uuid4()),
            batch_id=batch_id,
            chapter_id=body.chapter_id,
            topic_id=body.topic_id,
            status=body.status,
            completed_at=completed_at,
            updated_by_id=current_user.id,
            updated_at=now,
        )
        db.add(record)

    await db.flush()
    return {
        "id": record.id,
        "batchId": record.batch_id,
        "chapterId": record.chapter_id,
        "topicId": record.topic_id,
        "status": record.status,
    }
