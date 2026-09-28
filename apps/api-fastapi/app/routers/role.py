from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import (
    get_current_tenant,
    require_permission,
)
from app.models.role import Role
from app.models.tenant import Tenant
from app.schemas.role import (
    RoleCreate,
    RoleResponse,
    RoleUpdate,
)

router = APIRouter(
    prefix="/roles",
    tags=["Roles"],
)


# ============================================================
# CREATE ROLE
# ============================================================

@router.post(
    "",
    response_model=RoleResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_role(
    role: RoleCreate,
    db: AsyncSession = Depends(get_db),
    current_tenant: Tenant = Depends(get_current_tenant),
    current_user=Depends(
        require_permission("user:assign_role")
    ),
):
    existing_result = await db.execute(
        select(Role).where(
            Role.tenant_id == current_tenant.id,
            Role.name == role.name,
        )
    )

    existing_role = existing_result.scalar_one_or_none()

    if existing_role:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Role already exists in this tenant",
        )

    new_role = Role(
        name=role.name,
        tenant_id=current_tenant.id,
    )

    db.add(new_role)

    try:
        await db.commit()
        await db.refresh(new_role)

    except IntegrityError:
        await db.rollback()

        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Role already exists in this tenant",
        )

    return new_role


# ============================================================
# GET ALL ROLES
# ============================================================

@router.get(
    "",
    response_model=list[RoleResponse],
)
async def get_roles(
    db: AsyncSession = Depends(get_db),
    current_tenant: Tenant = Depends(get_current_tenant),
    current_user=Depends(
        require_permission("user:read")
    ),
):
    result = await db.execute(
        select(Role)
        .where(
            Role.tenant_id == current_tenant.id
        )
        .order_by(Role.name)
    )

    return result.scalars().all()


# ============================================================
# GET ROLE BY ID
# ============================================================

@router.get(
    "/{role_id}",
    response_model=RoleResponse,
)
async def get_role(
    role_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_tenant: Tenant = Depends(get_current_tenant),
    current_user=Depends(
        require_permission("user:read")
    ),
):
    result = await db.execute(
        select(Role).where(
            Role.id == role_id,
            Role.tenant_id == current_tenant.id,
        )
    )

    role = result.scalar_one_or_none()

    if role is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Role not found",
        )

    return role


# ============================================================
# UPDATE ROLE
# ============================================================

@router.put(
    "/{role_id}",
    response_model=RoleResponse,
)
async def update_role(
    role_id: UUID,
    role_data: RoleUpdate,
    db: AsyncSession = Depends(get_db),
    current_tenant: Tenant = Depends(get_current_tenant),
    current_user=Depends(
        require_permission("user:assign_role")
    ),
):
    result = await db.execute(
        select(Role).where(
            Role.id == role_id,
            Role.tenant_id == current_tenant.id,
        )
    )

    role = result.scalar_one_or_none()

    if role is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Role not found",
        )

    duplicate_result = await db.execute(
        select(Role).where(
            Role.tenant_id == current_tenant.id,
            Role.name == role_data.name,
            Role.id != role_id,
        )
    )

    duplicate_role = duplicate_result.scalar_one_or_none()

    if duplicate_role:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Another role with this name already exists",
        )

    role.name = role_data.name

    try:
        await db.commit()
        await db.refresh(role)

    except IntegrityError:
        await db.rollback()

        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Role name already exists",
        )

    return role


# ============================================================
# DELETE ROLE
# ============================================================

@router.delete(
    "/{role_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_role(
    role_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_tenant: Tenant = Depends(get_current_tenant),
    current_user=Depends(
        require_permission("user:assign_role")
    ),
):
    result = await db.execute(
        select(Role).where(
            Role.id == role_id,
            Role.tenant_id == current_tenant.id,
        )
    )

    role = result.scalar_one_or_none()

    if role is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Role not found",
        )

    await db.delete(role)
    await db.commit()

    return None