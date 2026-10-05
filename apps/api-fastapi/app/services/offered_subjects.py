"""Per-tenant subject offerings for each academic class."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.curriculum import TenantOfferedSubject


async def offered_subject_ids_for_class(
    db: AsyncSession,
    tenant_id: str,
    academic_class_id: str,
) -> set[str] | None:
    """Return offered subject ids, or None if this class has not been configured yet."""
    result = await db.execute(
        select(TenantOfferedSubject.subject_id).where(
            TenantOfferedSubject.tenant_id == tenant_id,
            TenantOfferedSubject.academic_class_id == academic_class_id,
        )
    )
    ids = {str(row[0]) for row in result.all() if row[0]}
    if not ids:
        configured = await db.execute(
            select(TenantOfferedSubject.id).where(
                TenantOfferedSubject.tenant_id == tenant_id,
                TenantOfferedSubject.academic_class_id == academic_class_id,
            ).limit(1)
        )
        if configured.scalar_one_or_none() is None:
            return None
        return set()
    return ids


async def offered_subject_ids_by_class(
    db: AsyncSession,
    tenant_id: str,
) -> dict[str, set[str] | None]:
    """Map academic_class_id -> offered ids, or None when that class is not configured."""
    result = await db.execute(
        select(
            TenantOfferedSubject.academic_class_id,
            TenantOfferedSubject.subject_id,
        ).where(TenantOfferedSubject.tenant_id == tenant_id)
    )
    raw: dict[str, set[str]] = {}
    configured_classes: set[str] = set()
    for class_id, subject_id in result.all():
        cid = str(class_id)
        configured_classes.add(cid)
        raw.setdefault(cid, set()).add(str(subject_id))

    out: dict[str, set[str] | None] = {}
    for cid in configured_classes:
        out[cid] = raw.get(cid, set())
    return out


def filter_subjects_for_offering(
    subjects: list[dict],
    offered_ids: set[str] | None,
) -> list[dict]:
    if offered_ids is None:
        return subjects
    return [s for s in subjects if str(s["id"]) in offered_ids]


async def replace_offered_subjects(
    db: AsyncSession,
    tenant_id: str,
    academic_class_id: str,
    subject_ids: list[str],
) -> set[str]:
    from datetime import datetime, timezone
    import uuid

    from sqlalchemy import delete

    await db.execute(
        delete(TenantOfferedSubject).where(
            TenantOfferedSubject.tenant_id == tenant_id,
            TenantOfferedSubject.academic_class_id == academic_class_id,
        )
    )
    now = datetime.now(timezone.utc)
    unique = list(dict.fromkeys(str(sid) for sid in subject_ids if sid))
    for sid in unique:
        db.add(
            TenantOfferedSubject(
                id=str(uuid.uuid4()),
                tenant_id=tenant_id,
                academic_class_id=academic_class_id,
                subject_id=sid,
                created_at=now,
            )
        )
    await db.flush()
    return set(unique)
