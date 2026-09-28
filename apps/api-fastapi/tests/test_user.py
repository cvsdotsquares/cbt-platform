import uuid

import pytest
from httpx import AsyncClient
from app.core.database import AsyncSessionLocal
from app.models.tenant import Tenant


@pytest.mark.anyio
async def test_user_crud_lifecycle(client: AsyncClient):
    tenant_payload = {
        "name": "Test Tenant",
        "slug": f"test-tenant-{uuid.uuid4().hex[:8]}",
    }
    async with AsyncSessionLocal() as db:
        tenant = Tenant(name=tenant_payload["name"], slug=tenant_payload["slug"]) 
        db.add(tenant)
        await db.commit()
        await db.refresh(tenant)
        tenant_id = tenant.id

    user_email = f"user-{uuid.uuid4().hex[:8]}@example.com"
    create_payload = {
        "email": user_email,
        "password": "Secret123!",
        "first_name": "Alice",
        "last_name": "Smith",
        "tenant_id": str(tenant_id),
    }

    create_resp = await client.post("/api/v1/users", json=create_payload)
    assert create_resp.status_code == 201
    created = create_resp.json()["data"]
    assert created["email"] == user_email
    assert created["first_name"] == "Alice"
    assert created["last_name"] == "Smith"
    assert created["tenant_id"] == str(tenant_id)
    assert created["is_active"] is True
    assert "password_hash" not in created
    user_id = created["id"]

    # Authenticate as the created user to perform protected actions
    login_resp = await client.post("/api/v1/auth/login", json={"email": user_email, "password": "Secret123!"})
    assert login_resp.status_code == 200
    token = login_resp.json()["data"]["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    list_resp = await client.get("/api/v1/users", headers=headers)
    assert list_resp.status_code == 200
    users = list_resp.json()["data"]
    assert any(u["id"] == user_id for u in users)

    get_resp = await client.get(f"/api/v1/users/{user_id}", headers=headers)
    assert get_resp.status_code == 200
    got = get_resp.json()["data"]
    assert got["id"] == user_id
    assert got["email"] == user_email

    update_payload = {"first_name": "Bob"}
    update_resp = await client.put(f"/api/v1/users/{user_id}", json=update_payload, headers=headers)
    assert update_resp.status_code == 200
    updated = update_resp.json()["data"]
    assert updated["first_name"] == "Bob"
    assert updated["is_active"] is True

    delete_resp = await client.delete(f"/api/v1/users/{user_id}", headers=headers)
    assert delete_resp.status_code == 204

    missing_resp = await client.get(f"/api/v1/users/{user_id}", headers=headers)
    assert missing_resp.status_code in {401, 404}


@pytest.mark.anyio
async def test_create_user_duplicate_email_returns_error(client: AsyncClient):
    tenant_payload = {
        "name": "Test Tenant Dup",
        "slug": f"test-tenant-dup-{uuid.uuid4().hex[:8]}",
    }
    async with AsyncSessionLocal() as db:
        t = Tenant(name=tenant_payload["name"], slug=tenant_payload["slug"]) 
        db.add(t)
        await db.commit()
        await db.refresh(t)
        tenant_id = t.id

    email = f"duplicate-{uuid.uuid4().hex[:8]}@example.com"
    payload = {
        "email": email,
        "password": "Secret123!",
        "tenant_id": str(tenant_id),
    }
    first_resp = await client.post("/api/v1/users", json=payload)
    assert first_resp.status_code == 201

    second_resp = await client.post("/api/v1/users", json=payload)
    assert second_resp.status_code in {400, 409}


@pytest.mark.anyio
async def test_create_user_invalid_tenant_id_returns_error(client: AsyncClient):
    payload = {
        "email": f"invalid-tenant-{uuid.uuid4().hex[:8]}@example.com",
        "tenant_id": str(uuid.uuid4()),
    }
    resp = await client.post("/api/v1/users", json=payload)
    assert resp.status_code in {400, 404, 422}


@pytest.mark.anyio
async def test_get_missing_user_returns_404(client: AsyncClient):
    # create tenant and user, then authenticate
    async with AsyncSessionLocal() as db:
        tenant = Tenant(name="Missing Tenant", slug=f"missing-{uuid.uuid4().hex[:8]}")
        db.add(tenant)
        await db.commit()
        await db.refresh(tenant)

    email = f"missing-user-{uuid.uuid4().hex[:8]}@example.com"
    password = "Missing123!"
    await client.post("/api/v1/users", json={"email": email, "password": password, "tenant_id": str(tenant.id)})
    login = await client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert login.status_code == 200
    token = login.json()["data"]["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    resp = await client.get(f"/api/v1/users/{uuid.uuid4()}", headers=headers)
    assert resp.status_code == 404
