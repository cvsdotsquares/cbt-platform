"""Student signup invites (parity with Nest registration-invite.service)."""

from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

DEFAULT_INVITE_TTL_DAYS = 14


def normalize_invite_email(email: str) -> str:
    return email.strip().lower()


def hash_registration_invite_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def generate_registration_invite_token() -> str:
    return secrets.token_urlsafe(32)


def signup_url_for_token(app_url: str, plain_token: str) -> str:
    base = app_url.rstrip("/")
    return f"{base}/register?invite={plain_token}"


async def find_active_invite(db: AsyncSession, plain_token: str) -> dict[str, Any] | None:
    token = (plain_token or "").strip()
    if not token:
        return None
    row = await db.execute(
        text(
            """
            SELECT id, tenant_id, email, first_name, last_name, batch_id,
                   registration_number, expires_at, used_at
            FROM registration_invites
            WHERE token_hash = :token_hash
              AND used_at IS NULL
              AND expires_at > :now
            LIMIT 1
            """
        ),
        {"token_hash": hash_registration_invite_token(token), "now": datetime.now(timezone.utc)},
    )
    found = row.mappings().first()
    return dict(found) if found else None


async def validate_invite_token(db: AsyncSession, plain_token: str) -> dict[str, Any]:
    invite = await find_active_invite(db, plain_token)
    if not invite:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="Invite not found or expired")
    return {
        "email": invite["email"],
        "firstName": invite["first_name"],
        "lastName": invite["last_name"],
        "expiresAt": invite["expires_at"].isoformat() if invite["expires_at"] else None,
    }


async def consume_invite(db: AsyncSession, plain_token: str, email: str) -> dict[str, Any]:
    invite = await find_active_invite(db, plain_token)
    if not invite:
        from fastapi import HTTPException

        raise HTTPException(status_code=400, detail="Invite not found or expired")
    normalized = normalize_invite_email(email)
    if normalized != invite["email"]:
        from fastapi import HTTPException

        raise HTTPException(status_code=400, detail="Email must match the invited address")

    now = datetime.now(timezone.utc)
    await db.execute(
        text(
            """
            UPDATE registration_invites
            SET used_at = :now
            WHERE id = :id
            """
        ),
        {"now": now, "id": invite["id"]},
    )
    invite["used_at"] = now
    return invite


async def create_registration_invite(
    db: AsyncSession,
    *,
    tenant_id: str,
    created_by_id: str,
    email: str,
    first_name: str | None = None,
    last_name: str | None = None,
    batch_id: str | None = None,
    registration_number: str | None = None,
    expires_in_days: int | None = None,
    app_url: str,
) -> dict[str, Any]:
    from fastapi import HTTPException

    normalized = normalize_invite_email(email)
    if not normalized:
        raise HTTPException(status_code=400, detail="Email is required")

    existing = await db.execute(
        text(
            """
            SELECT id FROM users
            WHERE tenant_id = :tenant_id AND LOWER(email) = :email
            LIMIT 1
            """
        ),
        {"tenant_id": tenant_id, "email": normalized},
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Email already registered")

    pending = await db.execute(
        text(
            """
            SELECT id FROM registration_invites
            WHERE tenant_id = :tenant_id
              AND LOWER(email) = :email
              AND used_at IS NULL
              AND expires_at > :now
            LIMIT 1
            """
        ),
        {"tenant_id": tenant_id, "email": normalized, "now": datetime.now(timezone.utc)},
    )
    if pending.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="An active invite already exists for this email")

    if batch_id:
        batch = await db.execute(
            text(
                """
                SELECT id FROM batches
                WHERE id = :batch_id AND tenant_id = :tenant_id AND is_active = true
                LIMIT 1
                """
            ),
            {"batch_id": batch_id, "tenant_id": tenant_id},
        )
        if not batch.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="Batch not found")

    plain_token = generate_registration_invite_token()
    ttl = expires_in_days if expires_in_days and expires_in_days > 0 else DEFAULT_INVITE_TTL_DAYS
    expires_at = datetime.now(timezone.utc) + timedelta(days=ttl)
    invite_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)

    await db.execute(
        text(
            """
            INSERT INTO registration_invites
              (id, tenant_id, email, token_hash, first_name, last_name, batch_id,
               registration_number, expires_at, created_by_id, created_at)
            VALUES
              (:id, :tenant_id, :email, :token_hash, :first_name, :last_name, :batch_id,
               :registration_number, :expires_at, :created_by_id, :created_at)
            """
        ),
        {
            "id": invite_id,
            "tenant_id": tenant_id,
            "email": normalized,
            "token_hash": hash_registration_invite_token(plain_token),
            "first_name": (first_name or "").strip() or None,
            "last_name": (last_name or "").strip() or None,
            "batch_id": batch_id,
            "registration_number": (registration_number or "").strip() or None,
            "expires_at": expires_at,
            "created_by_id": created_by_id,
            "created_at": now,
        },
    )

    return {
        "id": invite_id,
        "email": normalized,
        "expiresAt": expires_at.isoformat(),
        "inviteToken": plain_token,
        "signupUrl": signup_url_for_token(app_url, plain_token),
    }
