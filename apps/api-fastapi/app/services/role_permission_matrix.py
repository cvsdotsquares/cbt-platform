"""Institute role permission matrix stored on the tenant.

Defaults come from ROLE_PERMISSIONS. A super admin can replace the catalog
portion for Teacher. Permissions outside the catalog stay
on their built-in defaults so a save cannot strip hidden access.
"""
from __future__ import annotations

import json
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import bindparam, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import ROLE_PERMISSIONS, loaded_role_names
from app.models.user import User

SETTINGS_KEY = "rolePermissions"
TEACHER_SETTINGS_KEY = "teacherPermissions"
INSTITUTE_ADMIN_ROLE_ENABLED = False

CONFIGURABLE_ROLES: list[dict[str, str]] = [
    {
        "name": "TEACHER",
        "label": "Teacher",
        "description": "What a class teacher can open, create, and change.",
    },
    # {
    #     "name": "INSTITUTE_ADMIN",
    #     "label": "Institute Admin",
    #     "description": "What institute staff can open, create, and change.",
    # },
]

# Column order matches a role-permissions grid: view and create first.
COLUMNS: list[str] = [
    "View",
    "Create",
    "Edit",
    "Delete",
    "Invite",
    "Verify KYC",
    "Publish",
    "Schedule",
    "Assign",
    "Answers",
    "Approve",
    "Grade",
    "Rank",
    "Upload",
    "Topics",
    "Manage",
    "Generate",
    "Monitor",
    "Violations",
]

MODULES: list[dict[str, Any]] = [
    {
        "key": "students",
        "label": "Students",
        "cells": {
            "View": "candidate:read",
            "Create": "candidate:create",
            "Edit": "candidate:update",
            "Delete": "candidate:delete",
            "Invite": "candidate:invite",
            "Verify KYC": "candidate:kyc_verify",
        },
    },
    {
        "key": "tests",
        "label": "Class Tests",
        "cells": {
            "View": "exam:read",
            "Create": "exam:create",
            "Edit": "exam:update",
            "Delete": "exam:delete",
            "Publish": "exam:publish",
            "Schedule": "exam:schedule",
            "Assign": "exam:assign_candidates",
            "Answers": "exam:view_response",
        },
    },
    {
        "key": "questions",
        "label": "Questions",
        "cells": {
            "View": "question:read",
            "Create": "question:create",
            "Edit": "question:update",
            "Delete": "question:delete",
            "Approve": "question:approve",
        },
    },
    {
        "key": "results",
        "label": "Results",
        "cells": {
            "View": "result:read",
            "Grade": "result:evaluate",
            "Publish": "result:publish",
            "Rank": "result:rank",
        },
    },
    {
        "key": "books",
        "label": "NCERT Books",
        "cells": {
            "View": "material:read",
            "Upload": "material:upload",
            "Delete": "material:delete",
        },
    },
    {
        "key": "syllabus",
        "label": "Syllabus",
        "cells": {
            "View": "curriculum:read",
            "Topics": "syllabus:read",
            "Manage": "syllabus:manage",
        },
    },
    {
        "key": "classes",
        "label": "Classes & Batches",
        "cells": {
            "View": "batch:read",
            "Manage": "batch:manage",
        },
    },
    {
        "key": "learning",
        "label": "Teacher Home",
        "cells": {
            "View": "learning:read",
            "Manage": "learning:manage",
        },
    },
    {
        "key": "ai",
        "label": "Create Class Test",
        "cells": {
            "Generate": "ai:generate_test",
        },
    },
    {
        "key": "monitoring",
        "label": "Live Monitoring",
        "cells": {
            "Monitor": "proctoring:monitor",
            "Violations": "security:view_violations",
        },
    },
    {
        "key": "analytics",
        "label": "Analytics",
        "cells": {
            "View": "analytics:view",
        },
    },
]

CATALOG_CODES: set[str] = {
    code
    for module in MODULES
    for code in module["cells"].values()
}

CONFIGURABLE_ROLE_NAMES = {role["name"] for role in CONFIGURABLE_ROLES}


def assert_super_admin(user: User) -> None:
    names = {name.upper() for name in loaded_role_names(user)}
    if "SUPER_ADMIN" not in names:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only a super admin can manage role permissions",
        )


def _as_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return dict(value)
    if isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return {}
        return dict(parsed) if isinstance(parsed, dict) else {}
    return {}


