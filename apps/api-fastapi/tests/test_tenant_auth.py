import uuid

import pytest
from httpx import AsyncClient

from app.core.database import AsyncSessionLocal
from app.models.tenant import Tenant
from app.models.user import User, user_roles
from app.models.role import Role
from app.core.security import hash_password
from sqlalchemy import insert


async def _create_user_with_role(db, tenant_id, email, password, role_name: str | None):
    user = User(
        email=email,
        password_hash=hash_password(password),
        tenant_id=tenant_id,
        is_active=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    if role_name:
        role = Role(name=role_name, tenant_id=tenant_id)
        db.add(role)
        await db.commit()
        await db.refresh(role)
        # insert association
        await db.execute(insert(user_roles).values(user_id=user.id, role_id=role.id))
        await db.commit()

    return user


@pytest.mark.anyio
async def test_admin_can_create_tenant_and_non_admin_forbidden(client: AsyncClient):
    # bootstrap: create an initial tenant and admin user directly in DB
    async with AsyncSessionLocal() as db:
        tenant = Tenant(name="Bootstrap Tenant", slug=f"bootstrap-{uuid.uuid4().hex[:8]}")
        db.add(tenant)
        await db.commit()
        await db.refresh(tenant)

        admin_email = f"admin-{uuid.uuid4().hex[:8]}@example.com"
        admin_password = "AdminPass123!"
        admin_user = await _create_user_with_role(db, tenant.id, admin_email, admin_password, "admin")

    # login as admin
    login = await client.post("/api/v1/auth/login", json={"email": admin_email, "password": admin_password})
    assert login.status_code == 200
    token = login.json()["data"]["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # admin can create tenant
    new_tenant_payload = {"name": "New Tenant", "slug": f"new-{uuid.uuid4().hex[:8]}"}
    resp = await client.post("/api/v1/tenants", json=new_tenant_payload, headers=headers)
    assert resp.status_code == 201

    # create non-admin user
    async with AsyncSessionLocal() as db:
        non_admin_email = f"user-{uuid.uuid4().hex[:8]}@example.com"
        non_admin_password = "UserPass123!"
        non_admin = await _create_user_with_role(db, tenant.id, non_admin_email, non_admin_password, None)

    # login as non-admin
    login2 = await client.post("/api/v1/auth/login", json={"email": non_admin_email, "password": non_admin_password})
    assert login2.status_code == 200
    token2 = login2.json()["data"]["access_token"]
    headers2 = {"Authorization": f"Bearer {token2}"}

    # non-admin cannot create tenant
    resp2 = await client.post("/api/v1/tenants", json={"name": "X", "slug": f"x-{uuid.uuid4().hex[:8]}"}, headers=headers2)
    assert resp2.status_code == 403


@pytest.mark.anyio
async def test_admin_can_delete_tenant_and_non_admin_forbidden(client: AsyncClient):
    # bootstrap tenant and admin user
    async with AsyncSessionLocal() as db:
        tenant = Tenant(name="Del Tenant", slug=f"del-{uuid.uuid4().hex[:8]}")
        db.add(tenant)
        await db.commit()
        await db.refresh(tenant)

        admin_email = f"del-admin-{uuid.uuid4().hex[:8]}@example.com"
        admin_password = "AdminDel123!"
        admin_user = await _create_user_with_role(db, tenant.id, admin_email, admin_password, "admin")

        # create another tenant to be deleted
        target = Tenant(name="Target Tenant", slug=f"target-{uuid.uuid4().hex[:8]}")
        db.add(target)
        await db.commit()
        await db.refresh(target)

    # login as admin
    login = await client.post("/api/v1/auth/login", json={"email": admin_email, "password": admin_password})
    assert login.status_code == 200
    token = login.json()["data"]["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # admin can delete target tenant
    del_resp = await client.delete(f"/api/v1/tenants/{target.id}", headers=headers)
    assert del_resp.status_code == 204

    # create non-admin user in the same bootstrap tenant
    async with AsyncSessionLocal() as db:
        non_admin_email = f"del-user-{uuid.uuid4().hex[:8]}@example.com"
        non_admin_password = "UserDel123!"
        non_admin = await _create_user_with_role(db, tenant.id, non_admin_email, non_admin_password, None)

    login2 = await client.post("/api/v1/auth/login", json={"email": non_admin_email, "password": non_admin_password})
    assert login2.status_code == 200
    token2 = login2.json()["data"]["access_token"]
    headers2 = {"Authorization": f"Bearer {token2}"}

    # non-admin cannot delete a tenant
    # create a tenant to attempt deletion
    async with AsyncSessionLocal() as db:
        t2 = Tenant(name="Another", slug=f"another-{uuid.uuid4().hex[:8]}")
        db.add(t2)
        await db.commit()
        await db.refresh(t2)

    resp = await client.delete(f"/api/v1/tenants/{t2.id}", headers=headers2)
    assert resp.status_code == 403


@pytest.mark.anyio
async def test_admin_can_update_tenant(client: AsyncClient):
    async with AsyncSessionLocal() as db:
        tenant = Tenant(name="Update Tenant", slug=f"update-{uuid.uuid4().hex[:8]}")
        db.add(tenant)
        await db.commit()
        await db.refresh(tenant)

        admin_email = f"upd-admin-{uuid.uuid4().hex[:8]}@example.com"
        admin_password = "UpdAdmin123!"
        await _create_user_with_role(db, tenant.id, admin_email, admin_password, "admin")
        tenant_id = tenant.id

    login = await client.post("/api/v1/auth/login", json={"email": admin_email, "password": admin_password})
    assert login.status_code == 200
    headers = {"Authorization": f"Bearer {login.json()['data']['access_token']}"}

    resp = await client.put(
        f"/api/v1/tenants/{tenant_id}",
        json={"name": "Updated Name"},
        headers=headers,
    )
    assert resp.status_code == 200
    body = resp.json()["data"]
    assert body["name"] == "Updated Name"
    assert body["id"] == str(tenant_id)


@pytest.mark.anyio
async def test_non_admin_cannot_update_tenant(client: AsyncClient):
    async with AsyncSessionLocal() as db:
        tenant = Tenant(name="NoUpd Tenant", slug=f"noupd-{uuid.uuid4().hex[:8]}")
        db.add(tenant)
        await db.commit()
        await db.refresh(tenant)

        user_email = f"noupd-user-{uuid.uuid4().hex[:8]}@example.com"
        user_password = "NoUpdUser123!"
        await _create_user_with_role(db, tenant.id, user_email, user_password, None)
        tenant_id = tenant.id

    login = await client.post("/api/v1/auth/login", json={"email": user_email, "password": user_password})
    assert login.status_code == 200
    headers = {"Authorization": f"Bearer {login.json()['data']['access_token']}"}

    resp = await client.put(
        f"/api/v1/tenants/{tenant_id}",
        json={"name": "Should Fail"},
        headers=headers,
    )
    assert resp.status_code == 403


@pytest.mark.anyio
async def test_update_missing_tenant_returns_404(client: AsyncClient):
    async with AsyncSessionLocal() as db:
        tenant = Tenant(name="404 Tenant", slug=f"miss-{uuid.uuid4().hex[:8]}")
        db.add(tenant)
        await db.commit()
        await db.refresh(tenant)

        admin_email = f"miss-admin-{uuid.uuid4().hex[:8]}@example.com"
        admin_password = "MissAdmin123!"
        await _create_user_with_role(db, tenant.id, admin_email, admin_password, "admin")

    login = await client.post("/api/v1/auth/login", json={"email": admin_email, "password": admin_password})
    assert login.status_code == 200
    headers = {"Authorization": f"Bearer {login.json()['data']['access_token']}"}

    resp = await client.put(
        f"/api/v1/tenants/{uuid.uuid4()}",
        json={"name": "Ghost"},
        headers=headers,
    )
    assert resp.status_code == 404
