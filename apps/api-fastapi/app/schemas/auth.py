# app/schemas/auth.py
from typing import Optional
from uuid import UUID
from pydantic import BaseModel, ConfigDict, EmailStr, Field


class LoginRequest(BaseModel):
    """Login request schema."""
    model_config = ConfigDict(populate_by_name=True)

    email: EmailStr = Field(..., description="User email address")
    password: str = Field(..., description="User password")
    tenant_id: Optional[str] = Field(None, description="Optional tenant ID filter", alias="tenantId")
    device_fingerprint: Optional[str] = Field(None, description="Device fingerprint for security", alias="deviceFingerprint")


class AuthUserResponse(BaseModel):
    """User response embedded in auth tokens."""
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: UUID
    email: str
    first_name: Optional[str] = Field("", serialization_alias="firstName")
    last_name: Optional[str] = Field("", serialization_alias="lastName")
    tenant_id: Optional[UUID] = Field(None, serialization_alias="tenantId")
    role: Optional[str] = "user"
    roles: list[str] = []
    is_active: bool = Field(True, serialization_alias="isActive")
    mfa_enabled: bool = Field(False, serialization_alias="mfaEnabled")


class LoginResponse(BaseModel):
    """Login response schema."""
    model_config = ConfigDict(populate_by_name=True)

    access_token: str = Field(..., serialization_alias="accessToken")
    refresh_token: str = Field(..., serialization_alias="refreshToken")
    token_type: str = Field(default="bearer", serialization_alias="tokenType")
    expires_in: int = Field(default=900, serialization_alias="expiresIn")
    user: AuthUserResponse = Field(..., description="User information")


class RefreshTokenRequest(BaseModel):
    """Refresh token request schema."""
    model_config = ConfigDict(populate_by_name=True)

    refresh_token: str = Field(..., alias="refreshToken", description="Refresh token")


class RefreshTokenResponse(BaseModel):
    """Refresh token response schema."""
    model_config = ConfigDict(populate_by_name=True)

    access_token: str = Field(..., serialization_alias="accessToken")
    refresh_token: Optional[str] = Field(None, serialization_alias="refreshToken")
    token_type: str = Field(default="bearer", serialization_alias="tokenType")
    expires_in: int = Field(default=900, serialization_alias="expiresIn")


class LogoutRequest(BaseModel):
    """Logout request schema."""
    model_config = ConfigDict(populate_by_name=True)

    refresh_token: Optional[str] = Field(None, alias="refreshToken", description="Optional refresh token to revoke")


class UserCreate(BaseModel):
    """User registration schema."""
    model_config = ConfigDict(populate_by_name=True)

    email: EmailStr = Field(..., description="User email address")
    password: str = Field(..., min_length=8, description="User password")
    first_name: Optional[str] = Field("", alias="firstName")
    last_name: Optional[str] = Field("", alias="lastName")
    full_name: Optional[str] = Field(None, alias="fullName")
    role: Optional[str] = Field("user", description="User role")
    tenant_id: UUID = Field(..., alias="tenantId")


class UserResponse(BaseModel):
    """User response schema."""
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: UUID
    email: EmailStr
    first_name: Optional[str] = Field("", serialization_alias="firstName")
    last_name: Optional[str] = Field("", serialization_alias="lastName")
    full_name: Optional[str] = Field("", serialization_alias="fullName")
    role: Optional[str] = "user"
    tenant_id: Optional[UUID] = Field(None, serialization_alias="tenantId")
    is_active: bool = Field(True, serialization_alias="isActive")
