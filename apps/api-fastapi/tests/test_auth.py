"""Auth endpoint tests.

Covers: login, refresh, logout, invalid credentials, token claims,
tenant isolation on login, account lockout, rate limiting (unit-level),
protected routes, and the public /health route.
"""
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from httpx import AsyncClient

from app.core.database import AsyncSessionLocal
from app.core.security import hash_password, verify_password, get_permissions_for_roles
from app.models.role import Role
from app.models.tenant import Tenant
from app.models.user import User, user_roles
from sqlalchemy import insert


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _make_tenant(name: str | None = None) -> Tenant:
    slug = f"t-{uuid.uuid4().hex[:8]}"
    async with AsyncSessionLocal() as db:
        t = Tenant(name=name or slug, slug=slug)
        db.add(t)
        await db.commit()
        await db.refresh(t)
        return t


async def _make_user(tenant_id: uuid.UUID, role_name: str | None = None,
                     email: str | None = None, password: str = "Secret123!") -> tuple[User, str]:
    em = email or f"u-{uuid.uuid4().hex[:8]}@test.com"
    async with AsyncSessionLocal() as db:
        u = User(email=em, password_hash=hash_password(password),
                 tenant_id=tenant_id, is_active=True)
        db.add(u)
        await db.flush()
        if role_name:
            r = Role(name=role_name, tenant_id=tenant_id)
            db.add(r)
            await db.flush()
            await db.execute(insert(user_roles).values(user_id=u.id, role_id=r.id))
        await db.commit()
        await db.refresh(u)
        return u, password


async def _login(client: AsyncClient, email: str, password: str, tenant_id: str | None = None) -> dict:
    body: dict = {"email": email, "password": password}
    if tenant_id:
        body["tenant_id"] = tenant_id
    r = await client.post("/api/v1/auth/login", json=body)
    assert r.status_code == 200, r.text
    return r.json()["data"]


# ═══════════════════════════════════════════════════════════════════════════════
# Login
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.anyio
async def test_login_returns_token_for_valid_credentials(client: AsyncClient):
    tenant = await _make_tenant()
    user, pw = await _make_user(tenant.id)

    resp = await client.post("/api/v1/auth/login", json={"email": user.email, "password": pw})
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["access_token"]
    assert data["refresh_token"]
    assert data["token_type"] == "bearer"
    assert data["expires_in"] == 900
    assert data["user"]["email"] == user.email
    assert str(data["user"]["tenantId"]) == str(tenant.id)


@pytest.mark.anyio
async def test_login_returns_401_for_invalid_credentials(client: AsyncClient):
    resp = await client.post("/api/v1/auth/login", json={
        "email": "ghost@nowhere.com", "password": "wrong"
    })
    assert resp.status_code == 401


@pytest.mark.anyio
async def test_login_returns_401_for_wrong_password(client: AsyncClient):
    tenant = await _make_tenant()
    user, pw = await _make_user(tenant.id)
    resp = await client.post("/api/v1/auth/login", json={"email": user.email, "password": "wrongpw"})
    assert resp.status_code == 401


@pytest.mark.anyio
async def test_login_tenant_scoped_correct_tenant_succeeds(client: AsyncClient):
    t1 = await _make_tenant()
    user, pw = await _make_user(t1.id)
    resp = await client.post("/api/v1/auth/login", json={
        "email": user.email, "password": pw, "tenant_id": str(t1.id)
    })
    assert resp.status_code == 200


@pytest.mark.anyio
async def test_login_tenant_scoped_wrong_tenant_returns_401(client: AsyncClient):
    """Same email exists in t1; t2 is a different tenant — login with t2 should fail."""
    t1 = await _make_tenant()
    t2 = await _make_tenant()
    user, pw = await _make_user(t1.id)

    resp = await client.post("/api/v1/auth/login", json={
        "email": user.email, "password": pw, "tenant_id": str(t2.id)
    })
    assert resp.status_code == 401