async def load_teacher_overrides(db: AsyncSession, tenant_id: str) -> dict[str, list[str]]:
    row = await db.execute(
        text("SELECT settings FROM tenants WHERE id::text = :id"),
        {"id": str(tenant_id)},
    )
    settings = _as_dict(row.scalar_one_or_none())
    raw = settings.get(TEACHER_SETTINGS_KEY)
    if not isinstance(raw, dict):
        return {}
    overrides: dict[str, list[str]] = {}
    for user_id, codes in raw.items():
        if not isinstance(codes, list):
            continue
        overrides[str(user_id)] = [str(code) for code in codes if str(code) in CATALOG_CODES]
    return overrides


async def list_teachers(db: AsyncSession, tenant_id: str) -> list[dict[str, Any]]:
    """Teachers with the Teacher role, plus anyone assigned to a class."""
    rows = await db.execute(
        text(
            """
            SELECT DISTINCT u.id AS id, u.first_name, u.last_name, u.email
            FROM users u
            WHERE u.tenant_id = :tenant_id
              AND u.is_active = true
              AND (
                EXISTS (
                  SELECT 1
                  FROM user_roles ur
                  JOIN roles r ON r.id = ur.role_id
                  WHERE ur.user_id = u.id
                    AND UPPER(TRIM(r.name)) = 'TEACHER'
                )
                OR EXISTS (
                  SELECT 1
                  FROM teacher_assignments ta
                  JOIN batches b ON b.id = ta.batch_id
                  WHERE ta.user_id = u.id
                    AND b.tenant_id = :tenant_id
                )
              )
            ORDER BY u.first_name, u.last_name, u.email
            """
        ),
        {"tenant_id": str(tenant_id)},
    )
    teachers: list[dict[str, Any]] = []
    by_id: dict[str, dict[str, Any]] = {}
    for row in rows.mappings():
        name = f"{row['first_name'] or ''} {row['last_name'] or ''}".strip() or row["email"]
        item = {
            "id": row["id"],
            "name": name,
            "email": row["email"] or "",
            "assignments": [],
        }
        teachers.append(item)
        by_id[str(row["id"])] = item

    if not by_id:
        return teachers

    assignment_rows = await db.execute(
        text(
            """
            SELECT ta.user_id AS user_id,
                   ac.name AS class_name,
                   b.name AS batch_name,
                   s.name AS subject_name
            FROM teacher_assignments ta
            JOIN batches b ON b.id = ta.batch_id
            LEFT JOIN academic_classes ac ON ac.id = b.academic_class_id
            LEFT JOIN subjects s ON s.id = ta.subject_id
            WHERE b.tenant_id = :tenant_id
              AND ta.user_id IN :user_ids
            ORDER BY ac.name, b.name, s.name
            """
        ).bindparams(bindparam("user_ids", expanding=True)),
        {"tenant_id": str(tenant_id), "user_ids": list(by_id)},
    )
    for row in assignment_rows.mappings():
        teacher = by_id.get(str(row["user_id"]))
        if not teacher:
            continue
        subject = (row["subject_name"] or "").strip()
        place = " · ".join(
            part for part in ((row["class_name"] or "").strip(), (row["batch_name"] or "").strip()) if part
        )
        label = " · ".join(part for part in (subject, place) if part)
        if label and label not in teacher["assignments"]:
            teacher["assignments"].append(label)
    return teachers


def _clean_catalog_codes(permissions: list[str] | None) -> list[str]:
    cleaned: list[str] = []
    seen: set[str] = set()
    for code in permissions or []:
        if code in CATALOG_CODES and code not in seen:
            cleaned.append(code)
            seen.add(code)
    return cleaned


async def _load_settings(db: AsyncSession, tenant_id: str) -> dict[str, Any]:
    row = await db.execute(
        text("SELECT settings FROM tenants WHERE id::text = :id"),
        {"id": str(tenant_id)},
    )
    return _as_dict(row.scalar_one_or_none())


async def _save_settings(db: AsyncSession, tenant_id: str, settings: dict[str, Any]) -> None:
    await db.execute(
        text(
            """
            UPDATE tenants
            SET settings = CAST(:settings AS json), updated_at = NOW()
            WHERE id::text = :id
            """
        ),
        {"settings": json.dumps(settings), "id": str(tenant_id)},
    )
    await db.commit()


async def assert_teacher(db: AsyncSession, tenant_id: str, user_id: str) -> None:
    teachers = await list_teachers(db, tenant_id)
    if str(user_id) not in {teacher["id"] for teacher in teachers}:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Teacher not found")


