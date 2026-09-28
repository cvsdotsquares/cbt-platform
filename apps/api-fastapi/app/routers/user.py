# app/routers/user.py
from __future__ import annotations

import math
import uuid
from datetime import datetime, timezone
from typing import NamedTuple

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import delete, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import (
    get_current_user,
    hash_password,
    require_permission,
)
from app.models.user import User
from app.models.user_role import UserRole
from app.services.registration_invite import (
    EMAIL_USED_TWICE,
    count_active_invites,
    count_email_accounts,
    email_has_room,
)

router = APIRouter(prefix="/users", tags=["Users"])

STUDENT_ROLES = ("CANDIDATE", "STUDENT")
ASSIGNABLE_STAFF_ROLES = ("SUPER_ADMIN", "TEACHER")

_STAFF_ROLE_EXISTS = """
EXISTS (
  SELECT 1 FROM user_roles ur
  JOIN roles r ON r.id = ur.role_id
  WHERE ur.user_id = u.id AND r.name NOT IN ('CANDIDATE', 'STUDENT')
)
"""

_SUPER_ADMIN_ROLE_EXISTS = """
EXISTS (
  SELECT 1 FROM user_roles ur
  JOIN roles r ON r.id = ur.role_id
  WHERE ur.user_id = u.id AND r.name = 'SUPER_ADMIN'
)
"""


def _tenant_id(current_user: User) -> str:
    return str(current_user.tenant_id)


class UserCreateBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    email: str
    password: str
    first_name: str = Field(default="", alias="firstName")
    last_name: str = Field(default="", alias="lastName")
    role_ids: list[str] | None = Field(default=None, alias="roleIds")


class UserUpdateBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    first_name: str | None = Field(default=None, alias="firstName")
    last_name: str | None = Field(default=None, alias="lastName")
    email: str | None = None
    status: str | None = None
    password: str | None = None
    role_id: str | None = Field(default=None, alias="roleId")


class AssignRoleBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    role_id: str = Field(..., alias="roleId")


def _assert_staff_role_names(names: list[str]) -> None:
    if any(name in STUDENT_ROLES for name in names):
        raise HTTPException(
            status_code=400,
            detail="Student/candidate roles are managed from the Students page",
        )
    if any(name not in ASSIGNABLE_STAFF_ROLES for name in names):
        raise HTTPException(
            status_code=400,
            detail="Only SUPER_ADMIN and TEACHER roles can be assigned",
        )


async def _load_user_roles(
    db: AsyncSession, user_ids: list[str]
) -> dict[str, list[dict]]:
    if not user_ids:
        return {}

    rows = await db.execute(
        text(
            """
            SELECT ur.user_id, ur.id AS user_role_id, r.id AS role_id, r.name AS role_name
            FROM user_roles ur
            JOIN roles r ON r.id = ur.role_id
            WHERE ur.user_id = ANY(:user_ids)
            ORDER BY ur.assigned_at ASC
            """
        ),
        {"user_ids": user_ids},
    )
    by_user: dict[str, list[dict]] = {}
    for row in rows.mappings():
        by_user.setdefault(row["user_id"], []).append(
            {
                "id": row["user_role_id"],
                "role": {"id": row["role_id"], "name": row["role_name"]},
            }
        )
    return by_user


async def _load_assigned_batches(
    db: AsyncSession, tenant_id: str, user_ids: list[str]
) -> dict[str, list[dict]]:
    if not user_ids:
        return {}

    rows = await db.execute(
        text(
            """
            SELECT DISTINCT ta.user_id, b.id AS batch_id, b.name AS batch_name,
                   ac.name AS class_name
            FROM teacher_assignments ta
            JOIN batches b ON b.id = ta.batch_id
            JOIN academic_classes ac ON ac.id = b.academic_class_id
            WHERE ta.user_id = ANY(:user_ids) AND b.tenant_id = :tenant_id
            ORDER BY ta.user_id, b.name
            """
        ),
        {"user_ids": user_ids, "tenant_id": tenant_id},
    )
    by_user: dict[str, list[dict]] = {}
    for row in rows.mappings():
        label = f"{row['class_name']} · {row['batch_name']}"
        items = by_user.setdefault(row["user_id"], [])
        if not any(item["id"] == row["batch_id"] for item in items):
            items.append({"id": row["batch_id"], "label": label})
    return by_user