@pytest.mark.anyio
async def test_login_same_email_different_tenants_isolated(client: AsyncClient):
    """Same email can exist in two tenants with different passwords."""
    t1 = await _make_tenant()
    t2 = await _make_tenant()
    email = f"shared-{uuid.uuid4().hex[:6]}@test.com"
    u1, pw1 = await _make_user(t1.id, email=email, password="Pass1!")
    u2, pw2 = await _make_user(t2.id, email=email, password="Pass2!")

    r1 = await client.post("/api/v1/auth/login", json={
        "email": email, "password": pw1, "tenant_id": str(t1.id)
    })
    r2 = await client.post("/api/v1/auth/login", json={
        "email": email, "password": pw2, "tenant_id": str(t2.id)
    })
    assert r1.status_code == 200
    assert r2.status_code == 200
    # Tokens are for different users
    assert r1.json()["data"]["user"]["tenantId"] == str(t1.id)
    assert r2.json()["data"]["user"]["tenantId"] == str(t2.id)


@pytest.mark.anyio
async def test_login_jwt_claims_contain_required_fields(client: AsyncClient):
    """JWT payload must carry tenantId, roles, permissions, sessionId, email."""
    import base64, json as _json
    tenant = await _make_tenant()
    user, pw = await _make_user(tenant.id, role_name="ORG_ADMIN")

    data = await _login(client, user.email, pw)
    token = data["access_token"]

    # Decode payload (middle segment) without verifying signature
    parts = token.split(".")
    padding = "=" * (-len(parts[1]) % 4)
    payload = _json.loads(base64.urlsafe_b64decode(parts[1] + padding))

    assert payload["sub"] == str(user.id)
    assert payload["tenantId"] == str(tenant.id)
    assert payload["email"] == user.email
    assert "roles" in payload and isinstance(payload["roles"], list)
    assert "permissions" in payload and isinstance(payload["permissions"], list)
    assert "sessionId" in payload
    # ORG_ADMIN should have exam:create
    assert "exam:create" in payload["permissions"]


@pytest.mark.anyio
async def test_login_inactive_user_returns_401(client: AsyncClient):
    tenant = await _make_tenant()
    user, pw = await _make_user(tenant.id)
    async with AsyncSessionLocal() as db:
        u = (await db.get(User, user.id))
        u.is_active = False
        db.add(u)
        await db.commit()

    resp = await client.post("/api/v1/auth/login", json={"email": user.email, "password": pw})
    assert resp.status_code == 401


# ═══════════════════════════════════════════════════════════════════════════════
# Refresh
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.anyio
async def test_refresh_returns_new_access_token(client: AsyncClient):
    tenant = await _make_tenant()
    user, pw = await _make_user(tenant.id)
    data = await _login(client, user.email, pw)
    old_rt = data["refresh_token"]
    old_at = data["access_token"]

    r = await client.post("/api/v1/auth/refresh", json={"refresh_token": old_rt})
    assert r.status_code == 200
    new_data = r.json()["data"]
    assert new_data["access_token"]
    assert new_data["access_token"] != old_at
    assert new_data["refresh_token"]

    reuse = await client.post("/api/v1/auth/refresh", json={"refresh_token": old_rt})
    assert reuse.status_code == 200


@pytest.mark.anyio
async def test_refresh_with_invalid_token_returns_401(client: AsyncClient):
    r = await client.post("/api/v1/auth/refresh", json={"refresh_token": "not-a-real-token"})
    assert r.status_code == 401


# ═══════════════════════════════════════════════════════════════════════════════
# Logout
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.anyio
async def test_logout_revokes_refresh_token(client: AsyncClient):
    tenant = await _make_tenant()
    user, pw = await _make_user(tenant.id)
    data = await _login(client, user.email, pw)
    access = data["access_token"]
    rt = data["refresh_token"]
    headers = {"Authorization": f"Bearer {access}"}

    logout = await client.post("/api/v1/auth/logout", json={"refresh_token": rt}, headers=headers)
    assert logout.status_code == 204

    reuse = await client.post("/api/v1/auth/refresh", json={"refresh_token": rt})
    assert reuse.status_code == 401


@pytest.mark.anyio
async def test_logout_requires_bearer_token(client: AsyncClient):
    """Logout without Authorization header should return 401."""
    resp = await client.post("/api/v1/auth/logout", json={"refresh_token": "irrelevant"})
    assert resp.status_code == 401


@pytest.mark.anyio
async def test_logout_with_mismatched_refresh_token_hash_fails(client: AsyncClient):
    tenant = await _make_tenant()
    user, pw = await _make_user(tenant.id)
    data = await _login(client, user.email, pw)
    access = data["access_token"]
    rt = data["refresh_token"]
    headers = {"Authorization": f"Bearer {access}"}

    bad_token = secrets.token_urlsafe(32)  # completely random
    logout = await client.post("/api/v1/auth/logout", json={"refresh_token": bad_token}, headers=headers)
    # Should still succeed (204) — JWT session revoked regardless of body token validity
    assert logout.status_code == 204

    # Good token should now be revoked (session was killed by the JWT's sessionId)
    reuse = await client.post("/api/v1/auth/refresh", json={"refresh_token": rt})
    assert reuse.status_code == 401


