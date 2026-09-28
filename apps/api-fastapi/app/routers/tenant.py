from uuid import UUID
from typing import Any, List
import json
import re

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import (
    get_current_user,
    loaded_role_names,
    require_permission,
    require_role,
)
from app.models.tenant import Tenant
from app.models.user import User
from app.schemas.tenant import TenantCreate, TenantResponse, TenantUpdate

router = APIRouter(
    prefix="/tenants",
    tags=["Tenants"],
)

_HEX_COLOR = re.compile(r"^#([0-9A-Fa-f]{6})$")


class BrandingUpdate(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    primary_color: str | None = Field(default=None, alias="primaryColor")


def _as_branding(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return dict(value)
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            pass
    return {}


def _as_json_dict(value: Any) -> dict[str, Any] | None:
    if isinstance(value, dict):
        return dict(value)
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            pass
    return None


def _branding_payload(row: dict[str, Any]) -> dict[str, Any]:
    branding = _as_branding(row.get("branding"))
    if "primaryColor" not in branding:
        branding["primaryColor"] = "#2563eb"
    return {
        "id": str(row["id"]),
        "name": row["name"],
        "slug": row["slug"],
        "branding": branding,
    }


def _tenant_response(row: dict[str, Any]) -> dict[str, Any]:
    isolation = row.get("isolation_mode")
    return {
        "id": str(row["id"]),
        "name": row["name"],
        "slug": row["slug"],
        "domain": row.get("domain"),
        "logo_url": row.get("logo_url"),
        "branding": _as_json_dict(row.get("branding")),
        "isolation_mode": str(isolation) if isolation else "SCHEMA",
        "security_config": _as_json_dict(row.get("security_config")),
        "settings": _as_json_dict(row.get("settings")),
        "is_active": bool(row.get("is_active", True)),
    }


_TENANT_COLUMNS = """
    id, name, slug, domain, logo_url, branding,
    isolation_mode, security_config, settings, is_active
"""


async def _get_tenant_or_404(db: AsyncSession, tenant_id: str) -> dict[str, Any]:
    if not tenant_id or tenant_id == "None":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found")
    result = await db.execute(
        text(
            f"""
            SELECT {_TENANT_COLUMNS}
            FROM tenants
            WHERE id::text = :tenant_id
            """
        ),
        {"tenant_id": str(tenant_id)},
    )
    row = result.mappings().first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found")
    return dict(row)


async def _apply_branding(db: AsyncSession, tenant: dict[str, Any], color: str | None) -> dict[str, Any]:
    if not color:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="primaryColor is required")
    if not _HEX_COLOR.match(color.strip()):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="primaryColor must be a hex value like #2563eb",
        )
    branding = _as_branding(tenant.get("branding"))
    branding["primaryColor"] = color.strip()
    await db.execute(
        text(
            """
            UPDATE tenants
            SET branding = CAST(:branding AS jsonb)
            WHERE id::text = :tenant_id
            """
        ),
        {"branding": json.dumps(branding), "tenant_id": str(tenant["id"])},
    )
    tenant["branding"] = branding
    return tenant


@router.get("/me/branding")
async def get_my_branding(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tenant = await _get_tenant_or_404(db, str(current_user.tenant_id))
    return _branding_payload(tenant)


@router.patch("/me/branding")
async def update_my_branding(
    body: BrandingUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("tenant:branding")),
):
    tenant = await _get_tenant_or_404(db, str(current_user.tenant_id))
    tenant = await _apply_branding(db, tenant, body.primary_color)
    return _branding_payload(tenant)


