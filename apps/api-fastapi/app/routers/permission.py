from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_tenant
from app.models.permission import Permission
from app.models.tenant import Tenant
from app.schemas.permission import (
    PermissionCreate,
    PermissionResponse,
    PermissionUpdate,
)


router = APIRouter(
    prefix="/permissions",
    tags=["Permissions"],
)


# ============================================================
# CREATE PERMISSION
# ============================================================

@router.post(
    "",
    response_model=PermissionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_permission(
    permission: PermissionCreate,
    db: AsyncSession = Depends(get_db),
    current_tenant: Tenant = Depends(get_current_tenant),
):
    # Check whether permission already exists
    result = await db.execute(
        select(Permission).where(
            Permission.code == permission.code
        )
    )

    existing_permission = result.scalar_one_or_none()

    if existing_permission:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Permission already exists",
        )

    new_permission = Permission(
        code=permission.code,
        module=permission.module,
        action=permission.action,
        description=permission.description,
    )

    db.add(new_permission)

    try:
        await db.commit()
        await db.refresh(new_permission)

    except IntegrityError:
        await db.rollback()

        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Permission already exists",
        )

    return new_permission


# ============================================================
# GET ALL PERMISSIONS
# ============================================================

@router.get(
    "",
    response_model=list[PermissionResponse],
)
async def get_permissions(
    db: AsyncSession = Depends(get_db),
    current_tenant: Tenant = Depends(get_current_tenant),
):
    result = await db.execute(
        select(Permission).order_by(Permission.module, Permission.code)
    )

    return result.scalars().all()


# ============================================================
# GET PERMISSION
# ============================================================

@router.get(
    "/{permission_id}",
    response_model=PermissionResponse,
)
async def get_permission(
    permission_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_tenant: Tenant = Depends(get_current_tenant),
):
    result = await db.execute(
        select(Permission).where(
            Permission.id == permission_id
        )
    )

    permission = result.scalar_one_or_none()

    if permission is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Permission not found",
        )

    return permission


# ============================================================
# UPDATE PERMISSION
# ============================================================

@router.put(
    "/{permission_id}",
    response_model=PermissionResponse,
)
async def update_permission(
    permission_id: UUID,
    permission_data: PermissionUpdate,
    db: AsyncSession = Depends(get_db),
    current_tenant: Tenant = Depends(get_current_tenant),
):
    result = await db.execute(
        select(Permission).where(
            Permission.id == permission_id
        )
    )

    permission = result.scalar_one_or_none()

    if permission is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Permission not found",
        )

    if permission_data.code is not None:
        permission.code = permission_data.code

    if permission_data.module is not None:
        permission.module = permission_data.module

    if permission_data.action is not None:
        permission.action = permission_data.action

    if permission_data.description is not None:
        permission.description = permission_data.description

    try:
        await db.commit()
        await db.refresh(permission)

    except IntegrityError:
        await db.rollback()

        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Permission code already exists",
        )

    return permission


# ============================================================
# DELETE PERMISSION
# ============================================================

@router.delete(
    "/{permission_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_permission(
    permission_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_tenant: Tenant = Depends(get_current_tenant),
):
    result = await db.execute(
        select(Permission).where(
            Permission.id == permission_id
        )
    )

    permission = result.scalar_one_or_none()

    if permission is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Permission not found",
        )

    await db.delete(permission)
    await db.commit()

    return None