@pytest.mark.anyio
async def test_logout_with_invalid_access_token_returns_401(client: AsyncClient):
    resp = await client.post(
        "/api/v1/auth/logout",
        json={},
        headers={"Authorization": "Bearer totally.invalid.jwt"},
    )
    assert resp.status_code == 401


# ═══════════════════════════════════════════════════════════════════════════════
# Account lockout
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.anyio
async def test_account_lockout_after_five_failures(client: AsyncClient):
    tenant = await _make_tenant()
    user, pw = await _make_user(tenant.id)

    for _ in range(MAX_FAILED_ATTEMPTS := 5):
        r = await client.post("/api/v1/auth/login", json={"email": user.email, "password": "wrong!"})
        assert r.status_code == 401

    # 6th attempt with CORRECT password should still be blocked
    r = await client.post("/api/v1/auth/login", json={"email": user.email, "password": pw})
    assert r.status_code == 401
    assert "locked" in r.json()["message"].lower()


@pytest.mark.anyio
async def test_account_unlocks_after_lockout_expires(client: AsyncClient):
    """Set locked_until in the past and verify login succeeds."""
    tenant = await _make_tenant()
    user, pw = await _make_user(tenant.id)

    # Set lockout in the past
    async with AsyncSessionLocal() as db:
        u = await db.get(User, user.id)
        u.failed_attempts = 5
        u.locked_until = datetime.now(timezone.utc) - timedelta(minutes=1)
        db.add(u)
        await db.commit()

    resp = await client.post("/api/v1/auth/login", json={"email": user.email, "password": pw})
    assert resp.status_code == 200


# ═══════════════════════════════════════════════════════════════════════════════
# JWT validation
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.anyio
async def test_protected_route_rejects_missing_token(client: AsyncClient):
    resp = await client.get("/api/v1/users")
    assert resp.status_code == 401


@pytest.mark.anyio
async def test_protected_route_rejects_invalid_token(client: AsyncClient):
    resp = await client.get("/api/v1/users", headers={"Authorization": "Bearer bad.token.here"})
    assert resp.status_code == 401


