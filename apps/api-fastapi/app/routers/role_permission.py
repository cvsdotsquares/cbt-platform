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
from app.models.permission import Permission
from app.models.role_permission import RolePermission
from app.models.tenant import Tenant

from app.schemas.role_permission import (
    RolePermissionResponse,
    PermissionResponse,
)


router = APIRouter(
    prefix="/roles",
    tags=["Role Permissions"],
)


# ============================================================
# ASSIGN PERMISSION TO ROLE
# ============================================================

@router.post(
    "/{role_id}/permissions/{permission_id}",
    response_model=RolePermissionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def assign_permission_to_role(
    role_id: UUID,
    permission_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_tenant: Tenant = Depends(get_current_tenant),
    current_user=Depends(
        require_permission("user:assign_role")
    ),
):

    # --------------------------------------------------------
    # Check role belongs to current tenant
    # --------------------------------------------------------

    role_result = await db.execute(
        select(Role).where(
            Role.id == role_id,
            Role.tenant_id == current_tenant.id,
        )
    )

    role = role_result.scalar_one_or_none()

    if role is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Role not found",
        )

    # --------------------------------------------------------
    # Check permission exists
    # --------------------------------------------------------

    permission_result = await db.execute(
        select(Permission).where(
            Permission.id == permission_id
        )
    )

    permission = permission_result.scalar_one_or_none()

    if permission is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Permission not found",
        )

    # --------------------------------------------------------
    # Check if permission already assigned
    # --------------------------------------------------------

    existing_result = await db.execute(
        select(RolePermission).where(
            RolePermission.role_id == role_id,
            RolePermission.permission_id == permission_id,
        )
    )

    existing = existing_result.scalar_one_or_none()

    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Permission already assigned to this role",
        )

    # --------------------------------------------------------
    # Create role-permission relationship
    # --------------------------------------------------------

    role_permission = RolePermission(
        role_id=role_id,
        permission_id=permission_id,
    )

    db.add(role_permission)

    try:
        await db.commit()
        await db.refresh(role_permission)

    except IntegrityError:
        await db.rollback()

        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Permission already assigned to this role",
        )

    return role_permission


# ============================================================
# GET ROLE PERMISSIONS
# ============================================================

@router.get(
    "/{role_id}/permissions",
    response_model=list[PermissionResponse],
)
async def get_role_permissions(
    role_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_tenant: Tenant = Depends(get_current_tenant),
    current_user=Depends(
        require_permission("user:read")
    ),
):

    # --------------------------------------------------------
    # Check role belongs to current tenant
    # --------------------------------------------------------

    role_result = await db.execute(
        select(Role).where(
            Role.id == role_id,
            Role.tenant_id == current_tenant.id,
        )
    )

    role = role_result.scalar_one_or_none()

    if role is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Role not found",
        )

    # --------------------------------------------------------
    # Get permissions assigned to role
    # --------------------------------------------------------

    result = await db.execute(
        select(Permission)
        .join(
            RolePermission,
            RolePermission.permission_id == Permission.id,
        )
        .where(
            RolePermission.role_id == role_id
        )
        .order_by(
            Permission.module,
            Permission.action,
        )
    )

    return result.scalars().all()


# ============================================================
# REMOVE PERMISSION FROM ROLE
# ============================================================

@router.delete(
    "/{role_id}/permissions/{permission_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def remove_permission_from_role(
    role_id: UUID,
    permission_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_tenant: Tenant = Depends(get_current_tenant),
    current_user=Depends(
        require_permission("user:assign_role")
    ),
):

    # --------------------------------------------------------
    # Check role belongs to current tenant
    # --------------------------------------------------------

    role_result = await db.execute(
        select(Role).where(
            Role.id == role_id,
            Role.tenant_id == current_tenant.id,
        )
    )

    role = role_result.scalar_one_or_none()

    if role is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Role not found",
        )

    # --------------------------------------------------------
    # Find role-permission relationship
    # --------------------------------------------------------

    result = await db.execute(
        select(RolePermission).where(
            RolePermission.role_id == role_id,
            RolePermission.permission_id == permission_id,
        )
    )

    role_permission = result.scalar_one_or_none()

    if role_permission is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Permission is not assigned to this role",
        )

    # --------------------------------------------------------
    # Delete relationship
    # --------------------------------------------------------

    await db.delete(role_permission)
    await db.commit()

    return None