def _serialize_user(
    row: dict,
    roles: list[dict],
    assigned_batches: list[dict] | None = None,
) -> dict:
    return {
        "id": row["id"],
        "email": row["email"],
        "firstName": row.get("first_name") or "",
        "lastName": row.get("last_name") or "",
        "status": row.get("status") or "ACTIVE",
        "mfaEnabled": bool(row.get("mfa_enabled")),
        "lastLoginAt": row["last_login_at"].isoformat() if row.get("last_login_at") else None,
        "createdAt": row["created_at"].isoformat() if row.get("created_at") else None,
        "userRoles": roles,
        "assignedBatches": assigned_batches or [],
    }


async def _get_staff_user_row(
    db: AsyncSession, user_id: str, tenant_id: str
) -> dict | None:
    result = await db.execute(
        text(
            """
            SELECT u.id, u.email, u.first_name, u.last_name, u.status,
                   u.mfa_enabled, u.last_login_at, u.created_at
            FROM users u
            WHERE u.id = :user_id AND u.tenant_id = :tenant_id
              AND EXISTS (
                SELECT 1 FROM user_roles ur
                JOIN roles r ON r.id = ur.role_id
                WHERE ur.user_id = u.id AND r.name NOT IN ('CANDIDATE', 'STUDENT')
              )
            """
        ),
        {"user_id": user_id, "tenant_id": tenant_id},
    )
    row = result.mappings().first()
    return dict(row) if row else None


async def _list_inactive_staff_user_ids(
    db: AsyncSession,
    tenant_id: str,
    *,
    exclude_user_id: str | None = None,
) -> list[str]:
    params: dict = {"tenant_id": tenant_id}
    exclude_clause = ""
    if exclude_user_id:
        exclude_clause = " AND u.id != :exclude_user_id"
        params["exclude_user_id"] = exclude_user_id

    rows = await db.execute(
        text(
            f"""
            SELECT u.id
            FROM users u
            WHERE u.tenant_id = :tenant_id
              AND u.status != 'ACTIVE'
              {exclude_clause}
              AND NOT EXISTS (
                SELECT 1 FROM candidates c WHERE c.user_id = u.id
              )
              AND {_STAFF_ROLE_EXISTS.strip()}
              AND NOT ({_SUPER_ADMIN_ROLE_EXISTS.strip()})
            """
        ),
        params,
    )
    return [str(row[0]) for row in rows.all()]


async def _tenant_fallback_user_id(
    db: AsyncSession, tenant_id: str, *, exclude_user_ids: list[str]
) -> str | None:
    row = await db.execute(
        text(
            """
            SELECT u.id
            FROM users u
            WHERE u.tenant_id = :tenant_id
              AND u.status = 'ACTIVE'
              AND u.id != ALL(:exclude_user_ids)
              AND EXISTS (
                SELECT 1 FROM user_roles ur
                JOIN roles r ON r.id = ur.role_id
                WHERE ur.user_id = u.id AND r.name = 'SUPER_ADMIN'
              )
            ORDER BY u.created_at ASC
            LIMIT 1
            """
        ),
        {"tenant_id": tenant_id, "exclude_user_ids": exclude_user_ids or [""]},
    )
    found = row.scalar_one_or_none()
    if found:
        return str(found)

    row = await db.execute(
        text(
            """
            SELECT u.id
            FROM users u
            WHERE u.tenant_id = :tenant_id
              AND u.status = 'ACTIVE'
              AND u.id != ALL(:exclude_user_ids)
              AND EXISTS (
                SELECT 1 FROM user_roles ur
                JOIN roles r ON r.id = ur.role_id
                WHERE ur.user_id = u.id AND r.name NOT IN ('CANDIDATE', 'STUDENT')
              )
            ORDER BY u.created_at ASC
            LIMIT 1
            """
        ),
        {"tenant_id": tenant_id, "exclude_user_ids": exclude_user_ids or [""]},
    )
    found = row.scalar_one_or_none()
    return str(found) if found else None


