"""Comprehensive tests for the Exams module.

Covers:
  - All 11 NestJS-equivalent endpoints
  - Authorization: admin/manager can write, plain user cannot
  - Tenant isolation: users cannot see or modify another tenant's exams
  - Business-rule validation (title uniqueness, publish guards, delete guards,
    draft-only sync, past-start rejection, teacher scoping on list)

Test setup helpers create tenants, users, roles, and candidates directly via
the SQLAlchemy session to avoid circular test dependencies on unrelated modules.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy import insert

from app.core.database import AsyncSessionLocal
from app.core.security import hash_password
from app.models.candidate import Candidate
from app.models.exam import Exam, ExamQuestion, ExamRegistration, ExamSection, ExamStatus
from app.models.question import Question, QuestionStatus
from app.models.role import Role
from app.models.tenant import Tenant
from app.models.user import User, user_roles

# ── Helpers ────────────────────────────────────────────────────────────────────

def _future_times(offset_hours: int = 2, duration_hours: int = 3) -> tuple[str, str]:
    """Return ISO-8601 UTC start/end strings in the future."""
    now = datetime.now(timezone.utc)
    start = now + timedelta(hours=offset_hours)
    end = start + timedelta(hours=duration_hours)
    return start.isoformat(), end.isoformat()


async def _create_tenant(name: str | None = None) -> Tenant:
    slug = f"tenant-{uuid.uuid4().hex[:8]}"
    async with AsyncSessionLocal() as db:
        t = Tenant(name=name or slug, slug=slug)
        db.add(t)
        await db.commit()
        await db.refresh(t)
        return t


async def _create_role(tenant_id: uuid.UUID, name: str) -> Role:
    async with AsyncSessionLocal() as db:
        r = Role(name=name, tenant_id=tenant_id)
        db.add(r)
        await db.commit()
        await db.refresh(r)
        return r


async def _create_user(
    tenant_id: uuid.UUID,
    role: Role | None = None,
    email: str | None = None,
) -> tuple[User, str]:
    """Returns (User, plain_password)."""
    password = "Secret123!"
    em = email or f"user-{uuid.uuid4().hex[:8]}@test.com"
    async with AsyncSessionLocal() as db:
        u = User(
            email=em,
            first_name="Test",
            last_name="User",
            tenant_id=tenant_id,
            password_hash=hash_password(password),
            is_active=True,
        )
        db.add(u)
        await db.flush()
        if role is not None:
            await db.execute(insert(user_roles).values(user_id=u.id, role_id=role.id))
        await db.commit()
        await db.refresh(u)
        return u, password


async def _create_candidate(tenant_id: uuid.UUID, user_id: uuid.UUID) -> Candidate:
    async with AsyncSessionLocal() as db:
        c = Candidate(
            tenant_id=tenant_id,
            user_id=user_id,
            registration_number=f"REG-{uuid.uuid4().hex[:8]}",
        )
        db.add(c)
        await db.commit()
        await db.refresh(c)
        return c


async def _login(client: AsyncClient, email: str, password: str) -> str:
    resp = await client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200, f"Login failed: {resp.text}"
    return resp.json()["data"]["access_token"]


async def _create_question(tenant_id: uuid.UUID, created_by_id: uuid.UUID) -> Question:
    async with AsyncSessionLocal() as db:
        q = Question(
            tenant_id=tenant_id,
            type="MCQ",
            difficulty="MEDIUM",
            status=QuestionStatus.DRAFT.value,
            created_by_id=created_by_id,
        )
        db.add(q)
        await db.commit()
        await db.refresh(q)
        return q


def _exam_payload(code_suffix: str | None = None, **overrides) -> dict:
    start, end = _future_times()
    base = {
        "title": f"Exam {uuid.uuid4().hex[:6]}",
        "code": f"EX-{code_suffix or uuid.uuid4().hex[:6]}",
        "type": "PRACTICE",
        "start_time": start,
        "end_time": end,
    }
    base.update(overrides)
    return base


# ── Fixtures ───────────────────────────────────────────────────────────────────

@pytest.fixture
async def setup(client: AsyncClient):
    """Create a tenant with admin + plain user + their tokens."""
    tenant = await _create_tenant()
    admin_role = await _create_role(tenant.id, "admin")
    user_role = await _create_role(tenant.id, "user")

    admin, admin_pw = await _create_user(tenant.id, admin_role)
    plain, plain_pw = await _create_user(tenant.id, user_role)

    admin_token = await _login(client, admin.email, admin_pw)
    plain_token = await _login(client, plain.email, plain_pw)

    return {
        "tenant": tenant,
        "admin": admin,
        "plain": plain,
        "admin_headers": {"Authorization": f"Bearer {admin_token}"},
        "plain_headers": {"Authorization": f"Bearer {plain_token}"},
        "admin_role": admin_role,
        "user_role": user_role,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# POST /exams — create
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.anyio
async def test_create_exam_admin_succeeds(client: AsyncClient, setup):
    resp = await client.post("/api/v1/exams", json=_exam_payload(), headers=setup["admin_headers"])
    assert resp.status_code == 201
    data = resp.json()["data"]
    assert data["title"]
    assert data["status"] == "DRAFT"
    assert data["tenant_id"] == str(setup["tenant"].id)


@pytest.mark.anyio
async def test_create_exam_plain_user_forbidden(client: AsyncClient, setup):
    resp = await client.post("/api/v1/exams", json=_exam_payload(), headers=setup["plain_headers"])
    assert resp.status_code == 403


@pytest.mark.anyio
async def test_create_exam_unauthenticated_returns_401(client: AsyncClient):
    start, end = _future_times()
    resp = await client.post("/api/v1/exams", json=_exam_payload())
    assert resp.status_code == 401


@pytest.mark.anyio
async def test_create_exam_duplicate_title_returns_409(client: AsyncClient, setup):
    payload = _exam_payload()
    r1 = await client.post("/api/v1/exams", json=payload, headers=setup["admin_headers"])
    assert r1.status_code == 201

    # Same title, different code → still 409
    payload2 = dict(payload)
    payload2["code"] = f"EX-{uuid.uuid4().hex[:6]}"
    r2 = await client.post("/api/v1/exams", json=payload2, headers=setup["admin_headers"])
    assert r2.status_code == 409


@pytest.mark.anyio
async def test_create_exam_duplicate_code_returns_409(client: AsyncClient, setup):
    payload = _exam_payload(code_suffix="DUPCODE")
    r1 = await client.post("/api/v1/exams", json=payload, headers=setup["admin_headers"])
    assert r1.status_code == 201

    payload2 = dict(payload)
    payload2["title"] = f"Other {uuid.uuid4().hex[:6]}"  # unique title
    r2 = await client.post("/api/v1/exams", json=payload2, headers=setup["admin_headers"])
    assert r2.status_code == 409


@pytest.mark.anyio
async def test_create_exam_past_start_time_returns_400(client: AsyncClient, setup):
    now = datetime.now(timezone.utc)
    past_start = (now - timedelta(hours=5)).isoformat()
    past_end = (now - timedelta(hours=2)).isoformat()
    payload = _exam_payload(start_time=past_start, end_time=past_end)
    resp = await client.post("/api/v1/exams", json=payload, headers=setup["admin_headers"])
    assert resp.status_code == 400


@pytest.mark.anyio
async def test_create_exam_end_before_start_returns_400(client: AsyncClient, setup):
    start, end = _future_times()
    payload = _exam_payload(start_time=end, end_time=start)  # reversed
    resp = await client.post("/api/v1/exams", json=payload, headers=setup["admin_headers"])
    assert resp.status_code == 400


@pytest.mark.anyio
async def test_create_exam_with_sections(client: AsyncClient, setup):
    payload = _exam_payload()
    payload["sections"] = [
        {"name": "Section A", "order_index": 1},
        {"name": "Section B", "order_index": 2, "duration_minutes": 30},
    ]
    resp = await client.post("/api/v1/exams", json=payload, headers=setup["admin_headers"])
    assert resp.status_code == 201
    data = resp.json()["data"]
    assert len(data["sections"]) == 2
    assert data["sections"][0]["name"] == "Section A"


# ═══════════════════════════════════════════════════════════════════════════════
# GET /exams — list
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.anyio
async def test_list_exams_returns_only_tenant_exams(client: AsyncClient, setup):
    # Create exam in setup tenant
    await client.post("/api/v1/exams", json=_exam_payload(), headers=setup["admin_headers"])

    # Create a second tenant with its own admin
    t2 = await _create_tenant()
    r2 = await _create_role(t2.id, "admin")
    admin2, pw2 = await _create_user(t2.id, r2)
    token2 = await _login(client, admin2.email, pw2)
    headers2 = {"Authorization": f"Bearer {token2}"}

    await client.post("/api/v1/exams", json=_exam_payload(), headers=headers2)

    # Each admin only sees their own tenant's exams
    resp1 = await client.get("/api/v1/exams", headers=setup["admin_headers"])
    resp2 = await client.get("/api/v1/exams", headers=headers2)
    assert resp1.status_code == 200
    assert resp2.status_code == 200

    ids1 = {e["id"] for e in resp1.json()["data"]["items"]}
    ids2 = {e["id"] for e in resp2.json()["data"]["items"]}
    assert ids1.isdisjoint(ids2), "Tenant isolation violated"


@pytest.mark.anyio
async def test_list_exams_teacher_scoping(client: AsyncClient, setup):
    """A plain user (teacher) should only see exams they created."""
    # Admin creates an exam
    r_admin = await client.post("/api/v1/exams", json=_exam_payload(), headers=setup["admin_headers"])
    assert r_admin.status_code == 201

    # Plain user sees none (they created none)
    resp = await client.get("/api/v1/exams", headers=setup["plain_headers"])
    assert resp.status_code == 200
    assert resp.json()["data"]["total"] == 0


@pytest.mark.anyio
async def test_list_exams_pagination(client: AsyncClient, setup):
    # Create 3 exams
    for _ in range(3):
        await client.post("/api/v1/exams", json=_exam_payload(), headers=setup["admin_headers"])

    resp = await client.get("/api/v1/exams?page=1&limit=2", headers=setup["admin_headers"])
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert len(data["items"]) <= 2
    assert data["page"] == 1
    assert data["limit"] == 2
    assert "totalPages" in data


# ═══════════════════════════════════════════════════════════════════════════════
# GET /exams/{id} — get one
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.anyio
async def test_get_exam_returns_correct_exam(client: AsyncClient, setup):
    create = await client.post("/api/v1/exams", json=_exam_payload(), headers=setup["admin_headers"])
    exam_id = create.json()["data"]["id"]

    resp = await client.get(f"/api/v1/exams/{exam_id}", headers=setup["admin_headers"])
    assert resp.status_code == 200
    assert resp.json()["data"]["id"] == exam_id


@pytest.mark.anyio
async def test_get_exam_wrong_tenant_returns_404(client: AsyncClient, setup):
    create = await client.post("/api/v1/exams", json=_exam_payload(), headers=setup["admin_headers"])
    exam_id = create.json()["data"]["id"]

    # Different tenant
    t2 = await _create_tenant()
    r2 = await _create_role(t2.id, "admin")
    admin2, pw2 = await _create_user(t2.id, r2)
    token2 = await _login(client, admin2.email, pw2)
    headers2 = {"Authorization": f"Bearer {token2}"}

    resp = await client.get(f"/api/v1/exams/{exam_id}", headers=headers2)
    assert resp.status_code == 404


@pytest.mark.anyio
async def test_get_exam_unknown_id_returns_404(client: AsyncClient, setup):
    resp = await client.get(f"/api/v1/exams/{uuid.uuid4()}", headers=setup["admin_headers"])
    assert resp.status_code == 404


# ═══════════════════════════════════════════════════════════════════════════════
# PATCH /exams/{id}/schedule
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.anyio
async def test_update_schedule_succeeds(client: AsyncClient, setup):
    create = await client.post("/api/v1/exams", json=_exam_payload(), headers=setup["admin_headers"])
    exam_id = create.json()["data"]["id"]

    start, end = _future_times(offset_hours=10)
    resp = await client.patch(
        f"/api/v1/exams/{exam_id}/schedule",
        json={"start_time": start, "end_time": end},
        headers=setup["admin_headers"],
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["id"] == exam_id


@pytest.mark.anyio
async def test_update_schedule_plain_user_forbidden(client: AsyncClient, setup):
    create = await client.post("/api/v1/exams", json=_exam_payload(), headers=setup["admin_headers"])
    exam_id = create.json()["data"]["id"]
    start, end = _future_times(offset_hours=10)
    resp = await client.patch(
        f"/api/v1/exams/{exam_id}/schedule",
        json={"start_time": start, "end_time": end},
        headers=setup["plain_headers"],
    )
    assert resp.status_code == 403


@pytest.mark.anyio
async def test_update_schedule_invalid_duration_returns_400(client: AsyncClient, setup):
    create = await client.post("/api/v1/exams", json=_exam_payload(), headers=setup["admin_headers"])
    exam_id = create.json()["data"]["id"]
    start, end = _future_times(offset_hours=4)
    resp = await client.patch(
        f"/api/v1/exams/{exam_id}/schedule",
        json={"start_time": start, "end_time": end, "duration_minutes": 0},
        headers=setup["admin_headers"],
    )
    assert resp.status_code == 400


# ═══════════════════════════════════════════════════════════════════════════════
# POST /exams/{id}/questions
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.anyio
async def test_add_questions_to_section_succeeds(client: AsyncClient, setup):
    # Create exam with one section
    payload = _exam_payload()
    payload["sections"] = [{"name": "S1", "order_index": 1}]
    create = await client.post("/api/v1/exams", json=payload, headers=setup["admin_headers"])
    assert create.status_code == 201
    exam_data = create.json()["data"]
    exam_id = exam_data["id"]
    section_id = exam_data["sections"][0]["id"]

    # Create a question directly in DB
    q = await _create_question(setup["tenant"].id, setup["admin"].id)

    resp = await client.post(
        f"/api/v1/exams/{exam_id}/questions",
        json={"section_id": str(section_id), "question_ids": [str(q.id)]},
        headers=setup["admin_headers"],
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["added"] == 1
    assert data["skipped"] == 0


@pytest.mark.anyio
async def test_add_questions_dedupes_on_repeat(client: AsyncClient, setup):
    payload = _exam_payload()
    payload["sections"] = [{"name": "S1", "order_index": 1}]
    create = await client.post("/api/v1/exams", json=payload, headers=setup["admin_headers"])
    exam_data = create.json()["data"]
    exam_id = exam_data["id"]
    section_id = exam_data["sections"][0]["id"]
    q = await _create_question(setup["tenant"].id, setup["admin"].id)

    await client.post(
        f"/api/v1/exams/{exam_id}/questions",
        json={"section_id": str(section_id), "question_ids": [str(q.id)]},
        headers=setup["admin_headers"],
    )
    # Add same question again
    resp = await client.post(
        f"/api/v1/exams/{exam_id}/questions",
        json={"section_id": str(section_id), "question_ids": [str(q.id)]},
        headers=setup["admin_headers"],
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["added"] == 0
    assert data["skipped"] == 1


@pytest.mark.anyio
async def test_add_invalid_question_returns_400(client: AsyncClient, setup):
    payload = _exam_payload()
    payload["sections"] = [{"name": "S1", "order_index": 1}]
    create = await client.post("/api/v1/exams", json=payload, headers=setup["admin_headers"])
    exam_data = create.json()["data"]
    exam_id = exam_data["id"]
    section_id = exam_data["sections"][0]["id"]

    resp = await client.post(
        f"/api/v1/exams/{exam_id}/questions",
        json={"section_id": str(section_id), "question_ids": [str(uuid.uuid4())]},
        headers=setup["admin_headers"],
    )
    assert resp.status_code == 400


@pytest.mark.anyio
async def test_add_questions_plain_user_forbidden(client: AsyncClient, setup):
    payload = _exam_payload()
    payload["sections"] = [{"name": "S1", "order_index": 1}]
    create = await client.post("/api/v1/exams", json=payload, headers=setup["admin_headers"])
    exam_data = create.json()["data"]
    exam_id = exam_data["id"]
    section_id = exam_data["sections"][0]["id"]
    q = await _create_question(setup["tenant"].id, setup["admin"].id)

    resp = await client.post(
        f"/api/v1/exams/{exam_id}/questions",
        json={"section_id": str(section_id), "question_ids": [str(q.id)]},
        headers=setup["plain_headers"],
    )
    assert resp.status_code == 403


# ═══════════════════════════════════════════════════════════════════════════════
# POST /exams/{id}/publish
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.anyio
async def test_publish_fails_without_questions(client: AsyncClient, setup):
    payload = _exam_payload()
    payload["sections"] = [{"name": "S1", "order_index": 1}]
    create = await client.post("/api/v1/exams", json=payload, headers=setup["admin_headers"])
    exam_id = create.json()["data"]["id"]

    resp = await client.post(f"/api/v1/exams/{exam_id}/publish", headers=setup["admin_headers"])
    assert resp.status_code == 400
    assert "question" in resp.json()["message"].lower()


@pytest.mark.anyio
async def test_publish_fails_without_candidates(client: AsyncClient, setup):
    payload = _exam_payload()
    payload["sections"] = [{"name": "S1", "order_index": 1}]
    create = await client.post("/api/v1/exams", json=payload, headers=setup["admin_headers"])
    exam_data = create.json()["data"]
    exam_id = exam_data["id"]
    section_id = exam_data["sections"][0]["id"]
    q = await _create_question(setup["tenant"].id, setup["admin"].id)

    await client.post(
        f"/api/v1/exams/{exam_id}/questions",
        json={"section_id": str(section_id), "question_ids": [str(q.id)]},
        headers=setup["admin_headers"],
    )

    resp = await client.post(f"/api/v1/exams/{exam_id}/publish", headers=setup["admin_headers"])
    assert resp.status_code == 400
    assert "candidate" in resp.json()["message"].lower()


@pytest.mark.anyio
async def test_publish_succeeds_with_questions_and_candidates(client: AsyncClient, setup):
    payload = _exam_payload()
    payload["sections"] = [{"name": "S1", "order_index": 1}]
    create = await client.post("/api/v1/exams", json=payload, headers=setup["admin_headers"])
    exam_data = create.json()["data"]
    exam_id = exam_data["id"]
    section_id = exam_data["sections"][0]["id"]

    q = await _create_question(setup["tenant"].id, setup["admin"].id)
    await client.post(
        f"/api/v1/exams/{exam_id}/questions",
        json={"section_id": str(section_id), "question_ids": [str(q.id)]},
        headers=setup["admin_headers"],
    )

    # Create candidate and register
    candidate = await _create_candidate(setup["tenant"].id, setup["plain"].id)
    await client.post(
        f"/api/v1/exams/{exam_id}/candidates",
        json={"candidate_ids": [str(candidate.id)]},
        headers=setup["admin_headers"],
    )

    resp = await client.post(f"/api/v1/exams/{exam_id}/publish", headers=setup["admin_headers"])
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["status"] == "PUBLISHED"
    assert data["published_at"] is not None


@pytest.mark.anyio
async def test_publish_plain_user_forbidden(client: AsyncClient, setup):
    create = await client.post("/api/v1/exams", json=_exam_payload(), headers=setup["admin_headers"])
    exam_id = create.json()["data"]["id"]
    resp = await client.post(f"/api/v1/exams/{exam_id}/publish", headers=setup["plain_headers"])
    assert resp.status_code == 403


# ═══════════════════════════════════════════════════════════════════════════════
# POST /exams/{id}/candidates — assign
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.anyio
async def test_assign_candidates_succeeds(client: AsyncClient, setup):
    create = await client.post("/api/v1/exams", json=_exam_payload(), headers=setup["admin_headers"])
    exam_id = create.json()["data"]["id"]
    candidate = await _create_candidate(setup["tenant"].id, setup["plain"].id)

    resp = await client.post(
        f"/api/v1/exams/{exam_id}/candidates",
        json={"candidate_ids": [str(candidate.id)]},
        headers=setup["admin_headers"],
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["count"] == 1
    assert data["skipped"] == 0


@pytest.mark.anyio
async def test_assign_candidates_idempotent_on_repeat(client: AsyncClient, setup):
    create = await client.post("/api/v1/exams", json=_exam_payload(), headers=setup["admin_headers"])
    exam_id = create.json()["data"]["id"]
    candidate = await _create_candidate(setup["tenant"].id, setup["plain"].id)

    await client.post(
        f"/api/v1/exams/{exam_id}/candidates",
        json={"candidate_ids": [str(candidate.id)]},
        headers=setup["admin_headers"],
    )
    resp = await client.post(
        f"/api/v1/exams/{exam_id}/candidates",
        json={"candidate_ids": [str(candidate.id)]},
        headers=setup["admin_headers"],
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["count"] == 0
    assert data["skipped"] == 1


@pytest.mark.anyio
async def test_assign_cross_tenant_candidate_returns_400(client: AsyncClient, setup):
    # Candidate from a different tenant
    t2 = await _create_tenant()
    r2 = await _create_role(t2.id, "user")
    u2, _ = await _create_user(t2.id, r2)
    c2 = await _create_candidate(t2.id, u2.id)

    create = await client.post("/api/v1/exams", json=_exam_payload(), headers=setup["admin_headers"])
    exam_id = create.json()["data"]["id"]

    resp = await client.post(
        f"/api/v1/exams/{exam_id}/candidates",
        json={"candidate_ids": [str(c2.id)]},
        headers=setup["admin_headers"],
    )
    assert resp.status_code == 400


# ═══════════════════════════════════════════════════════════════════════════════
# PUT /exams/{id}/candidates — sync
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.anyio
async def test_sync_candidates_adds_and_removes(client: AsyncClient, setup):
    create = await client.post("/api/v1/exams", json=_exam_payload(), headers=setup["admin_headers"])
    exam_id = create.json()["data"]["id"]

    # Create two candidates
    u1_role = setup["user_role"]
    u1, u1_pw = await _create_user(setup["tenant"].id, u1_role)
    u2, u2_pw = await _create_user(setup["tenant"].id, u1_role)
    c1 = await _create_candidate(setup["tenant"].id, u1.id)
    c2 = await _create_candidate(setup["tenant"].id, u2.id)

    # Assign c1
    await client.put(
        f"/api/v1/exams/{exam_id}/candidates",
        json={"candidate_ids": [str(c1.id)]},
        headers=setup["admin_headers"],
    )

    # Sync to c2 only (removes c1, adds c2)
    resp = await client.put(
        f"/api/v1/exams/{exam_id}/candidates",
        json={"candidate_ids": [str(c2.id)]},
        headers=setup["admin_headers"],
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    assert data["added"] == 1
    assert data["removed"] == 1
    assert data["assigned"] == 1


@pytest.mark.anyio
async def test_sync_candidates_rejected_on_non_draft(client: AsyncClient, setup):
    """Publish the exam first, then try to sync — should 400."""
    payload = _exam_payload()
    payload["sections"] = [{"name": "S1", "order_index": 1}]
    create = await client.post("/api/v1/exams", json=payload, headers=setup["admin_headers"])
    exam_data = create.json()["data"]
    exam_id = exam_data["id"]
    section_id = exam_data["sections"][0]["id"]

    q = await _create_question(setup["tenant"].id, setup["admin"].id)
    await client.post(
        f"/api/v1/exams/{exam_id}/questions",
        json={"section_id": str(section_id), "question_ids": [str(q.id)]},
        headers=setup["admin_headers"],
    )
    candidate = await _create_candidate(setup["tenant"].id, setup["plain"].id)
    await client.post(
        f"/api/v1/exams/{exam_id}/candidates",
        json={"candidate_ids": [str(candidate.id)]},
        headers=setup["admin_headers"],
    )
    await client.post(f"/api/v1/exams/{exam_id}/publish", headers=setup["admin_headers"])

    resp = await client.put(
        f"/api/v1/exams/{exam_id}/candidates",
        json={"candidate_ids": [str(candidate.id)]},
        headers=setup["admin_headers"],
    )
    assert resp.status_code == 400


# ═══════════════════════════════════════════════════════════════════════════════
# DELETE /exams/{id}/questions/{questionId}
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.anyio
async def test_remove_question_succeeds(client: AsyncClient, setup):
    payload = _exam_payload()
    payload["sections"] = [{"name": "S1", "order_index": 1}]
    create = await client.post("/api/v1/exams", json=payload, headers=setup["admin_headers"])
    exam_data = create.json()["data"]
    exam_id = exam_data["id"]
    section_id = exam_data["sections"][0]["id"]

    q = await _create_question(setup["tenant"].id, setup["admin"].id)
    await client.post(
        f"/api/v1/exams/{exam_id}/questions",
        json={"section_id": str(section_id), "question_ids": [str(q.id)]},
        headers=setup["admin_headers"],
    )

    resp = await client.delete(
        f"/api/v1/exams/{exam_id}/questions/{q.id}",
        headers=setup["admin_headers"],
    )
    assert resp.status_code == 200
    assert resp.json()["data"]["removed"] is True


@pytest.mark.anyio
async def test_remove_question_not_on_exam_returns_404(client: AsyncClient, setup):
    create = await client.post("/api/v1/exams", json=_exam_payload(), headers=setup["admin_headers"])
    exam_id = create.json()["data"]["id"]
    resp = await client.delete(
        f"/api/v1/exams/{exam_id}/questions/{uuid.uuid4()}",
        headers=setup["admin_headers"],
    )
    assert resp.status_code == 404


@pytest.mark.anyio
async def test_remove_question_plain_user_forbidden(client: AsyncClient, setup):
    create = await client.post("/api/v1/exams", json=_exam_payload(), headers=setup["admin_headers"])
    exam_id = create.json()["data"]["id"]
    resp = await client.delete(
        f"/api/v1/exams/{exam_id}/questions/{uuid.uuid4()}",
        headers=setup["plain_headers"],
    )
    assert resp.status_code == 403


# ═══════════════════════════════════════════════════════════════════════════════
# DELETE /exams/{id}
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.anyio
async def test_delete_exam_succeeds(client: AsyncClient, setup):
    create = await client.post("/api/v1/exams", json=_exam_payload(), headers=setup["admin_headers"])
    exam_id = create.json()["data"]["id"]

    resp = await client.delete(f"/api/v1/exams/{exam_id}", headers=setup["admin_headers"])
    assert resp.status_code == 200
    assert resp.json()["data"]["deleted"] is True

    # Confirm gone
    get_resp = await client.get(f"/api/v1/exams/{exam_id}", headers=setup["admin_headers"])
    assert get_resp.status_code == 404


@pytest.mark.anyio
async def test_delete_exam_plain_user_forbidden(client: AsyncClient, setup):
    create = await client.post("/api/v1/exams", json=_exam_payload(), headers=setup["admin_headers"])
    exam_id = create.json()["data"]["id"]
    resp = await client.delete(f"/api/v1/exams/{exam_id}", headers=setup["plain_headers"])
    assert resp.status_code == 403


@pytest.mark.anyio
async def test_delete_exam_wrong_tenant_returns_404(client: AsyncClient, setup):
    create = await client.post("/api/v1/exams", json=_exam_payload(), headers=setup["admin_headers"])
    exam_id = create.json()["data"]["id"]

    t2 = await _create_tenant()
    r2 = await _create_role(t2.id, "admin")
    admin2, pw2 = await _create_user(t2.id, r2)
    token2 = await _login(client, admin2.email, pw2)
    headers2 = {"Authorization": f"Bearer {token2}"}

    resp = await client.delete(f"/api/v1/exams/{exam_id}", headers=headers2)
    assert resp.status_code == 404


# ═══════════════════════════════════════════════════════════════════════════════
# GET /exams/my/available  (candidate endpoint)
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.anyio
async def test_my_available_returns_registered_published_exams(client: AsyncClient, setup):
    payload = _exam_payload()
    payload["sections"] = [{"name": "S1", "order_index": 1}]
    create = await client.post("/api/v1/exams", json=payload, headers=setup["admin_headers"])
    exam_data = create.json()["data"]
    exam_id = exam_data["id"]
    section_id = exam_data["sections"][0]["id"]

    q = await _create_question(setup["tenant"].id, setup["admin"].id)
    await client.post(
        f"/api/v1/exams/{exam_id}/questions",
        json={"section_id": str(section_id), "question_ids": [str(q.id)]},
        headers=setup["admin_headers"],
    )
    candidate = await _create_candidate(setup["tenant"].id, setup["plain"].id)
    await client.post(
        f"/api/v1/exams/{exam_id}/candidates",
        json={"candidate_ids": [str(candidate.id)]},
        headers=setup["admin_headers"],
    )
    await client.post(f"/api/v1/exams/{exam_id}/publish", headers=setup["admin_headers"])

    resp = await client.get("/api/v1/exams/my/available", headers=setup["plain_headers"])
    assert resp.status_code == 200
    ids = [e["exam_id"] for e in resp.json()["data"]]
    assert str(exam_id) in ids


@pytest.mark.anyio
async def test_my_available_no_candidate_profile_returns_400(client: AsyncClient, setup):
    """Plain user without a candidate profile should get 400."""
    # plain user has NO candidate profile in this case
    # Create a fresh user with no candidate
    u, pw = await _create_user(setup["tenant"].id, setup["user_role"])
    token = await _login(client, u.email, pw)
    resp = await client.get(
        "/api/v1/exams/my/available",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 400


# ═══════════════════════════════════════════════════════════════════════════════
# GET /exams/{id}/instructions  (candidate endpoint)
# ═══════════════════════════════════════════════════════════════════════════════

@pytest.mark.anyio
async def test_instructions_returns_flat_exam_plus_registration(client: AsyncClient, setup):
    payload = _exam_payload()
    payload["sections"] = [{"name": "S1", "order_index": 1}]
    create = await client.post("/api/v1/exams", json=payload, headers=setup["admin_headers"])
    exam_data = create.json()["data"]
    exam_id = exam_data["id"]
    section_id = exam_data["sections"][0]["id"]

    q = await _create_question(setup["tenant"].id, setup["admin"].id)
    await client.post(
        f"/api/v1/exams/{exam_id}/questions",
        json={"section_id": str(section_id), "question_ids": [str(q.id)]},
        headers=setup["admin_headers"],
    )
    candidate = await _create_candidate(setup["tenant"].id, setup["plain"].id)
    await client.post(
        f"/api/v1/exams/{exam_id}/candidates",
        json={"candidate_ids": [str(candidate.id)]},
        headers=setup["admin_headers"],
    )
    await client.post(f"/api/v1/exams/{exam_id}/publish", headers=setup["admin_headers"])

    resp = await client.get(
        f"/api/v1/exams/{exam_id}/instructions",
        headers=setup["plain_headers"],
    )
    assert resp.status_code == 200
    data = resp.json()["data"]
    # Flat: exam fields at top level + registration sub-object
    assert data["id"] == str(exam_id)
    assert data["title"]
    assert "registration" in data
    assert "id" in data["registration"]
    # Must NOT have a nested "exam" key (that's the old broken shape)
    assert "exam" not in data


@pytest.mark.anyio
async def test_instructions_not_registered_returns_404(client: AsyncClient, setup):
    create = await client.post("/api/v1/exams", json=_exam_payload(), headers=setup["admin_headers"])
    exam_id = create.json()["data"]["id"]

    # plain user has no candidate profile here
    resp = await client.get(
        f"/api/v1/exams/{exam_id}/instructions",
        headers=setup["plain_headers"],
    )
    # 400 (no candidate) or 404 (not registered) both acceptable
    assert resp.status_code in {400, 404}


@pytest.mark.anyio
async def test_instructions_draft_exam_returns_400(client: AsyncClient, setup):
    """Candidate registered but exam is DRAFT — should be rejected."""
    create = await client.post("/api/v1/exams", json=_exam_payload(), headers=setup["admin_headers"])
    exam_id = create.json()["data"]["id"]
    candidate = await _create_candidate(setup["tenant"].id, setup["plain"].id)
    await client.post(
        f"/api/v1/exams/{exam_id}/candidates",
        json={"candidate_ids": [str(candidate.id)]},
        headers=setup["admin_headers"],
    )

    resp = await client.get(
        f"/api/v1/exams/{exam_id}/instructions",
        headers=setup["plain_headers"],
    )
    assert resp.status_code == 400
