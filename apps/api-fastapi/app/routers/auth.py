from typing import Any
import asyncio
import json
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.tenant import DEFAULT_TENANT_ID
from app.core.security import (
    create_access_token,
    create_refresh_token,
    get_current_user,
    get_password_hash,
    verify_password,
    verify_refresh_token,
)
from app.models.role import Role
from app.models.tenant import Tenant
from app.models.user import User
from app.models.user_role import UserRole
from app.schemas.auth import (
    LoginRequest,
    LoginResponse,
    RefreshTokenRequest,
    RefreshTokenResponse,
    InviteValidateRequest,
    UserCreate,
    UserResponse,
    AuthUserResponse,
)
from app.services.registration_invite import (
    consume_invite,
    find_active_invite,
    normalize_invite_email,
    validate_invite_token,
)

router = APIRouter(
    prefix="/auth",
    tags=["authentication"],
)


async def _fetch_user_for_login(
    db: AsyncSession,
    email: str,
    tenant_id: str | None = None,
) -> dict[str, Any] | None:
    params: dict[str, str] = {"email": email}
    tenant_clause = ""
    if tenant_id:
        tenant_clause = " AND u.tenant_id = :tenant_id"
        params["tenant_id"] = tenant_id

    result = await db.execute(
        text(
            f"""
            SELECT u.id, u.email, u.password_hash, u.first_name, u.last_name,
                   u.tenant_id, u.is_active, u.mfa_enabled
            FROM users u
            WHERE LOWER(u.email) = :email
              AND u.is_active = TRUE
              {tenant_clause}
            LIMIT 1
            """
        ),
        params,
    )
    row = result.mappings().first()
    return dict(row) if row else None


async def _fetch_role_names(db: AsyncSession, user_id: str) -> list[str]:
    result = await db.execute(
        text(
            """
            SELECT r.name
            FROM user_roles ur
            JOIN roles r ON r.id::text = ur.role_id::text
            WHERE ur.user_id::text = :user_id
              AND r.is_active = TRUE
            ORDER BY r.name
            """
        ),
        {"user_id": user_id},
    )
    return [row.name for row in result.all()]


async def _record_successful_login(
    db: AsyncSession,
    user_id: str,
    *,
    ip_address: str,
    user_agent: str,
    device_fingerprint: str,
) -> None:
    now = datetime.now(timezone.utc)
    await db.execute(
        text(
            """
            UPDATE users
            SET last_login_at = :now,
                failed_attempts = 0,
                locked_until = NULL,
                updated_at = :now
            WHERE id = :user_id
            """
        ),
        {"now": now, "user_id": user_id},
    )
    # DB may match Prisma (created_at only) or Alembic (created_at + updated_at).
    await db.execute(
        text(
            """
            INSERT INTO login_history (
                id, user_id, ip_address, user_agent, device_fingerprint,
                success, created_at
            )
            VALUES (
                :id, :user_id, :ip_address, :user_agent, :device_fingerprint,
                TRUE, :now
            )
            """
        ),
        {
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "ip_address": ip_address[:64],
            "user_agent": user_agent[:512],
            "device_fingerprint": device_fingerprint[:255],
            "now": now,
        },
    )


# ============================================================
# LOGIN
# ============================================================

@router.post(
    "/login",
    response_model=LoginResponse,
    response_model_by_alias=True,
)
async def login(
    body: LoginRequest,
    http_request: Request,
    db: AsyncSession = Depends(get_db),
) -> Any:

    # --------------------------------------------------------
    # Build user query
    # --------------------------------------------------------

    email = body.email.strip().lower()
    tenant_id: str | None = None

    if body.tenant_id:
        tenant_id = str(body.tenant_id).strip()
        try:
            uuid.UUID(tenant_id)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid tenant ID",
            )

    user = await _fetch_user_for_login(db, email, tenant_id)

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
        )

    password_ok = await asyncio.to_thread(
        verify_password,
        body.password,
        user["password_hash"],
    )
    if not password_ok:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
        )

    client_host = http_request.client.host if http_request.client else "unknown"
    await _record_successful_login(
        db,
        str(user["id"]),
        ip_address=client_host,
        user_agent=http_request.headers.get("user-agent", "unknown"),
        device_fingerprint=body.device_fingerprint or "unknown",
    )

    roles = await _fetch_role_names(db, str(user["id"]))
    role = roles[0] if roles else "user"

    token_data = {
        "sub": str(user["id"]),
        "tenant_id": str(user["tenant_id"]),
        "tenantId": str(user["tenant_id"]),
        "email": user["email"],
        "role": role,
        "roles": roles,
        "firstName": user["first_name"] or "",
        "lastName": user["last_name"] or "",
    }

    # --------------------------------------------------------
    # Create tokens
    # --------------------------------------------------------

    access_token = create_access_token(
        data=token_data
    )

    refresh_token = create_refresh_token(
        data={
            "sub": str(user["id"]),
            "tenant_id": str(user["tenant_id"]),
        }
    )

    # --------------------------------------------------------
    # Response
    # --------------------------------------------------------

    return LoginResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        token_type="bearer",
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        user=AuthUserResponse(
            id=user["id"],
            email=user["email"],
            first_name=user["first_name"],
            last_name=user["last_name"],
            tenant_id=user["tenant_id"],
            role=role,
            roles=roles,
            is_active=user["is_active"],
            mfa_enabled=user["mfa_enabled"],
        ),
    )


