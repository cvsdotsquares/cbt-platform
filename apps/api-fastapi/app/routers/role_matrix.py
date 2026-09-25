from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.services.role_permission_matrix import (
    assert_super_admin,
    build_matrix,
    save_role_permissions,
)

router = APIRouter(prefix="/role-permissions", tags=["Role Permissions"])


class SaveRolePermissionsBody(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    role: str
    permissions: list[str] = Field(default_factory=list)
    reset: bool = False
    user_id: str | None = Field(default=None, alias="userId")


@router.get("")
async def get_role_permission_matrix(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    assert_super_admin(current_user)
    return await build_matrix(db, str(current_user.tenant_id))


@router.put("")
async def update_role_permission_matrix(
    body: SaveRolePermissionsBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    assert_super_admin(current_user)
    return await save_role_permissions(
        db,
        str(current_user.tenant_id),
        body.role,
        body.permissions,
        reset=body.reset,
        user_id=body.user_id,
    )
