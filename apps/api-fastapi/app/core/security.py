# app/core/security.py
from __future__ import annotations

import hashlib
import hmac
import secrets
import sys
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, NamedTuple, Optional

import bcrypt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.database import get_db
from app.models.user import User
from app.models.user_role import UserRole

if sys.platform == "win32":
    import asyncio

    try:
        asyncio.set_event_loop_policy(
            asyncio.WindowsSelectorEventLoopPolicy()
        )
    except Exception:
        pass


# ============================================================
# BEARER AUTHENTICATION
# ============================================================

# Keep the existing variable name `oauth2_scheme` so all
# existing dependencies in this file continue to work.
#
# auto_error=False is important because get_current_user_optional()
# needs to be able to handle requests without a token.
oauth2_scheme = HTTPBearer(
    scheme_name="Bearer",
    auto_error=False,
)


# ============================================================
# ROLE PERMISSIONS MAPPING
# ============================================================

ROLE_PERMISSIONS: dict[str, list[str]] = {
    "SUPER_ADMIN": [
        "user:create", "user:read", "user:update", "user:delete", "user:assign_role",
        "session:manage", "mfa:manage",
        "tenant:create", "tenant:read", "tenant:update", "tenant:delete",
        "tenant:branding", "tenant:security_config",
        "candidate:create", "candidate:invite", "candidate:read", "candidate:update", "candidate:delete",
        "candidate:kyc_verify", "candidate:bulk_import", "candidate:admit_card",
        "question:create", "question:read", "question:update", "question:delete",
        "question:approve", "question:import", "question:export", "question:version",
        "exam:create", "exam:read", "exam:update", "exam:delete", "exam:publish",
        "exam:schedule", "exam:assign_candidates", "exam:template", "exam:view_response",
        "exam:take", "exam:submit", "exam:resume",
        "proctoring:monitor", "proctoring:intervene", "proctoring:terminate_session",
        "proctoring:view_recordings", "proctoring:manage_alerts",
        "security:view_violations", "security:configure", "security:ip_restrict", "security:geofence",
        "coding:create", "coding:execute", "coding:view_submissions", "coding:plagiarism_check",
        "result:evaluate", "result:publish", "result:read", "result:rank", "result:cutoff", "result:certificate",
        "analytics:view", "analytics:export", "audit:read", "audit:export",
        "curriculum:manage", "curriculum:read", "batch:manage", "batch:read",
        "syllabus:manage", "syllabus:read", "material:upload", "material:read", "material:delete",
        "ai:generate_test", "learning:read", "learning:manage",
    ],
    "ORG_ADMIN": [
        "user:create", "user:read", "user:update", "user:delete", "user:assign_role",
        "session:manage", "mfa:manage",
        "tenant:read", "tenant:update", "tenant:branding",
        "tenant:security_config", "tenant:create", "tenant:delete",
        "candidate:create", "candidate:invite", "candidate:read", "candidate:update", "candidate:delete",
        "candidate:kyc_verify", "candidate:bulk_import", "candidate:admit_card",
        "question:create", "question:read", "question:update", "question:delete",
        "question:approve", "question:import", "question:export", "question:version",
        "exam:create", "exam:read", "exam:update", "exam:delete", "exam:publish",
        "exam:schedule", "exam:assign_candidates", "exam:template", "exam:view_response",
        "proctoring:monitor", "proctoring:intervene", "proctoring:terminate_session",
        "proctoring:view_recordings", "proctoring:manage_alerts",
        "security:view_violations", "security:configure", "security:ip_restrict", "security:geofence",
        "coding:create", "coding:view_submissions", "coding:plagiarism_check",
        "result:evaluate", "result:publish", "result:read", "result:rank", "result:cutoff", "result:certificate",
        "analytics:view", "analytics:export", "audit:read", "audit:export",
        "curriculum:manage", "curriculum:read", "batch:manage", "batch:read",
        "syllabus:manage", "syllabus:read", "material:upload", "material:read", "material:delete",
        "ai:generate_test", "learning:read", "learning:manage",
    ],
    "EXAM_MANAGER": [
        "user:read", "tenant:read",
        "candidate:create", "candidate:invite", "candidate:read", "candidate:update", "candidate:kyc_verify",
        "candidate:bulk_import", "candidate:admit_card",
        "question:read", "question:export",
        "exam:create", "exam:read", "exam:update", "exam:delete", "exam:publish",
        "exam:schedule", "exam:assign_candidates", "exam:template", "exam:view_response",
        "proctoring:monitor", "proctoring:intervene", "proctoring:terminate_session",
        "proctoring:view_recordings", "proctoring:manage_alerts",
        "security:view_violations", "security:ip_restrict", "security:geofence",
        "coding:view_submissions", "coding:plagiarism_check",
        "result:evaluate", "result:publish", "result:read", "result:rank", "result:cutoff", "result:certificate",
        "analytics:view", "analytics:export",
    ],
    "QUESTION_MODERATOR": [
        "user:read", "tenant:read",
        "question:create", "question:read", "question:update", "question:delete",
        "question:approve", "question:import", "question:export", "question:version",
        "coding:create", "analytics:view",
    ],
    "PROCTOR": [
        "user:read", "tenant:read", "candidate:read", "exam:read",
        "proctoring:monitor", "proctoring:intervene", "proctoring:terminate_session",
        "proctoring:view_recordings", "proctoring:manage_alerts",
        "security:view_violations",
    ],
    "EVALUATOR": [
        "user:read", "tenant:read", "candidate:read", "question:read", "exam:read",
        "coding:view_submissions", "result:evaluate", "result:read",
    ],
    "CANDIDATE": [
        "user:read", "user:update", "session:manage", "mfa:manage",
        "candidate:read", "candidate:update", "candidate:admit_card",
        "exam:read", "exam:take", "exam:submit", "exam:resume", "exam:view_response",
        "coding:execute", "result:read", "result:certificate", "learning:read",
    ],
    "AUDITOR": [
        "user:read", "tenant:read", "candidate:read", "question:read", "exam:read",
        "proctoring:monitor", "proctoring:view_recordings", "security:view_violations",
        "coding:view_submissions", "coding:plagiarism_check", "result:read",
        "analytics:view", "analytics:export", "audit:read", "audit:export",
        "curriculum:read", "batch:read", "syllabus:read", "material:read", "learning:read",
    ],
    "INSTITUTE_ADMIN": [
        "user:create", "user:read", "user:update", "user:delete", "user:assign_role",
        "session:manage", "mfa:manage",
        "tenant:read", "tenant:update", "tenant:branding", "tenant:security_config",
        "candidate:create", "candidate:invite", "candidate:read", "candidate:update", "candidate:delete",
        "candidate:bulk_import",
        "question:create", "question:read", "question:update", "question:delete",
        "question:approve", "question:import", "question:export", "question:version",
        "exam:create", "exam:read", "exam:update", "exam:delete", "exam:publish",
        "exam:schedule", "exam:assign_candidates", "exam:template", "exam:view_response",
        "result:evaluate", "result:publish", "result:read", "result:rank", "result:cutoff", "result:certificate",
        "analytics:view", "analytics:export", "audit:read",
        "proctoring:monitor", "security:view_violations",
        "curriculum:manage", "curriculum:read", "batch:manage", "batch:read",
        "syllabus:manage", "syllabus:read", "material:upload", "material:read", "material:delete",
        "ai:generate_test", "learning:read", "learning:manage",
    ],
    "TEACHER": [
        "candidate:invite", "candidate:read", "candidate:update", "curriculum:read", "batch:read",
        "syllabus:manage", "syllabus:read", "question:read", "question:update",
        "exam:create", "exam:read", "exam:update", "exam:publish", "exam:schedule",
        "exam:assign_candidates", "exam:view_response",
        "result:read", "result:evaluate", "result:publish", "result:rank",
        "proctoring:monitor", "security:view_violations", "analytics:view",
        "material:read", "ai:generate_test", "learning:read", "learning:manage",
    ],
    "STUDENT": [
        "user:read", "user:update", "session:manage", "mfa:manage",
        "candidate:read", "candidate:update",
        "exam:read", "exam:take", "exam:submit", "exam:resume", "exam:view_response",
        "result:read", "curriculum:read", "syllabus:read", "learning:read",
        "ai:generate_test",
    ],
}

