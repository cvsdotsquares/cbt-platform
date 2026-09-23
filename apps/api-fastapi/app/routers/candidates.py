import math
import json
import time
import uuid
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.security import get_current_user, hash_password, require_permission
from app.services.registration_invite import create_registration_invite
from app.models.role import Role
from app.models.user import User, UserStatus
from app.models.user_role import UserRole
from app.services.candidate_context import (
    CANDIDATE_VISIBLE_STATUSES,
    assert_exam_visible_to_candidate,
    require_candidate_id,
)
from app.services.teacher_scope import get_teacher_batch_ids, is_teacher_scoped
from app.services.exam_engine import reconcile_candidate_sessions
from app.models.curriculum import BatchEnrollment

router = APIRouter(prefix="/candidates", tags=["Candidates"])


@router.get("/stats")
async def candidate_stats(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tenant_id = current_user.tenant_id
    rows = await db.execute(
        text(
            """
            SELECT kyc_status, COUNT(*) AS count
            FROM candidates
            WHERE tenant_id = :tenant_id
            GROUP BY kyc_status
            """
        ),
        {"tenant_id": tenant_id},
    )
    counts = {row["kyc_status"]: int(row["count"]) for row in rows.mappings()}
    total = sum(counts.values())

    by_class_rows = await db.execute(
        text(
            """
            SELECT ac.id AS academic_class_id, ac.level, COUNT(*)::int AS count
            FROM (
              SELECT DISTINCT ON (be.candidate_id) be.candidate_id, be.batch_id
              FROM batch_enrollments be
              INNER JOIN candidates c ON c.id = be.candidate_id
              WHERE c.tenant_id = :tenant_id
              ORDER BY be.candidate_id, be.enrolled_at ASC
            ) pe
            INNER JOIN batches b ON b.id = pe.batch_id
            INNER JOIN academic_classes ac ON ac.id = b.academic_class_id
            GROUP BY ac.id, ac.level
            """
        ),
        {"tenant_id": tenant_id},
    )
    unassigned_row = await db.execute(
        text(
            """
            SELECT COUNT(*)::int AS count
            FROM candidates c
            WHERE c.tenant_id = :tenant_id
              AND NOT EXISTS (
                SELECT 1 FROM batch_enrollments be WHERE be.candidate_id = c.id
              )
            """
        ),
        {"tenant_id": tenant_id},
    )

    return {
        "total": total,
        "verified": counts.get("VERIFIED", 0),
        "pending": counts.get("PENDING", 0),
        "rejected": counts.get("REJECTED", 0),
        "unassigned": int(unassigned_row.scalar() or 0),
        "byClass": [
            {
                "academicClassId": str(r["academic_class_id"]),
                "level": int(r["level"]),
                "count": int(r["count"]),
            }
            for r in by_class_rows.mappings()
        ],
    }


@router.get("/me/dashboard")
async def my_dashboard(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    candidate_id = await require_candidate_id(db, current_user.id)
    await reconcile_candidate_sessions(db, candidate_id)
    profile_row = await db.execute(
        text(
            """
            SELECT c.registration_number, c.kyc_status, u.email, u.first_name, u.last_name
            FROM candidates c
            JOIN users u ON u.id = c.user_id
            WHERE c.id = :candidate_id
            """
        ),
        {"candidate_id": candidate_id},
    )
    profile = profile_row.mappings().first()
    if not profile:
        raise HTTPException(status_code=404, detail="Candidate not found")

    exam_count = await db.execute(
        text(
            """
            SELECT COUNT(*)
            FROM exam_registrations er
            JOIN exams e ON e.id = er.exam_id
            WHERE er.candidate_id = :candidate_id
              AND e.status = ANY(:statuses)
            """
        ),
        {"candidate_id": candidate_id, "statuses": list(CANDIDATE_VISIBLE_STATUSES)},
    )
    total_exams = int(exam_count.scalar() or 0)

    session_stats = await db.execute(
        text(
            """
            SELECT COUNT(*)::int AS in_progress
            FROM (
              SELECT DISTINCT ON (er.exam_id)
                es.status,
                e.end_time
              FROM exam_sessions es
              JOIN exam_registrations er ON er.id = es.registration_id
              JOIN exams e ON e.id = er.exam_id
              WHERE es.candidate_id = :candidate_id
              ORDER BY er.exam_id, es.created_at DESC
            ) latest
            WHERE latest.status = 'IN_PROGRESS'
              AND (latest.end_time IS NULL OR latest.end_time >= NOW())
            """
        ),
        {"candidate_id": candidate_id},
    )
    in_progress = int(session_stats.scalar() or 0)

    submitted_stats = await db.execute(
        text(
            """
            SELECT COUNT(*)::int AS submitted
            FROM (
              SELECT DISTINCT ON (er.exam_id)
                es.status
              FROM exam_sessions es
              JOIN exam_registrations er ON er.id = es.registration_id
              JOIN exams e ON e.id = er.exam_id
              WHERE es.candidate_id = :candidate_id
                AND e.status IN ('PUBLISHED', 'COMPLETED')
              ORDER BY er.exam_id, es.created_at DESC
            ) latest
            WHERE latest.status IN ('SUBMITTED', 'AUTO_SUBMITTED')
            """
        ),
        {"candidate_id": candidate_id},
    )
    submitted = int(submitted_stats.scalar() or 0)

    results_rows = await db.execute(
        text(
            """
            SELECT percentage FROM exam_results
            WHERE candidate_id = :candidate_id AND published = true
            """
        ),
        {"candidate_id": candidate_id},
    )
    percentages = [float(r[0]) for r in results_rows.all()]
    average_score = sum(percentages) / len(percentages) if percentages else None

    return {
        "profile": {
            "registrationNumber": profile["registration_number"],
            "kycStatus": profile["kyc_status"],
            "email": profile["email"],
            "fullName": f"{profile['first_name']} {profile['last_name']}".strip(),
        },
        "stats": {
            "totalExams": total_exams,
            "submittedExams": submitted,
            "inProgressExams": in_progress,
            "publishedResults": len(percentages),
            "averageScore": average_score,
        },
    }


@router.get("/me/admit-card/{exam_id}")
async def my_admit_card(
    exam_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    candidate_id = await require_candidate_id(db, current_user.id)
    row = await db.execute(
        text(
            """
            SELECT er.id AS registration_id, er.admit_card_url,
                   c.registration_number, u.first_name, u.last_name, u.email,
                   e.title, e.code, e.status, e.start_time, e.end_time, e.timezone
            FROM exam_registrations er
            JOIN candidates c ON c.id = er.candidate_id
            JOIN users u ON u.id = c.user_id
            JOIN exams e ON e.id = er.exam_id
            WHERE er.exam_id = :exam_id AND er.candidate_id = :candidate_id
            """
        ),
        {"exam_id": exam_id, "candidate_id": candidate_id},
    )
    reg = row.mappings().first()
    if not reg:
        raise HTTPException(status_code=404, detail="Not registered for this exam")
    assert_exam_visible_to_candidate(reg["status"])

    admit_card_url = reg["admit_card_url"] or f"/admit-cards/{reg['registration_id']}"
    if not reg["admit_card_url"]:
        await db.execute(
            text(
                """
                UPDATE exam_registrations
                SET admit_card_url = :url, status = 'ADMIT_CARD_ISSUED'
                WHERE id = :id
                """
            ),
            {"url": admit_card_url, "id": reg["registration_id"]},
        )

    return {
        "admitCardId": reg["registration_id"],
        "admitCardUrl": admit_card_url,
        "registrationNumber": reg["registration_number"],
        "candidateName": f"{reg['first_name']} {reg['last_name']}".strip(),
        "candidateEmail": reg["email"],
        "examTitle": reg["title"],
        "examCode": reg["code"],
        "startTime": reg["start_time"].isoformat() if reg["start_time"] else None,
        "endTime": reg["end_time"].isoformat() if reg["end_time"] else None,
        "timezone": reg["timezone"],
        "venue": "Online Proctored Examination",
        "instructions": [
            "Arrive 15 minutes before the scheduled start time.",
            "Ensure a stable internet connection and working webcam.",
            "Keep a valid photo ID ready for verification.",
            "Fullscreen mode is required during the examination.",
        ],
    }


class CandidateCreate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    email: str
    password: str
    first_name: str = Field(alias="firstName")
    last_name: str = Field(alias="lastName")
    registration_number: str | None = Field(None, alias="registrationNumber")
    batch_id: str | None = Field(None, alias="batchId")
    roll_number: str | None = Field(None, alias="rollNumber")


class RegistrationInviteCreate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    email: str
    first_name: str | None = Field(None, alias="firstName")
    last_name: str | None = Field(None, alias="lastName")
    batch_id: str | None = Field(None, alias="batchId")
    registration_number: str | None = Field(None, alias="registrationNumber")
    expires_in_days: int | None = Field(None, alias="expiresInDays")


class KycVerifyBody(BaseModel):
    status: Literal["VERIFIED", "REJECTED"]


class CandidateUpdate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    first_name: str | None = Field(None, alias="firstName")
    last_name: str | None = Field(None, alias="lastName")
    email: str | None = None
    registration_number: str | None = Field(None, alias="registrationNumber")
    status: str | None = None
    password: str | None = None


class CandidateSetBatch(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    batch_id: str | None = Field(None, alias="batchId")
    roll_number: str | None = Field(None, alias="rollNumber")


class KycSubmitBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    document_type: str = Field(..., alias="documentType")
    id_number: str = Field(..., alias="idNumber")
    file_name: str = Field(..., alias="fileName")
    file_data: str = Field(..., alias="fileData")


@router.post("/me/kyc")
async def submit_kyc(
    body: KycSubmitBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    candidate = await db.execute(
        text(
            """
            SELECT id, profile_data
            FROM candidates
            WHERE user_id = :user_id AND tenant_id = :tenant_id
            LIMIT 1
            """
        ),
        {"user_id": str(current_user.id), "tenant_id": str(current_user.tenant_id)},
    )
    candidate_row = candidate.mappings().first()
    if not candidate_row:
        raise HTTPException(status_code=404, detail="Student profile not found")

    if not body.id_number.strip() or not body.file_name.strip() or not body.file_data.strip():
        raise HTTPException(status_code=400, detail="Document number and file are required")
    if len(body.file_data) > 4_000_000:
        raise HTTPException(status_code=400, detail="Document is too large (max ~3MB)")

    await db.execute(
        text(
            """
            DELETE FROM candidate_documents
            WHERE candidate_id = :candidate_id AND type = :document_type
            """
        ),
        {"candidate_id": str(candidate_row["id"]), "document_type": body.document_type},
    )
    await db.execute(
        text(
            """
            INSERT INTO candidate_documents
                            (id, candidate_id, type, file_name, file_url, file_size, mime_type)
            VALUES
                            (:id, :candidate_id, :document_type, :file_name, :file_data, :file_size, :mime_type)
            """
        ),
        {
            "id": str(uuid.uuid4()),
            "candidate_id": str(candidate_row["id"]),
            "document_type": body.document_type,
            "file_name": body.file_name.strip(),
            "file_data": body.file_data,
            "file_size": len(body.file_data),
            "mime_type": "application/pdf"
            if body.file_name.lower().endswith(".pdf")
            else "image/jpeg",
        },
    )

    profile_data = candidate_row["profile_data"]
    if isinstance(profile_data, str):
        profile_data = json.loads(profile_data) if profile_data else {}
    profile_data = profile_data if isinstance(profile_data, dict) else {}
    profile_data.update(
        {
            "idNumber": body.id_number.strip(),
            "documentType": body.document_type,
            "submittedAt": datetime.now(timezone.utc).isoformat(),
        }
    )
    await db.execute(
        text(
            """
            UPDATE candidates
            SET kyc_status = 'PENDING', profile_data = CAST(:profile_data AS jsonb), updated_at = :now
            WHERE id = :candidate_id
            """
        ),
        {
            "profile_data": json.dumps(profile_data),
            "now": datetime.now(timezone.utc),
            "candidate_id": str(candidate_row["id"]),
        },
    )
    return {"kycStatus": "PENDING", "documentType": body.document_type}


async def _get_candidate_row(
    db: AsyncSession, candidate_id: str, tenant_id: str
) -> dict | None:
    result = await db.execute(
        text(
            """
            SELECT c.id, c.registration_number, c.kyc_status, c.user_id,
                   u.email, u.first_name, u.last_name, u.status AS user_status
            FROM candidates c
            JOIN users u ON u.id = c.user_id
            WHERE c.id = :candidate_id AND c.tenant_id = :tenant_id
            """
        ),
        {"candidate_id": candidate_id, "tenant_id": tenant_id},
    )
    row = result.mappings().first()
    return dict(row) if row else None


@router.get("")
async def list_candidates(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    search: str = Query(""),
    batch_id: str | None = Query(None, alias="batchId"),
    academic_class_id: str | None = Query(None, alias="academicClassId"),
    unassigned: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tenant_id = current_user.tenant_id
    offset = (page - 1) * limit
    params: dict = {"tenant_id": tenant_id, "limit": limit, "offset": offset}

    teacher_scoped = is_teacher_scoped(current_user)
    teacher_batch_ids: list[str] | None = None
    if teacher_scoped:
        teacher_batch_ids = await get_teacher_batch_ids(db, str(current_user.id))
        if unassigned:
            raise HTTPException(
                status_code=403,
                detail="Teachers can only view students in their assigned classes",
            )
        if batch_id and batch_id not in teacher_batch_ids:
            raise HTTPException(status_code=403, detail="You are not assigned to this class")
        if not teacher_batch_ids:
            return {
                "items": [],
                "total": 0,
                "page": page,
                "limit": limit,
                "totalPages": 0,
            }

    filters = ["c.tenant_id = :tenant_id"]
    if search:
        params["search"] = f"%{search.lower()}%"
        filters.append(
            "(LOWER(c.registration_number) LIKE :search OR LOWER(u.email) LIKE :search "
            "OR LOWER(u.first_name) LIKE :search OR LOWER(u.last_name) LIKE :search)"
        )
    if unassigned:
        filters.append(
            "NOT EXISTS (SELECT 1 FROM batch_enrollments be WHERE be.candidate_id = c.id)"
        )
    elif batch_id:
        params["batch_id"] = batch_id
        filters.append(
            "EXISTS (SELECT 1 FROM batch_enrollments be WHERE be.candidate_id = c.id AND be.batch_id = :batch_id)"
        )
    elif academic_class_id:
        params["class_id"] = academic_class_id
        filters.append(
            "EXISTS (SELECT 1 FROM batch_enrollments be "
            "JOIN batches b ON b.id = be.batch_id "
            "WHERE be.candidate_id = c.id AND b.academic_class_id = :class_id)"
        )

    if teacher_batch_ids:
        params["teacher_batch_ids"] = teacher_batch_ids
        filters.append(
            "EXISTS (SELECT 1 FROM batch_enrollments be "
            "WHERE be.candidate_id = c.id AND be.batch_id::text = ANY(:teacher_batch_ids))"
        )

    where_sql = " AND ".join(filters)
    count_row = await db.execute(
        text(f"SELECT COUNT(*) FROM candidates c JOIN users u ON u.id = c.user_id WHERE {where_sql}"),
        params,
    )
    total = int(count_row.scalar() or 0)

    rows = await db.execute(
        text(
            f"""
            SELECT c.id, c.registration_number, c.kyc_status,
                   u.id AS user_id, u.email, u.first_name, u.last_name, u.status AS user_status,
                   u.created_at, c.profile_data
            FROM candidates c
            JOIN users u ON u.id = c.user_id
            WHERE {where_sql}
            ORDER BY c.created_at DESC
            LIMIT :limit OFFSET :offset
            """
        ),
        params,
    )

    items = []
    for row in rows.mappings():
        enroll = await db.execute(
            text(
                """
                SELECT be.id, be.roll_number, b.id AS batch_id, b.name, b.academic_year,
                       ac.id AS class_id, ac.name AS class_name, ac.level AS class_level
                FROM batch_enrollments be
                JOIN batches b ON b.id = be.batch_id
                JOIN academic_classes ac ON ac.id = b.academic_class_id
                WHERE be.candidate_id = :candidate_id
                ORDER BY be.enrolled_at DESC
                LIMIT 1
                """
            ),
            {"candidate_id": row["id"]},
        )
        enrollment = enroll.mappings().first()
        batch_enrollments = []
        if enrollment:
            batch_enrollments.append(
                {
                    "id": enrollment["id"],
                    "rollNumber": enrollment["roll_number"],
                    "batch": {
                        "id": enrollment["batch_id"],
                        "name": enrollment["name"],
                        "academicYear": enrollment["academic_year"],
                        "academicClass": {
                            "id": enrollment["class_id"],
                            "name": enrollment["class_name"],
                            "level": enrollment["class_level"],
                        },
                    },
                }
            )
        items.append(
            {
                "id": row["id"],
                "registrationNumber": row["registration_number"],
                "kycStatus": row["kyc_status"],
                "createdAt": row["created_at"].isoformat() if row["created_at"] else None,
                "createdBy": (json.loads(row["profile_data"]).get("createdBy")
                              if isinstance(row["profile_data"], str) and row["profile_data"] else
                              (row["profile_data"] or {}).get("createdBy")
                              if isinstance(row["profile_data"], dict) else None),
                "user": {
                    "firstName": row["first_name"] or "",
                    "lastName": row["last_name"] or "",
                    "email": row["email"],
                    "status": row["user_status"],
                },
                "batchEnrollments": batch_enrollments,
            }
        )

    return {
        "items": items,
        "total": total,
        "page": page,
        "limit": limit,
        "totalPages": math.ceil(total / limit) if total else 0,
    }


@router.post("/registration-invites")
async def create_registration_invite_route(
    body: RegistrationInviteCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(["candidate:invite", "candidate:create"])),
):
    tenant_id = str(current_user.tenant_id)
    app_url = settings.resolve_public_app_url()

    result = await create_registration_invite(
        db,
        tenant_id=tenant_id,
        created_by_id=str(current_user.id),
        email=body.email,
        first_name=body.first_name,
        last_name=body.last_name,
        batch_id=body.batch_id,
        registration_number=body.registration_number,
        expires_in_days=body.expires_in_days,
        app_url=app_url,
    )
    await db.commit()
    return result


@router.get("/registration-invites")
async def list_registration_invites(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission(["candidate:invite", "candidate:create"])),
):
    tenant_id = str(current_user.tenant_id)
    offset = (page - 1) * limit
    now = datetime.now(timezone.utc)

    count_row = await db.execute(
        text(
            """
            SELECT COUNT(*) FROM registration_invites
            WHERE tenant_id = :tenant_id
              AND used_at IS NULL
              AND expires_at > :now
            """
        ),
        {"tenant_id": tenant_id, "now": now},
    )
    total = int(count_row.scalar() or 0)

    rows = await db.execute(
        text(
            """
            SELECT ri.id, ri.email, ri.first_name, ri.last_name, ri.expires_at, ri.created_at,
                   b.id AS batch_id, b.name AS batch_name, b.academic_year
            FROM registration_invites ri
            LEFT JOIN batches b ON b.id = ri.batch_id
            WHERE ri.tenant_id = :tenant_id
              AND ri.used_at IS NULL
              AND ri.expires_at > :now
            ORDER BY ri.created_at DESC
            LIMIT :limit OFFSET :offset
            """
        ),
        {"tenant_id": tenant_id, "now": now, "limit": limit, "offset": offset},
    )

    items = []
    for row in rows.mappings():
        batch = None
        if row["batch_id"]:
            batch = {
                "id": row["batch_id"],
                "name": row["batch_name"],
                "academicYear": row["academic_year"],
            }
        items.append(
            {
                "id": row["id"],
                "email": row["email"],
                "firstName": row["first_name"],
                "lastName": row["last_name"],
                "expiresAt": row["expires_at"].isoformat() if row["expires_at"] else None,
                "createdAt": row["created_at"].isoformat() if row["created_at"] else None,
                "batch": batch,
            }
        )

    return {
        "items": items,
        "total": total,
        "page": page,
        "limit": limit,
        "totalPages": math.ceil(total / limit) if total else 0,
    }


@router.post("")
async def create_candidate(
    body: CandidateCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tenant_id = current_user.tenant_id
    email = body.email.strip().lower()

    existing = await db.execute(
        select(User.id).where(User.email == email, User.tenant_id == tenant_id)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Email already registered")

    role_result = await db.execute(select(Role).where(Role.name == "CANDIDATE"))
    candidate_role = role_result.scalar_one_or_none()
    if not candidate_role:
        raise HTTPException(status_code=400, detail="Candidate role not configured")

    reg_no = (body.registration_number or "").strip() or f"CAND-{str(int(time.time()))[-8:]}"
    dup_reg = await db.execute(
        text("SELECT id FROM candidates WHERE tenant_id = :tenant_id AND registration_number = :reg_no"),
        {"tenant_id": tenant_id, "reg_no": reg_no},
    )
    if dup_reg.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Registration number already exists")

    if body.batch_id:
        batch_check = await db.execute(
            text(
                "SELECT id FROM batches WHERE id = :id AND tenant_id = :tenant_id AND is_active = true"
            ),
            {"id": body.batch_id, "tenant_id": tenant_id},
        )
        if not batch_check.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="Batch not found")

    now = datetime.now(timezone.utc)
    user_id = str(uuid.uuid4())
    candidate_id = str(uuid.uuid4())

    user = User(
        id=user_id,
        email=email,
        password_hash=hash_password(body.password),
        first_name=body.first_name,
        last_name=body.last_name,
        status=UserStatus.ACTIVE,
        is_active=True,
        tenant_id=tenant_id,
        email_verified=True,
        created_at=now,
        updated_at=now,
    )
    db.add(user)
    db.add(
        UserRole(
            id=str(uuid.uuid4()),
            user_id=user_id,
            role_id=candidate_role.id,
            assigned_at=now,
        )
    )
    await db.flush()

    await db.execute(
        text(
            """
            INSERT INTO candidates
                            (id, tenant_id, user_id, registration_number, kyc_status, profile_data, created_at, updated_at)
            VALUES
                            (:id, :tenant_id, :user_id, :reg_no, 'NOT_SUBMITTED', CAST(:profile_data AS jsonb), :now, :now)
            """
        ),
        {
            "id": candidate_id,
            "tenant_id": tenant_id,
            "user_id": user_id,
            "reg_no": reg_no,
            "profile_data": json.dumps({
                "createdBy": {
                    "id": str(current_user.id),
                    "name": f"{current_user.first_name or ''} {current_user.last_name or ''}".strip() or current_user.email,
                    "email": current_user.email,
                }
            }),
            "now": now,
        },
    )

    if body.batch_id:
        await db.execute(
            text(
                """
                INSERT INTO batch_enrollments (id, batch_id, candidate_id, roll_number, enrolled_at)
                VALUES (:id, :batch_id, :candidate_id, :roll_number, :now)
                """
            ),
            {
                "id": str(uuid.uuid4()),
                "batch_id": body.batch_id,
                "candidate_id": candidate_id,
                "roll_number": (body.roll_number or "").strip() or None,
                "now": now,
            },
        )

    return {
        "id": user_id,
        "email": email,
        "firstName": body.first_name,
        "lastName": body.last_name,
        "candidate": {"id": candidate_id, "registrationNumber": reg_no},
    }


async def _build_candidate_kyc_detail(
    db: AsyncSession, candidate_id: str, tenant_id: str
) -> dict:
    result = await db.execute(
        text(
            """
            SELECT c.id, c.registration_number, c.kyc_status, c.profile_data,
                   u.email, u.first_name, u.last_name, u.phone
            FROM candidates c
            JOIN users u ON u.id = c.user_id
            WHERE c.id = :candidate_id AND c.tenant_id = :tenant_id
            """
        ),
        {"candidate_id": candidate_id, "tenant_id": tenant_id},
    )
    row = result.mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Student not found")

    profile_data = row["profile_data"]
    if isinstance(profile_data, str):
        profile_data = json.loads(profile_data) if profile_data else {}
    if not isinstance(profile_data, dict):
        profile_data = {}

    doc_rows = await db.execute(
        text(
            """
            SELECT id, type, file_name, file_url, file_size, mime_type, uploaded_at
            FROM candidate_documents
            WHERE candidate_id = :candidate_id
            ORDER BY uploaded_at DESC
            """
        ),
        {"candidate_id": candidate_id},
    )

    documents = [
        {
            "id": str(d["id"]),
            "type": d["type"],
            "fileName": d["file_name"],
            "fileUrl": d["file_url"],
            "fileSize": int(d["file_size"] or 0),
            "mimeType": d["mime_type"],
            "uploadedAt": d["uploaded_at"].isoformat() if d.get("uploaded_at") else None,
        }
        for d in doc_rows.mappings()
    ]

    return {
        "id": str(row["id"]),
        "registrationNumber": row["registration_number"],
        "kycStatus": row["kyc_status"],
        "profileData": profile_data,
        "user": {
            "email": row["email"],
            "firstName": row["first_name"] or "",
            "lastName": row["last_name"] or "",
            "phone": row["phone"],
        },
        "documents": documents,
    }


@router.get("/{candidate_id}/kyc")
async def get_candidate_kyc(
    candidate_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tenant_id = str(current_user.tenant_id)
    return await _build_candidate_kyc_detail(db, candidate_id, tenant_id)


@router.get("/{candidate_id}")
async def get_candidate(
    candidate_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tenant_id = str(current_user.tenant_id)
    return await _build_candidate_kyc_detail(db, candidate_id, tenant_id)


@router.patch("/{candidate_id}/kyc/verify")
async def verify_kyc(
    candidate_id: str,
    body: KycVerifyBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tenant_id = str(current_user.tenant_id)
    existing = await db.execute(
        text(
            """
            SELECT id, registration_number, kyc_status
            FROM candidates
            WHERE id = :candidate_id AND tenant_id = :tenant_id
            """
        ),
        {"candidate_id": candidate_id, "tenant_id": tenant_id},
    )
    row = existing.mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="Candidate not found")

    if row["kyc_status"] != "PENDING":
        raise HTTPException(
            status_code=400,
            detail="Student must submit KYC before it can be verified or rejected.",
        )

    now = datetime.now(timezone.utc)
    verified_at = now if body.status == "VERIFIED" else None

    await db.execute(
        text(
            """
            UPDATE candidates
            SET kyc_status = :status,
                kyc_verified_at = :verified_at,
                updated_at = :now
            WHERE id = :candidate_id AND tenant_id = :tenant_id
            """
        ),
        {
            "status": body.status,
            "verified_at": verified_at,
            "now": now,
            "candidate_id": candidate_id,
            "tenant_id": tenant_id,
        },
    )

    return {
        "id": row["id"],
        "registrationNumber": row["registration_number"],
        "kycStatus": body.status,
        "kycVerifiedAt": verified_at.isoformat() if verified_at else None,
    }


@router.patch("/{candidate_id}")
async def update_candidate(
    candidate_id: str,
    body: CandidateUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tenant_id = str(current_user.tenant_id)
    candidate = await _get_candidate_row(db, candidate_id, tenant_id)
    if not candidate:
        raise HTTPException(status_code=404, detail="Student not found")

    if body.email is not None:
        email = body.email.strip().lower()
        if email != candidate["email"]:
            dup = await db.execute(
                text(
                    """
                    SELECT id FROM users
                    WHERE email = :email AND tenant_id = :tenant_id AND id != :user_id
                    """
                ),
                {"email": email, "tenant_id": tenant_id, "user_id": candidate["user_id"]},
            )
            if dup.scalar_one_or_none():
                raise HTTPException(status_code=409, detail="Email already in use")

    if body.registration_number is not None:
        reg_no = body.registration_number.strip()
        if reg_no != candidate["registration_number"]:
            dup = await db.execute(
                text(
                    """
                    SELECT id FROM candidates
                    WHERE tenant_id = :tenant_id
                      AND registration_number = :reg_no
                      AND id != :candidate_id
                    """
                ),
                {
                    "tenant_id": tenant_id,
                    "reg_no": reg_no,
                    "candidate_id": candidate_id,
                },
            )
            if dup.scalar_one_or_none():
                raise HTTPException(status_code=409, detail="Registration number already exists")

    now = datetime.now(timezone.utc)
    user_updates: list[str] = ["updated_at = :now"]
    user_params: dict = {
        "now": now,
        "user_id": candidate["user_id"],
        "tenant_id": tenant_id,
    }

    if body.first_name is not None:
        user_updates.append("first_name = :first_name")
        user_params["first_name"] = body.first_name.strip()
    if body.last_name is not None:
        user_updates.append("last_name = :last_name")
        user_params["last_name"] = body.last_name.strip()
    if body.email is not None:
        user_updates.append("email = :email")
        user_params["email"] = body.email.strip().lower()
    if body.status is not None:
        user_updates.append("status = :status")
        user_params["status"] = body.status
        user_updates.append("is_active = :is_active")
        user_params["is_active"] = body.status == "ACTIVE"
    if body.password and body.password.strip():
        user_updates.append("password_hash = :password_hash")
        user_params["password_hash"] = hash_password(body.password.strip())

    await db.execute(
        text(f"UPDATE users SET {', '.join(user_updates)} WHERE id = :user_id AND tenant_id = :tenant_id"),
        user_params,
    )

    if body.registration_number is not None:
        await db.execute(
            text(
                """
                UPDATE candidates
                SET registration_number = :reg_no, updated_at = :now
                WHERE id = :candidate_id AND tenant_id = :tenant_id
                """
            ),
            {
                "reg_no": body.registration_number.strip(),
                "now": now,
                "candidate_id": candidate_id,
                "tenant_id": tenant_id,
            },
        )

    updated = await _get_candidate_row(db, candidate_id, tenant_id)
    assert updated is not None
    return {
        "id": updated["id"],
        "registrationNumber": updated["registration_number"],
        "kycStatus": updated["kyc_status"],
        "user": {
            "id": updated["user_id"],
            "email": updated["email"],
            "firstName": updated["first_name"] or "",
            "lastName": updated["last_name"] or "",
            "status": updated["user_status"],
        },
    }


@router.delete("/{candidate_id}")
async def remove_candidate(
    candidate_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tenant_id = str(current_user.tenant_id)
    candidate = await _get_candidate_row(db, candidate_id, tenant_id)
    if not candidate:
        raise HTTPException(status_code=404, detail="Student not found")

    in_progress = await db.execute(
        text(
            """
            SELECT COUNT(*) FROM exam_sessions
            WHERE candidate_id = :candidate_id AND status = 'IN_PROGRESS'
            """
        ),
        {"candidate_id": candidate_id},
    )
    if int(in_progress.scalar() or 0) > 0:
        raise HTTPException(
            status_code=400,
            detail="Cannot remove a student while they have an exam in progress",
        )

    await db.execute(
        text("DELETE FROM sessions WHERE user_id = :user_id"),
        {"user_id": candidate["user_id"]},
    )
    await db.execute(
        delete(BatchEnrollment).where(BatchEnrollment.candidate_id == candidate_id)
    )
    await db.execute(
        text(
            """
            UPDATE users
            SET status = 'INACTIVE', is_active = false, updated_at = :now
            WHERE id = :user_id AND tenant_id = :tenant_id
            """
        ),
        {
            "now": datetime.now(timezone.utc),
            "user_id": candidate["user_id"],
            "tenant_id": tenant_id,
        },
    )

    full_name = f"{candidate['first_name']} {candidate['last_name']}".strip()
    return {
        "deactivated": True,
        "id": candidate_id,
        "name": full_name,
    }


@router.patch("/{candidate_id}/batch")
async def set_candidate_batch(
    candidate_id: str,
    body: CandidateSetBatch,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tenant_id = str(current_user.tenant_id)
    candidate = await _get_candidate_row(db, candidate_id, tenant_id)
    if not candidate:
        raise HTTPException(status_code=404, detail="Student not found")

    if not body.batch_id:
        await db.execute(
            delete(BatchEnrollment).where(BatchEnrollment.candidate_id == candidate_id)
        )
        return {"batch": None}

    batch_row = await db.execute(
        text(
            """
            SELECT b.id, b.name, b.academic_year,
                   ac.id AS class_id, ac.name AS class_name, ac.level AS class_level
            FROM batches b
            JOIN academic_classes ac ON ac.id = b.academic_class_id
            WHERE b.id = :batch_id AND b.tenant_id = :tenant_id AND b.is_active = true
            """
        ),
        {"batch_id": body.batch_id, "tenant_id": tenant_id},
    )
    batch = batch_row.mappings().first()
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    roll_number = body.roll_number.strip() if body.roll_number else None
    now = datetime.now(timezone.utc)

    await db.execute(
        delete(BatchEnrollment).where(BatchEnrollment.candidate_id == candidate_id)
    )
    await db.execute(
        text(
            """
            INSERT INTO batch_enrollments (id, batch_id, candidate_id, roll_number, enrolled_at)
            VALUES (:id, :batch_id, :candidate_id, :roll_number, :now)
            """
        ),
        {
            "id": str(uuid.uuid4()),
            "batch_id": body.batch_id,
            "candidate_id": candidate_id,
            "roll_number": roll_number,
            "now": now,
        },
    )

    return {
        "batch": {
            "id": batch["id"],
            "name": batch["name"],
            "academicYear": batch["academic_year"],
            "academicClass": {
                "id": batch["class_id"],
                "name": batch["class_name"],
                "level": batch["class_level"],
            },
            "rollNumber": roll_number,
        },
    }