async def load_overrides(db: AsyncSession, tenant_id: str) -> dict[str, list[str]]:
    settings = await _load_settings(db, tenant_id)
    raw = settings.get(SETTINGS_KEY)
    if not isinstance(raw, dict):
        return {}
    overrides: dict[str, list[str]] = {}
    for role_name, codes in raw.items():
        key = str(role_name).upper()
        if key not in CONFIGURABLE_ROLE_NAMES or not isinstance(codes, list):
            continue
        if not INSTITUTE_ADMIN_ROLE_ENABLED and key == "INSTITUTE_ADMIN":
            continue
        overrides[key] = [str(code) for code in codes if str(code) in CATALOG_CODES]
    return overrides


def default_catalog_codes(role_name: str) -> list[str]:
    base = set(ROLE_PERMISSIONS.get(role_name.upper(), []))
    return sorted(base & CATALOG_CODES)


def granted_codes(role_name: str, overrides: dict[str, list[str]]) -> list[str]:
    key = role_name.upper()
    base = set(ROLE_PERMISSIONS.get(key, []))
    if key not in overrides:
        return sorted(base)
    saved = set(overrides[key])
    return sorted((base - CATALOG_CODES) | (saved & CATALOG_CODES))


async def effective_permissions_for_user(
    db: AsyncSession,
    tenant_id: str | None,
    user_id: str | None,
    roles: list[str],
) -> tuple[list[str], bool]:
    permissions = await effective_permissions_for_roles(db, tenant_id, roles)
    role_custom = False
    if tenant_id:
        role_overrides = await load_overrides(db, tenant_id)
        role_custom = any(role.upper() in role_overrides for role in roles)
    return permissions, role_custom


async def effective_permissions_for_roles(
    db: AsyncSession,
    tenant_id: str | None,
    roles: list[str],
) -> list[str]:
    overrides = await load_overrides(db, tenant_id) if tenant_id else {}
    granted: set[str] = set()
    for role_name in roles:
        granted.update(granted_codes(role_name, overrides))
    return sorted(granted)


def matrix_payload(
    overrides: dict[str, list[str]],
    teachers: list[dict[str, Any]] | None = None,
    teacher_overrides: dict[str, list[str]] | None = None,
) -> dict[str, Any]:
    used_columns = [
        column
        for column in COLUMNS
        if any(column in module["cells"] for module in MODULES)
    ]
    teacher_overrides = teacher_overrides or {}
    role_granted = {
        role["name"]: [
            code
            for code in granted_codes(role["name"], overrides)
            if code in CATALOG_CODES
        ]
        for role in CONFIGURABLE_ROLES
    }
    teacher_granted: dict[str, list[str]] = {}
    for teacher in teachers or []:
        saved = teacher_overrides.get(teacher["id"])
        if saved is None:
            teacher_granted[teacher["id"]] = role_granted["TEACHER"]
        else:
            teacher_granted[teacher["id"]] = sorted(set(saved))
    return {
        "roles": CONFIGURABLE_ROLES,
        "columns": used_columns,
        "modules": MODULES,
        "teachers": teachers or [],
        "granted": role_granted,
        "teacherGranted": teacher_granted,
        "defaults": {
            role["name"]: default_catalog_codes(role["name"])
            for role in CONFIGURABLE_ROLES
        },
        "customized": {
            role["name"]: role["name"] in overrides
            for role in CONFIGURABLE_ROLES
        },
        "teacherCustomized": {
            teacher["id"]: teacher["id"] in teacher_overrides
            for teacher in teachers or []
        },
    }


async def save_role_permissions(
    db: AsyncSession,
    tenant_id: str,
    role_name: str,
    permissions: list[str] | None,
    *,
    reset: bool = False,
    user_id: str | None = None,
) -> dict[str, Any]:
    key = role_name.upper()
    if key not in CONFIGURABLE_ROLE_NAMES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This role cannot be edited here")

    if user_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Per-teacher permissions are disabled.",
        )

    settings = await _load_settings(db, tenant_id)
    stored = _as_dict(settings.get(SETTINGS_KEY))
    if reset:
        stored.pop(key, None)
    else:
        stored[key] = _clean_catalog_codes(permissions)
    settings[SETTINGS_KEY] = stored

    await _save_settings(db, tenant_id, settings)
    return await build_matrix(db, tenant_id)


async def build_matrix(db: AsyncSession, tenant_id: str) -> dict[str, Any]:
    overrides = await load_overrides(db, tenant_id)
    teachers = await list_teachers(db, tenant_id)
    teacher_overrides = await load_teacher_overrides(db, tenant_id)
    return matrix_payload(overrides, teachers, teacher_overrides)