# Add lowercase aliases and common synonyms
ROLE_PERMISSIONS["ADMIN"] = ROLE_PERMISSIONS["ORG_ADMIN"]

ROLE_PERMISSIONS["USER"] = [
    "user:read",
    "user:update",
    "session:manage",
    "exam:read",
    "exam:take",
    "exam:submit",
    "exam:resume",
    "result:read",
]

ROLE_PERMISSIONS["EXAM_CREATOR"] = [
    "exam:create",
    "exam:read",
    "exam:update",
    "exam:delete",
    "exam:publish",
    "exam:schedule",
    "exam:assign_candidates",
    "question:read",
    "question:create",
]


def loaded_role_names(user: User) -> list[str]:
    """Read role names already eager-loaded on the user.

    Do not touch User.roles here. That relationship is lazy="select",
    which issues a sync SQL query and raises MissingGreenlet under asyncio.
    get_current_user already selectinload()s user_roles -> role.
    """
    names: list[str] = []
    for user_role in getattr(user, "user_roles", None) or []:
        role = getattr(user_role, "role", None)
        name = getattr(role, "name", None) if role is not None else None
        if name:
            names.append(name)
    return names


def get_permissions_for_roles(roles: list[str]) -> list[str]:
    """Retrieve union of permissions for given role names."""
    permissions: set[str] = set()

    for role in roles:
        role_key = role.upper()

        if role_key in ROLE_PERMISSIONS:
            for perm in ROLE_PERMISSIONS[role_key]:
                permissions.add(perm)

    return list(permissions)


