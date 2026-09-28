from uuid import UUID

from pydantic import BaseModel, ConfigDict


class RolePermissionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    role_id: UUID
    permission_id: UUID


class PermissionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    code: str
    module: str
    action: str
    description: str | None = None