# ============================================================
# INVITE VALIDATION
# ============================================================

@router.post("/invite/validate")
async def validate_registration_invite(
    body: InviteValidateRequest,
    db: AsyncSession = Depends(get_db),
) -> Any:
    return await validate_invite_token(db, body.invite_code)


# ============================================================
# REGISTER
# ============================================================

@router.post(
    "/register",
    response_model=UserResponse,
    status_code=status.HTTP_201_CREATED,
)
async def register(
    user_data: UserCreate,
    db: AsyncSession = Depends(get_db),
) -> Any:

    email = normalize_invite_email(str(user_data.email))
    invite_batch_id: str | None = None
    invite_registration_number: str | None = None
    invite_tenant_id: str | None = None
    invite_code = (user_data.invite_code or "").strip()

    if invite_code:
        pending = await find_active_invite(db, invite_code)
        if not pending:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invite not found or expired",
            )
        if email != pending["email"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email must match the invited address",
            )
        invite_tenant_id = str(pending["tenant_id"])
        invite_batch_id = pending.get("batch_id")
        invite_registration_number = pending.get("registration_number")

    # --------------------------------------------------------
    # 1. Check tenant
    # --------------------------------------------------------

    if invite_tenant_id:
        tenant_result = await db.execute(
            select(Tenant).where(Tenant.id == invite_tenant_id, Tenant.is_active.is_(True))
        )
    else:
        tenant_filter = (
            Tenant.id == str(user_data.tenant_id)
            if user_data.tenant_id
            else Tenant.slug == DEFAULT_TENANT_ID
        )
        tenant_result = await db.execute(select(Tenant).where(tenant_filter))

    tenant = tenant_result.scalar_one_or_none()

    if not tenant:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Tenant not found",
        )

    # --------------------------------------------------------
    # 2. Check duplicate email
    # --------------------------------------------------------

    result = await db.execute(
        select(User).where(
            User.email == email,
            User.tenant_id == tenant.id,
        )
    )

    existing_user = result.scalar_one_or_none()

    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="User with this email already exists",
        )

    if invite_code:
        await consume_invite(db, invite_code, email)

    # --------------------------------------------------------
    # 3. Find role inside this tenant
    # --------------------------------------------------------

    role_name = (user_data.role or "CANDIDATE").strip().upper()

    role_result = await db.execute(
        select(Role).where(
            Role.name == role_name,
            or_(Role.tenant_id == tenant.id, Role.tenant_id.is_(None)),
            Role.is_active.is_(True),
        )
    )

    role = role_result.scalar_one_or_none()

    if not role:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Role '{role_name}' does not exist "
                "for this tenant"
            ),
        )

    # --------------------------------------------------------
    # 4. Split full_name if provided
    # --------------------------------------------------------

    first_name = user_data.first_name or ""
    last_name = user_data.last_name or ""

    if user_data.full_name and not (
        user_data.first_name or user_data.last_name
    ):
        parts = user_data.full_name.strip().split()

        if parts:
            first_name = parts[0]
            last_name = " ".join(parts[1:])

    # --------------------------------------------------------
    # 5. Hash password
    # --------------------------------------------------------

    password_hash = get_password_hash(
        user_data.password
    )

    # --------------------------------------------------------
    # 6. Create user
    # --------------------------------------------------------

    new_user = User(
        email=email,
        first_name=first_name,
        last_name=last_name,
        password_hash=password_hash,
        tenant_id=tenant.id,
        is_active=True,
    )

    db.add(new_user)

    # Flush first so new_user.id is generated
    await db.flush()

    # --------------------------------------------------------
    # 7. Assign role
    # --------------------------------------------------------

    user_role = UserRole(
        user_id=new_user.id,
        role_id=role.id,
    )

    db.add(user_role)

    candidate_id = str(uuid.uuid4())
    reg_no = (invite_registration_number or "").strip() or f"STU-{uuid.uuid4().hex[:8].upper()}"
    profile_source = "invite" if user_data.invite_code else "self"

    await db.execute(
        text(
            """
            INSERT INTO candidates
              (id, tenant_id, user_id, registration_number, kyc_status, profile_data, created_at, updated_at)
            VALUES
              (:id, :tenant_id, :user_id, :registration_number, 'NOT_SUBMITTED',
               CAST(:profile_data AS jsonb), :now, :now)
            """
        ),
        {
            "id": candidate_id,
            "tenant_id": str(tenant.id),
            "user_id": str(new_user.id),
            "registration_number": reg_no,
            "profile_data": json.dumps({"registrationSource": profile_source}),
            "now": new_user.created_at,
        },
    )

    if invite_batch_id:
        await db.execute(
            text(
                """
                INSERT INTO batch_enrollments (id, batch_id, candidate_id, enrolled_at)
                VALUES (:id, :batch_id, :candidate_id, :now)
                """
            ),
            {
                "id": str(uuid.uuid4()),
                "batch_id": invite_batch_id,
                "candidate_id": candidate_id,
                "now": new_user.created_at,
            },
        )

    # --------------------------------------------------------
    # 8. Commit
    # --------------------------------------------------------

    try:
        await db.commit()

    except Exception:
        await db.rollback()

        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create user",
        )

    # --------------------------------------------------------
    # 9. Refresh
    # --------------------------------------------------------

    await db.refresh(new_user)

    return UserResponse(
        id=new_user.id,
        email=new_user.email,
        first_name=new_user.first_name,
        last_name=new_user.last_name,
        full_name=new_user.full_name,
        role=role.name,
        tenant_id=new_user.tenant_id,
        is_active=new_user.is_active,
    )