def has_permission(roles: list[str], permission: str) -> bool:
    """Check if any of the given roles has the required permission."""
    return permission in get_permissions_for_roles(roles)


# ============================================================
# PASSWORD HASHING AND VERIFICATION
# ============================================================

def hash_password(password: str) -> str:
    """Hash a password using bcrypt."""
    salt = bcrypt.gensalt(
        rounds=settings.BCRYPT_ROUNDS
        if hasattr(settings, "BCRYPT_ROUNDS")
        else 10
    )

    return bcrypt.hashpw(
        password.encode("utf-8"),
        salt,
    ).decode("utf-8")


def get_password_hash(password: str) -> str:
    """Alias for hash_password."""
    return hash_password(password)


def verify_password(
    plain_password: str,
    hashed_password: str,
) -> bool:
    """Verify a plain password against bcrypt or legacy pbkdf2_sha256 hash."""

    if not hashed_password:
        return False

    # Handle legacy pbkdf2_sha256 format:
    # pbkdf2_sha256$<iterations>$<salt_hex>$<hash_hex>
    if hashed_password.startswith("pbkdf2_sha256$"):
        try:
            parts = hashed_password.split("$")

            if len(parts) == 4:
                _, iter_str, salt_hex, hash_hex = parts

                iterations = int(iter_str)
                salt = bytes.fromhex(salt_hex)

                computed_hash = hashlib.pbkdf2_hmac(
                    "sha256",
                    plain_password.encode("utf-8"),
                    salt,
                    iterations,
                ).hex()

                return hmac.compare_digest(
                    computed_hash,
                    hash_hex,
                )

        except Exception:
            return False

    # Bcrypt verification
    try:
        return bcrypt.checkpw(
            plain_password.encode("utf-8"),
            hashed_password.encode("utf-8"),
        )
    except Exception:
        return False


# ============================================================
# JWT TOKEN GENERATION & VERIFICATION
# ============================================================

def create_access_token(
    data: dict[str, Any],
    expires_delta: timedelta | None = None,
) -> str:
    """Create a JWT access token."""

    to_encode = data.copy()

    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(
            minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES
        )

    to_encode.update({
        "exp": int(expire.timestamp())
    })

    encoded_jwt = jwt.encode(
        to_encode,
        settings.JWT_SECRET,
        algorithm=settings.JWT_ALGORITHM,
    )

    return encoded_jwt


def create_refresh_token(
    data: dict[str, Any],
    expires_delta: timedelta | None = None,
) -> str:
    """Create a JWT refresh token."""

    to_encode = data.copy()

    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(
            hours=settings.REFRESH_TOKEN_EXPIRE_HOURS
        )

    to_encode.update({
        "exp": int(expire.timestamp()),
        "type": "refresh",
        "jti": to_encode.get("jti") or str(uuid.uuid4()),
    })

    encoded_jwt = jwt.encode(
        to_encode,
        settings.JWT_SECRET,
        algorithm=settings.JWT_ALGORITHM,
    )

    return encoded_jwt


def verify_refresh_token(
    token: str,
) -> dict[str, Any] | None:
    """Verify a refresh token."""

    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET,
            algorithms=[settings.JWT_ALGORITHM],
        )

        if payload.get("type") != "refresh":
            return None

        return payload

    except Exception:
        return None


# ============================================================
# USER DEPENDENCIES
# ============================================================