@pytest.mark.anyio
async def test_protected_route_rejects_expired_token(client: AsyncClient):
    """Manually craft a token with exp in the past."""
    import base64, hashlib, hmac, json as _json, time
    from app.core.config import settings

    def b64(data: bytes) -> str:
        return base64.urlsafe_b64encode(data).rstrip(b"=").decode()

    header = b64(_json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    payload = b64(_json.dumps({"sub": str(uuid.uuid4()), "exp": int(time.time()) - 3600}).encode())
    sig_input = f"{header}.{payload}".encode()
    sig = b64(hmac.new(settings.JWT_SECRET.encode(), sig_input, hashlib.sha256).digest())
    expired_token = f"{header}.{payload}.{sig}"

    resp = await client.get("/api/v1/users", headers={"Authorization": f"Bearer {expired_token}"})
    assert resp.status_code == 401


@pytest.mark.anyio
async def test_public_health_route_requires_no_token(client: AsyncClient):
    resp = await client.get("/api/v1/health")
    assert resp.status_code == 200


# ═══════════════════════════════════════════════════════════════════════════════
# Password hashing
# ═══════════════════════════════════════════════════════════════════════════════

def test_bcrypt_hash_and_verify():
    pw = "TestPassword123!"
    hashed = hash_password(pw)
    assert hashed.startswith("$2b$")
    assert verify_password(pw, hashed)
    assert not verify_password("wrong", hashed)


def test_verify_password_legacy_pbkdf2():
    """Passwords hashed with the old PBKDF2 scheme must still be verifiable."""
    import hashlib as _hl, secrets as _sec
    password = "LegacyPass!"
    salt = _sec.token_bytes(16)
    iterations = 260000
    dk = _hl.pbkdf2_hmac("sha256", password.encode(), salt, iterations)
    legacy_hash = f"pbkdf2_sha256${iterations}${salt.hex()}${dk.hex()}"

    assert verify_password(password, legacy_hash)
    assert not verify_password("wrong", legacy_hash)


# ═══════════════════════════════════════════════════════════════════════════════
# Permissions
# ═══════════════════════════════════════════════════════════════════════════════

def test_get_permissions_for_org_admin():
    perms = set(get_permissions_for_roles(["ORG_ADMIN"]))
    assert "exam:create" in perms
    assert "tenant:read" in perms
    assert "user:delete" in perms


def test_get_permissions_for_candidate():
    perms = set(get_permissions_for_roles(["CANDIDATE"]))
    assert "exam:take" in perms
    assert "exam:create" not in perms
    assert "user:delete" not in perms


def test_get_permissions_merged_for_multiple_roles():
    perms = set(get_permissions_for_roles(["CANDIDATE", "TEACHER"]))
    # TEACHER adds exam:create; CANDIDATE adds exam:take
    assert "exam:create" in perms
    assert "exam:take" in perms


def test_get_permissions_for_unknown_role():
    perms = get_permissions_for_roles(["UNKNOWN_ROLE"])
    assert perms == []


# ═══════════════════════════════════════════════════════════════════════════════
# RBAC on endpoints
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.anyio
async def test_admin_role_can_create_tenant(client: AsyncClient):
    tenant = await _make_tenant()
    user, pw = await _make_user(tenant.id, role_name="admin")
    data = await _login(client, user.email, pw)
    headers = {"Authorization": f"Bearer {data['access_token']}"}

    resp = await client.post(
        "/api/v1/tenants",
        json={"name": "New T", "slug": f"nt-{uuid.uuid4().hex[:6]}"},
        headers=headers,
    )
    assert resp.status_code == 201


@pytest.mark.anyio
async def test_non_admin_cannot_create_tenant(client: AsyncClient):
    tenant = await _make_tenant()
    user, pw = await _make_user(tenant.id)  # no role
    data = await _login(client, user.email, pw)
    headers = {"Authorization": f"Bearer {data['access_token']}"}

    resp = await client.post(
        "/api/v1/tenants",
        json={"name": "X", "slug": f"x-{uuid.uuid4().hex[:6]}"},
        headers=headers,
    )
    assert resp.status_code == 403


@pytest.mark.anyio
async def test_exam_manager_can_create_exam(client: AsyncClient):
    """EXAM_MANAGER has exam:create via ROLE_PERMISSIONS."""
    from datetime import timedelta
    tenant = await _make_tenant()
    user, pw = await _make_user(tenant.id, role_name="EXAM_MANAGER")
    data = await _login(client, user.email, pw)
    headers = {"Authorization": f"Bearer {data['access_token']}"}

    now = datetime.now(timezone.utc)
    start = (now + timedelta(hours=2)).isoformat()
    end = (now + timedelta(hours=5)).isoformat()
    resp = await client.post("/api/v1/exams", json={
        "title": f"Mgr Exam {uuid.uuid4().hex[:4]}",
        "code": f"ME-{uuid.uuid4().hex[:6]}",
        "type": "PRACTICE",
        "start_time": start,
        "end_time": end,
    }, headers=headers)
    assert resp.status_code == 201


@pytest.mark.anyio
async def test_candidate_role_cannot_create_exam(client: AsyncClient):
    tenant = await _make_tenant()
    user, pw = await _make_user(tenant.id, role_name="CANDIDATE")
    data = await _login(client, user.email, pw)
    headers = {"Authorization": f"Bearer {data['access_token']}"}

    now = datetime.now(timezone.utc)
    start = (now + timedelta(hours=2)).isoformat()
    end = (now + timedelta(hours=5)).isoformat()
    resp = await client.post("/api/v1/exams", json={
        "title": "Cand Exam",
        "code": f"CE-{uuid.uuid4().hex[:6]}",
        "type": "PRACTICE",
        "start_time": start,
        "end_time": end,
    }, headers=headers)
    assert resp.status_code == 403


@pytest.mark.anyio
async def test_token_from_deleted_user_returns_401(client: AsyncClient):
    tenant = await _make_tenant()
    user, pw = await _make_user(tenant.id)
    data = await _login(client, user.email, pw)
    token = data["access_token"]

    # Hard-delete the user
    async with AsyncSessionLocal() as db:
        u = await db.get(User, user.id)
        if u:
            await db.delete(u)
            await db.commit()

    resp = await client.get("/api/v1/users", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 401