# ============================================================
# REFRESH TOKEN
# ============================================================

@router.post(
    "/refresh",
    response_model=RefreshTokenResponse,
    response_model_by_alias=True,
)
async def refresh_token(
    request: RefreshTokenRequest,
    db: AsyncSession = Depends(get_db),
) -> Any:

    payload = verify_refresh_token(
        request.refresh_token
    )

    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token",
        )

    user_id = payload.get("sub")

    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token payload",
        )

    result = await db.execute(
        text(
            """
            SELECT id, email, first_name, last_name, tenant_id, is_active
            FROM users
            WHERE id::text = :user_id AND is_active = TRUE
            LIMIT 1
            """
        ),
        {"user_id": str(user_id)},
    )
    user = result.mappings().first()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive",
        )

    roles = await _fetch_role_names(db, str(user["id"]))
    role = roles[0] if roles else "user"

    token_data = {
        "sub": str(user["id"]),
        "tenant_id": str(user["tenant_id"]),
        "tenantId": str(user["tenant_id"]),
        "email": user["email"],
        "role": role,
        "roles": roles,
        "firstName": user["first_name"] or "",
        "lastName": user["last_name"] or "",
    }

    new_access_token = create_access_token(
        data=token_data
    )

    return RefreshTokenResponse(
        access_token=new_access_token,
        refresh_token=request.refresh_token,
        token_type="bearer",
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )


# ============================================================
# LOGOUT
# ============================================================

@router.post("/logout")
async def logout(
    current_user: User = Depends(get_current_user),
) -> dict:

    return {
        "message": "Successfully logged out"
    }


# ============================================================
# CURRENT USER
# ============================================================

@router.get(
    "/me",
    response_model=UserResponse,
)
async def get_current_user_info(
    current_user: User = Depends(get_current_user),
) -> Any:

    roles = [
        user_role.role.name
        for user_role in current_user.user_roles
        if user_role.role and user_role.role.is_active
    ]

    role = roles[0] if roles else "user"

    return UserResponse(
        id=current_user.id,
        email=current_user.email,
        first_name=current_user.first_name,
        last_name=current_user.last_name,
        full_name=current_user.full_name,
        role=role,
        tenant_id=current_user.tenant_id,
        is_active=current_user.is_active,
    )