@router.post(
    "",
    response_model=TenantResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_tenant(
    tenant: TenantCreate,
    db: AsyncSession = Depends(get_db),
    _admin=Depends(require_role(["admin", "super_admin", "org_admin"])),
):
    existing = await db.execute(
        text("SELECT 1 FROM tenants WHERE slug = :slug"),
        {"slug": tenant.slug},
    )
    if existing.first():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Tenant slug already exists",
        )

    new_tenant = Tenant(
        name=tenant.name,
        slug=tenant.slug,
        domain=tenant.domain,
        logo_url=tenant.logo_url,
        branding=tenant.branding,
        isolation_mode=tenant.isolation_mode or "SCHEMA",
        security_config=tenant.security_config,
        settings=tenant.settings,
    )
    db.add(new_tenant)
    await db.flush()
    return _tenant_response(await _get_tenant_or_404(db, str(new_tenant.id)))


@router.get("", response_model=List[TenantResponse])
async def get_tenants(
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        text(
            f"""
            SELECT {_TENANT_COLUMNS}
            FROM tenants
            ORDER BY created_at DESC
            """
        )
    )
    return [_tenant_response(dict(row)) for row in result.mappings().all()]


@router.get("/{tenant_id}", response_model=TenantResponse)
async def get_tenant(
    tenant_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    tenant = await _get_tenant_or_404(db, str(tenant_id))
    return _tenant_response(tenant)


@router.put("/{tenant_id}", response_model=TenantResponse)
async def update_tenant(
    tenant_id: UUID,
    tenant: TenantUpdate,
    db: AsyncSession = Depends(get_db),
    _admin=Depends(require_role(["admin", "super_admin", "org_admin"])),
):
    tenant_obj = await _get_tenant_or_404(db, str(tenant_id))
    update_data = tenant.model_dump(exclude_unset=True)

    if "slug" in update_data and update_data["slug"] != tenant_obj["slug"]:
        existing = await db.execute(
            text(
                """
                SELECT 1 FROM tenants
                WHERE slug = :slug AND id::text <> :tenant_id
                """
            ),
            {"slug": update_data["slug"], "tenant_id": str(tenant_id)},
        )
        if existing.first():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Tenant slug already exists",
            )

    allowed = {
        "name", "slug", "domain", "logo_url", "branding",
        "isolation_mode", "security_config", "settings", "is_active",
    }
    assignments: list[str] = []
    params: dict[str, Any] = {"tenant_id": str(tenant_id)}
    for field, value in update_data.items():
        if field not in allowed:
            continue
        if field in {"branding", "security_config", "settings"}:
            assignments.append(f"{field} = CAST(:{field} AS jsonb)")
            params[field] = json.dumps(value) if value is not None else None
        elif field == "isolation_mode":
            assignments.append(f"{field} = CAST(:{field} AS tenantisolationmode)")
            params[field] = value
        else:
            assignments.append(f"{field} = :{field}")
            params[field] = value

    if assignments:
        await db.execute(
            text(
                f"""
                UPDATE tenants
                SET {", ".join(assignments)}
                WHERE id::text = :tenant_id
                """
            ),
            params,
        )

    return _tenant_response(await _get_tenant_or_404(db, str(tenant_id)))


@router.patch("/{tenant_id}/branding")
async def update_tenant_branding(
    tenant_id: UUID,
    body: BrandingUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_permission("tenant:branding")),
):
    if str(current_user.tenant_id) != str(tenant_id):
        user_roles = {name.strip().upper() for name in loaded_role_names(current_user)}
        if not user_roles & {"SUPER_ADMIN", "ADMIN"}:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot update another institute")
    tenant = await _get_tenant_or_404(db, str(tenant_id))
    tenant = await _apply_branding(db, tenant, body.primary_color)
    return _branding_payload(tenant)


@router.delete("/{tenant_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_tenant(
    tenant_id: UUID,
    db: AsyncSession = Depends(get_db),
    _admin=Depends(require_role(["admin", "super_admin", "org_admin"])),
):
    deleted = await db.execute(
        text(
            """
            DELETE FROM tenants
            WHERE id::text = :tenant_id
            RETURNING id
            """
        ),
        {"tenant_id": str(tenant_id)},
    )
    if deleted.first() is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tenant not found",
        )

    return Response(status_code=status.HTTP_204_NO_CONTENT)