async def get_current_user_optional(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(
        oauth2_scheme
    ),
    db: AsyncSession = Depends(get_db),
) -> Optional[User]:
    """
    Get authenticated user if a Bearer token is provided.
    Return None when no token is provided.
    """

    if not credentials:
        return None

    token = credentials.credentials

    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET,
            algorithms=[settings.JWT_ALGORITHM],
        )

        user_id = payload.get("sub")

        if not user_id:
            return None

        result = await db.execute(
            select(User)
            .options(
                selectinload(User.user_roles).selectinload(UserRole.role),
            )
            .where(
                User.id == str(user_id),
                User.is_active == True,
            )
        )

        return result.scalar_one_or_none()

    except Exception:
        return None


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(
        oauth2_scheme
    ),
    db: AsyncSession = Depends(get_db),
) -> User:
    """
    Get current authenticated user from JWT Bearer token.
    """

    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    if not credentials:
        raise credentials_exception

    token = credentials.credentials

    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET,
            algorithms=[settings.JWT_ALGORITHM],
        )

        user_id: str = payload.get("sub")

        if not user_id:
            raise credentials_exception

        result = await db.execute(
            select(User)
            .options(
                selectinload(User.user_roles).selectinload(UserRole.role),
            )
            .where(
                User.id == str(user_id),
                User.is_active == True,
            )
        )

        user = result.scalar_one_or_none()

        if user is None:
            raise credentials_exception

        return user

    except HTTPException:
        raise

    except Exception:
        raise credentials_exception


class TenantContext(NamedTuple):
    id: str
    name: str


async def _fetch_active_tenant(db: AsyncSession, tenant_id: str) -> TenantContext | None:
    result = await db.execute(
        text(
            """
            SELECT id, name
            FROM tenants
            WHERE id = :tenant_id AND is_active = true
            """
        ),
        {"tenant_id": tenant_id},
    )
    row = result.mappings().first()
    if not row:
        return None
    return TenantContext(id=str(row["id"]), name=row["name"])


async def get_current_tenant(
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional),
) -> Optional[TenantContext]:
    """Get current tenant from header or current authenticated user."""

    tenant_header = request.headers.get("X-Tenant-ID")

    if tenant_header:
        try:
            tenant_id = str(uuid.UUID(tenant_header))
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid tenant ID format",
            )

        tenant = await _fetch_active_tenant(db, tenant_id)
        if not tenant:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Tenant not found or inactive",
            )
        return tenant

    if current_user and current_user.tenant_id:
        tenant = await _fetch_active_tenant(db, str(current_user.tenant_id))
        if not tenant:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Tenant not found or inactive",
            )
        return tenant

    return None


# ============================================================
# RBAC DEPENDENCY FACTORIES
# ============================================================

def require_role(required_roles: list[str] | str):
    """Dependency factory checking if user has any of required roles."""

    if isinstance(required_roles, str):
        required_roles = [required_roles]

    normalized_required = {
        r.strip().upper()
        for r in required_roles
    }

    async def role_checker(
        current_user: User = Depends(get_current_user),
    ) -> User:

        user_roles = [
            name.strip().upper()
            for name in loaded_role_names(current_user)
        ]

        # Match any directly or through admin alias
        has_matching_role = any(
            r in normalized_required
            for r in user_roles
        )

        # Allow super_admin or admin to access admin-level operations
        if (
            "ADMIN" in normalized_required
            and (
                "ORG_ADMIN" in user_roles
                or "SUPER_ADMIN" in user_roles
            )
        ):
            has_matching_role = True

        if (
            "ORG_ADMIN" in normalized_required
            and (
                "ADMIN" in user_roles
                or "SUPER_ADMIN" in user_roles
            )
        ):
            has_matching_role = True

        if not has_matching_role:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    f"User does not have required role(s): "
                    f"{required_roles}"
                ),
            )

        return current_user

    return role_checker


def require_permission(required_permissions: list[str] | str):
    """Dependency factory checking if user has any required permissions."""

    if isinstance(required_permissions, str):
        required_permissions = [required_permissions]

    async def permission_checker(
        current_user: User = Depends(get_current_user),
    ) -> User:

        user_roles = loaded_role_names(current_user)

        # Check permissions mapped to user's roles
        user_perms = set(
            get_permissions_for_roles(user_roles)
        )

        has_any = any(
            permission in user_perms
            for permission in required_permissions
        )

        # Super admin bypass
        if any(
            role.upper()
            in {"ADMIN", "SUPER_ADMIN", "ORG_ADMIN"}
            for role in user_roles
        ):
            has_any = True

        if not has_any:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    f"User does not have required permission(s): "
                    f"{required_permissions}"
                ),
            )

        return current_user

    return permission_checker


def get_current_active_user(
    current_user: User = Depends(get_current_user),
) -> User:
    """Get active user."""

    if not current_user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Inactive user",
        )

    return current_user


def get_current_superuser(
    current_user: User = Depends(get_current_user),
) -> User:
    """Get superuser."""

    if not current_user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Superuser privileges required",
        )

    return current_user