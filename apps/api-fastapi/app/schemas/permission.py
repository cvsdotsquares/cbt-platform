from uuid import UUID

from pydantic import BaseModel, ConfigDict


class PermissionCreate(BaseModel):
    code: str
    module: str
    action: str
    description: str | None = None


class PermissionUpdate(BaseModel):
    code: str | None = None
    module: str | None = None
    action: str | None = None
    description: str | None = None


class PermissionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    code: str
    module: str
    action: str
    description: str | None = None