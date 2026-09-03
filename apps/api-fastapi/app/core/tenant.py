"""
Tenant management for multi-tenant CBT application.
"""

from typing import Optional, Dict, Any
from fastapi import Request, HTTPException
import os

# Default tenant for single-tenant mode
DEFAULT_TENANT_ID = os.getenv("DEFAULT_TENANT_ID", "default")


def get_tenant_from_request(request: Request) -> Optional[str]:
    """
    Extract tenant identifier from request headers or subdomain.
    """
    # Option 1: From header
    tenant_id = request.headers.get("X-Tenant-ID")
    
    # Option 2: From subdomain (if using subdomain-based tenancy)
    if not tenant_id and request.url.hostname:
        host = request.url.hostname
        if host and "." in host:
            subdomain = host.split(".")[0]
            if subdomain and subdomain not in ["localhost", "www", "api"]:
                tenant_id = subdomain
    
    # Option 3: Default tenant
    if not tenant_id:
        tenant_id = DEFAULT_TENANT_ID
    
    return tenant_id


def get_current_tenant(
    request: Request,
) -> Dict[str, Any]:
    """
    Get current tenant from the request.
    Returns tenant information.
    """
    tenant_id = get_tenant_from_request(request)
    
    if not tenant_id:
        raise HTTPException(
            status_code=400,
            detail="Tenant identifier not found in request"
        )
    
    # Return tenant info
    return {
        "id": tenant_id,
        "name": tenant_id,
        "config": {
            "database_prefix": tenant_id,
            "timezone": "UTC"
        }
    }


def get_tenant_schema(tenant_id: str) -> str:
    """
    Get database schema name for a tenant.
    Useful for multi-schema database design.
    """
    return f"tenant_{tenant_id}"


def is_multi_tenant_enabled() -> bool:
    """
    Check if multi-tenancy is enabled.
    """
    return os.getenv("ENABLE_MULTI_TENANT", "false").lower() == "true"