async def _clear_user_references(
    db: AsyncSession, user_ids: list[str], tenant_id: str
) -> None:
    """Reassign or null FKs so user rows can be removed."""
    if not user_ids:
        return

    fallback = await _tenant_fallback_user_id(
        db, tenant_id, exclude_user_ids=user_ids
    )
    params: dict = {"user_ids": user_ids}
    if fallback:
        params["fallback"] = fallback
        await db.execute(
            text(
                """
                UPDATE questions
                SET created_by_id = :fallback
                WHERE created_by_id::text = ANY(:user_ids)
                """
            ),
            params,
        )

    for stmt in (
        "UPDATE question_versions SET approved_by_id = NULL WHERE approved_by_id::text = ANY(:user_ids)",
        "UPDATE exams SET created_by_id = NULL WHERE created_by_id::text = ANY(:user_ids)",
        "UPDATE syllabus_progress SET updated_by_id = NULL WHERE updated_by_id = ANY(:user_ids)",
        "UPDATE registration_invites SET created_by_id = NULL WHERE created_by_id = ANY(:user_ids)",
        "UPDATE user_roles SET assigned_by = NULL WHERE assigned_by = ANY(:user_ids)",
    ):
        await db.execute(text(stmt), params)


async def _hard_delete_users(
    db: AsyncSession, user_ids: list[str], tenant_id: str
) -> int:
    if not user_ids:
        return 0

    await _clear_user_references(db, user_ids, tenant_id)
    await db.execute(
        text("DELETE FROM teacher_assignments WHERE user_id = ANY(:user_ids)"),
        {"user_ids": user_ids},
    )
    result = await db.execute(
        text(
            """
            DELETE FROM users
            WHERE id = ANY(:user_ids) AND tenant_id = :tenant_id
            RETURNING id
            """
        ),
        {"user_ids": user_ids, "tenant_id": tenant_id},
    )
    await db.flush()
    return len(result.all())


@router.get("/me")
async def get_me(current_user: User = Depends(get_current_user)):
    roles = [
        {"name": ur.role.name}
        for ur in (current_user.user_roles or [])
        if ur.role
    ]
    return {
        "id": current_user.id,
        "email": current_user.email,
        "firstName": current_user.first_name or "",
        "lastName": current_user.last_name or "",
        "tenantId": current_user.tenant_id,
        "status": current_user.status,
        "roles": roles,
    }


