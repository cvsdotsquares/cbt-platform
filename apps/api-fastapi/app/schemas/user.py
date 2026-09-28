from datetime import datetime
from uuid import UUID
from typing import Optional
from pydantic import BaseModel, ConfigDict


class RoleResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    name: str


class UserCreate(BaseModel):
    email: str
    password: str
    first_name: Optional[str] = ""
    last_name: Optional[str] = ""
    phone: Optional[str] = None
    tenant_id: Optional[UUID] = None
    status: Optional[str] = "ACTIVE"
    is_active: Optional[bool] = True


class UserUpdate(BaseModel):
    email: Optional[str] = None
    password: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    phone: Optional[str] = None
    status: Optional[str] = None
    is_active: Optional[bool] = None


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: str
    first_name: Optional[str] = ""
    last_name: Optional[str] = ""
    phone: Optional[str] = None
    tenant_id: UUID

    status: str = "ACTIVE"
    is_active: bool = True

    avatar_url: Optional[str] = None
    mfa_enabled: bool = False
    email_verified: bool = False
    phone_verified: bool = False
    last_login_at: Optional[datetime] = None

    roles: list[RoleResponse] = []
    created_at: datetime
    updated_at: datetime