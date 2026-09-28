from uuid import UUID
from typing import Optional, Dict, Any
from pydantic import BaseModel, ConfigDict


class TenantCreate(BaseModel):
    name: str
    slug: str
    domain: Optional[str] = None
    logo_url: Optional[str] = None
    branding: Optional[Dict[str, Any]] = None
    isolation_mode: Optional[str] = "SCHEMA"
    security_config: Optional[Dict[str, Any]] = None
    settings: Optional[Dict[str, Any]] = None


class TenantUpdate(BaseModel):
    name: Optional[str] = None
    slug: Optional[str] = None
    domain: Optional[str] = None
    logo_url: Optional[str] = None
    branding: Optional[Dict[str, Any]] = None
    isolation_mode: Optional[str] = None
    security_config: Optional[Dict[str, Any]] = None
    settings: Optional[Dict[str, Any]] = None
    is_active: Optional[bool] = None


class TenantResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    slug: str
    domain: Optional[str] = None
    logo_url: Optional[str] = None
    branding: Optional[Dict[str, Any]] = None
    isolation_mode: str = "SCHEMA"
    security_config: Optional[Dict[str, Any]] = None
    settings: Optional[Dict[str, Any]] = None
    is_active: bool = True