@router.get("/meta/roles")
async def list_assignable_roles(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    caller_roles = {
        ur.role.name
        for ur in (current_user.user_roles or [])
        if ur.role
    }
    rows = await db.execute(
        text(
            """
            SELECT id, name, description
            FROM roles
            WHERE name IN ('SUPER_ADMIN', 'TEACHER')
            ORDER BY name ASC
            """
        )
    )
    roles = [dict(row) for row in rows.mappings()]
    if "SUPER_ADMIN" not in caller_roles:
        roles = [r for r in roles if r["name"] != "SUPER_ADMIN"]
    return roles


@router.get("/meta/inactive-count")
async def inactive_staff_count(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tenant_id = _tenant_id(current_user)
    ids = await _list_inactive_staff_user_ids(
        db, tenant_id, exclude_user_id=str(current_user.id)
    )
    return {"count": len(ids)}


@router.delete("/inactive")
async def purge_inactive_staff_users(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("user:delete")),
):
    tenant_id = _tenant_id(current_user)
    user_ids = await _list_inactive_staff_user_ids(
        db, tenant_id, exclude_user_id=str(current_user.id)
    )
    if not user_ids:
        return {"deleted": 0, "ids": []}

    deleted_ids: list[str] = []
    for user_id in user_ids:
        try:
            count = await _hard_delete_users(db, [user_id], tenant_id)
            if count:
                deleted_ids.append(user_id)
        except IntegrityError:
            continue

    skipped = len(user_ids) - len(deleted_ids)
    if skipped and not deleted_ids:
        raise HTTPException(
            status_code=400,
            detail="Could not remove inactive accounts because they are still linked to other records.",
        )

    return {"deleted": len(deleted_ids), "ids": deleted_ids, "skipped": skipped}


@router.get("")
async def list_users(
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    search: str = Query(""),
    include_inactive: bool = Query(False, alias="includeInactive"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tenant_id = _tenant_id(current_user)
    offset = (page - 1) * limit
    params: dict = {"tenant_id": tenant_id, "limit": limit, "offset": offset}

    filters = [
        "u.tenant_id = :tenant_id",
        _STAFF_ROLE_EXISTS.strip(),
    ]
    if not include_inactive:
        filters.append("u.status = 'ACTIVE'")
    if search.strip():
        params["search"] = f"%{search.strip().lower()}%"
        filters.append(
            "(LOWER(u.email) LIKE :search OR LOWER(u.first_name) LIKE :search "
            "OR LOWER(u.last_name) LIKE :search)"
        )

    where_sql = " AND ".join(filters)
    count_row = await db.execute(
        text(f"SELECT COUNT(*) FROM users u WHERE {where_sql}"),
        params,
    )
    total = int(count_row.scalar() or 0)

    rows = await db.execute(
        text(
            f"""
            SELECT u.id, u.email, u.first_name, u.last_name, u.status,
                   u.mfa_enabled, u.last_login_at, u.created_at
            FROM users u
            WHERE {where_sql}
            ORDER BY u.created_at DESC
            LIMIT :limit OFFSET :offset
            """
        ),
        params,
    )
    user_rows = [dict(row) for row in rows.mappings()]
    user_ids = [row["id"] for row in user_rows]
    roles_by_user = await _load_user_roles(db, user_ids)
    batches_by_user = await _load_assigned_batches(db, tenant_id, user_ids)

    items = [
        _serialize_user(
            row,
            roles_by_user.get(row["id"], []),
            batches_by_user.get(row["id"], []),
        )
        for row in user_rows
    ]
    return {
        "items": items,
        "total": total,
        "page": page,
        "limit": limit,
        "totalPages": math.ceil(total / limit) if total else 0,
    }


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_user(
    body: UserCreateBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tenant_id = _tenant_id(current_user)
    email = body.email.strip().lower()

    accounts = await count_email_accounts(db, tenant_id, email)
    invites = await count_active_invites(db, tenant_id, email)
    if not email_has_room(accounts, invites):
        raise HTTPException(status_code=409, detail=EMAIL_USED_TWICE)

    role_ids = (body.role_ids or [])[:1]
    role_name: str | None = None
    if role_ids:
        role_row = await db.execute(
            text("SELECT id, name FROM roles WHERE id = :id"),
            {"id": role_ids[0]},
        )
        role = role_row.mappings().first()
        if not role:
            raise HTTPException(status_code=400, detail="One or more roles are invalid")
        _assert_staff_role_names([role["name"]])
        role_name = role["name"]

    now = datetime.now(timezone.utc)
    user_id = str(uuid.uuid4())

    await db.execute(
        text(
            """
            INSERT INTO users (
              id, email, first_name, last_name, password_hash, status, is_active,
              tenant_id, email_verified, created_at, updated_at
            ) VALUES (
              :id, :email, :first_name, :last_name, :password_hash, 'ACTIVE', true,
              :tenant_id, true, :now, :now
            )
            """
        ),
        {
            "id": user_id,
            "email": email,
            "first_name": body.first_name.strip(),
            "last_name": body.last_name.strip(),
            "password_hash": hash_password(body.password),
            "tenant_id": tenant_id,
            "now": now,
        },
    )

    user_roles: list[dict] = []
    if role_ids:
        await db.execute(
            text(
                """
                INSERT INTO user_roles (id, user_id, role_id, assigned_at, assigned_by)
                VALUES (:id, :user_id, :role_id, :now, :assigned_by)
                """
            ),
            {
                "id": str(uuid.uuid4()),
                "user_id": user_id,
                "role_id": role_ids[0],
                "now": now,
                "assigned_by": current_user.id,
            },
        )
        user_roles = [{"role": {"name": role_name}}]

    return {
        "id": user_id,
        "email": email,
        "firstName": body.first_name.strip(),
        "lastName": body.last_name.strip(),
        "status": "ACTIVE",
        "createdAt": now.isoformat(),
        "userRoles": user_roles,
    }


@router.get("/{user_id}")
async def get_user(
    user_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tenant_id = _tenant_id(current_user)
    row = await _get_staff_user_row(db, user_id, tenant_id)
    if not row:
        raise HTTPException(status_code=404, detail="User not found")

    roles = (await _load_user_roles(db, [user_id])).get(user_id, [])
    batches = (await _load_assigned_batches(db, tenant_id, [user_id])).get(user_id, [])
    return _serialize_user(row, roles, batches)


@router.patch("/{user_id}")
async def update_user(
    user_id: str,
    body: UserUpdateBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tenant_id = _tenant_id(current_user)
    existing = await db.execute(
        text(
            """
            SELECT u.id, u.email, u.first_name, u.last_name, u.status
            FROM users u
            WHERE u.id = :user_id AND u.tenant_id = :tenant_id
            """
        ),
        {"user_id": user_id, "tenant_id": tenant_id},
    )
    row = existing.mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="User not found")

    if body.email is not None:
        email = body.email.strip().lower()
        if email != row["email"]:
            accounts = await count_email_accounts(
                db, tenant_id, email, exclude_user_id=str(user_id)
            )
            invites = await count_active_invites(db, tenant_id, email)
            if not email_has_room(accounts, invites):
                raise HTTPException(status_code=409, detail=EMAIL_USED_TWICE)

    now = datetime.now(timezone.utc)
    user_updates: list[str] = ["updated_at = :now"]
    params: dict = {"now": now, "user_id": user_id, "tenant_id": tenant_id}

    if body.first_name is not None:
        user_updates.append("first_name = :first_name")
        params["first_name"] = body.first_name.strip()
    if body.last_name is not None:
        user_updates.append("last_name = :last_name")
        params["last_name"] = body.last_name.strip()
    if body.email is not None:
        user_updates.append("email = :email")
        params["email"] = body.email.strip().lower()
    if body.status is not None:
        user_updates.append("status = :status")
        params["status"] = body.status
        user_updates.append("is_active = :is_active")
        params["is_active"] = body.status == "ACTIVE"
    if body.password and body.password.strip():
        user_updates.append("password_hash = :password_hash")
        params["password_hash"] = hash_password(body.password.strip())

    await db.execute(
        text(
            f"UPDATE users SET {', '.join(user_updates)} "
            "WHERE id = :user_id AND tenant_id = :tenant_id"
        ),
        params,
    )

    if body.role_id is not None:
        await db.execute(delete(UserRole).where(UserRole.user_id == user_id))
        if body.role_id:
            role_row = await db.execute(
                text("SELECT id, name FROM roles WHERE id = :id"),
                {"id": body.role_id},
            )
            role = role_row.mappings().first()
            if not role:
                raise HTTPException(status_code=400, detail="Invalid role")
            _assert_staff_role_names([role["name"]])
            await db.execute(
                text(
                    """
                    INSERT INTO user_roles (id, user_id, role_id, assigned_at, assigned_by)
                    VALUES (:id, :user_id, :role_id, :now, :assigned_by)
                    """
                ),
                {
                    "id": str(uuid.uuid4()),
                    "user_id": user_id,
                    "role_id": body.role_id,
                    "now": now,
                    "assigned_by": current_user.id,
                },
            )

    updated = await _get_staff_user_row(db, user_id, tenant_id)
    if not updated:
        raise HTTPException(status_code=404, detail="User not found")
    roles = (await _load_user_roles(db, [user_id])).get(user_id, [])
    return _serialize_user(updated, roles)


@router.delete("/{user_id}")
async def delete_user(
    user_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("user:delete")),
):
    tenant_id = _tenant_id(current_user)
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="You cannot delete your own account")

    row = await _get_staff_user_row(db, user_id, tenant_id)
    if not row:
        raise HTTPException(status_code=404, detail="User not found")

    roles = (await _load_user_roles(db, [user_id])).get(user_id, [])
    if any(r["role"]["name"] == "SUPER_ADMIN" for r in roles):
        raise HTTPException(status_code=400, detail="Cannot delete a super admin account")

    candidate_row = await db.execute(
        text("SELECT id FROM candidates WHERE user_id = :user_id LIMIT 1"),
        {"user_id": user_id},
    )
    if candidate_row.scalar_one_or_none():
        raise HTTPException(
            status_code=400,
            detail="This user is a student account. Remove them from the Students page instead.",
        )

    try:
        deleted_count = await _hard_delete_users(db, [user_id], tenant_id)
    except IntegrityError as exc:
        raise HTTPException(
            status_code=400,
            detail="Cannot delete this user because they are still linked to other records.",
        ) from exc

    if not deleted_count:
        raise HTTPException(status_code=404, detail="User not found")

    return {"deleted": True, "id": user_id}


@router.post("/{user_id}/roles", status_code=status.HTTP_201_CREATED)
async def assign_role(
    user_id: str,
    body: AssignRoleBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tenant_id = _tenant_id(current_user)
    row = await _get_staff_user_row(db, user_id, tenant_id)
    if not row:
        raise HTTPException(status_code=404, detail="User not found")

    role_row = await db.execute(
        text("SELECT id, name FROM roles WHERE id = :id"),
        {"id": body.role_id},
    )
    role = role_row.mappings().first()
    if not role:
        raise HTTPException(status_code=400, detail="Invalid role")
    _assert_staff_role_names([role["name"]])

    now = datetime.now(timezone.utc)
    await db.execute(delete(UserRole).where(UserRole.user_id == user_id))
    await db.execute(
        text(
            """
            INSERT INTO user_roles (id, user_id, role_id, assigned_at, assigned_by)
            VALUES (:id, :user_id, :role_id, :now, :assigned_by)
            """
        ),
        {
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "role_id": body.role_id,
            "now": now,
            "assigned_by": current_user.id,
        },
    )
    return {"userId": user_id, "roleId": body.role_id, "role": {"id": role["id"], "name": role["name"]}}


@router.delete("/{user_id}/roles/{role_id}", status_code=status.HTTP_200_OK)
async def remove_role(
    user_id: str,
    role_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tenant_id = _tenant_id(current_user)
    row = await _get_staff_user_row(db, user_id, tenant_id)
    if not row:
        raise HTTPException(status_code=404, detail="User not found")

    result = await db.execute(
        text(
            """
            DELETE FROM user_roles
            WHERE user_id = :user_id AND role_id = :role_id
            RETURNING id
            """
        ),
        {"user_id": user_id, "role_id": role_id},
    )
    if not result.first():
        raise HTTPException(status_code=400, detail="Role not assigned")
    return {"deleted": True}
