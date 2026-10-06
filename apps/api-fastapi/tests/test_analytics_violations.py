"""Analytics integrity-violation dismiss / restore / purge endpoints."""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

import pytest
from httpx import AsyncClient
from sqlalchemy import text

from app.core.database import AsyncSessionLocal
from app.models.exam import Exam, ExamStatus
from app.models.exam_registration import ExamRegistration, ExamRegistrationStatus
from app.models.exam_session import ExamSession
from tests.test_exam import (
    _create_candidate,
    _create_role,
    _create_tenant,
    _create_user,
    _future_times,
    _login,
)


async def _create_exam(tenant_id: uuid.UUID, created_by_id: uuid.UUID) -> Exam:
    start, end = _future_times()
    async with AsyncSessionLocal() as db:
        exam = Exam(
            tenant_id=tenant_id,
            title=f"Proctor Exam {uuid.uuid4().hex[:6]}",
            code=f"PE-{uuid.uuid4().hex[:6]}",
            type="PRACTICE",
            status=ExamStatus.PUBLISHED,
            start_time=datetime.fromisoformat(start.replace("Z", "+00:00")),
            end_time=datetime.fromisoformat(end.replace("Z", "+00:00")),
            timezone="UTC",
            created_by_id=created_by_id,
        )
        db.add(exam)
        await db.commit()
        await db.refresh(exam)
        return exam


async def _create_proctoring_event(
    tenant_id: uuid.UUID,
    *,
    dismissed: bool = False,
) -> tuple[str, uuid.UUID]:
    """Returns (event_id, owning_tenant_id)."""
    async with AsyncSessionLocal() as db:
        role = await _create_role(tenant_id, "admin")
        user, _ = await _create_user(tenant_id, role)
        candidate = await _create_candidate(tenant_id, user.id)
        exam = await _create_exam(tenant_id, user.id)

        reg = ExamRegistration(
            exam_id=exam.id,
            candidate_id=candidate.id,
            status=ExamRegistrationStatus.REGISTERED,
            registered_at=datetime.now(timezone.utc),
        )
        db.add(reg)
        await db.flush()

        session = ExamSession(
            exam_id=exam.id,
            candidate_id=candidate.id,
            registration_id=reg.id,
            status="IN_PROGRESS",
        )
        db.add(session)
        await db.flush()

        event_id = uuid.uuid4()
        meta = {"dismissed": dismissed} if dismissed else {}
        await db.execute(
            text(
                """
                INSERT INTO proctoring_events
                  (id, session_id, event_type, confidence, severity, metadata, occurred_at)
                VALUES
                  (:id, :sid, 'TAB_SWITCH', 0.9, 'HIGH', CAST(:meta AS jsonb), NOW())
                """
            ),
            {
                "id": event_id,
                "sid": session.id,
                "meta": json.dumps(meta),
            },
        )
        await db.commit()
        return str(event_id), tenant_id


@pytest.fixture
async def violation_setup(client: AsyncClient):
    tenant = await _create_tenant()
    role = await _create_role(tenant.id, "admin")
    user, password = await _create_user(tenant.id, role)
    token = await _login(client, user.email, password)
    headers = {"Authorization": f"Bearer {token}"}
    event_id, _ = await _create_proctoring_event(tenant.id, dismissed=False)
    return {"tenant_id": tenant.id, "headers": headers, "event_id": event_id}


def _data(resp) -> dict:
    body = resp.json()
    return body.get("data", body)


@pytest.mark.anyio
async def test_dismiss_single_violation(client: AsyncClient, violation_setup):
    event_id = violation_setup["event_id"]
    resp = await client.post(
        f"/api/v1/analytics/violations/{event_id}/dismiss",
        headers=violation_setup["headers"],
    )
    assert resp.status_code == 200
    assert _data(resp) == {"dismissed": True}


@pytest.mark.anyio
async def test_dismiss_violation_not_found(client: AsyncClient, violation_setup):
    resp = await client.post(
        f"/api/v1/analytics/violations/{uuid.uuid4()}/dismiss",
        headers=violation_setup["headers"],
    )
    assert resp.status_code == 404


@pytest.mark.anyio
async def test_dismiss_all_violations(client: AsyncClient, violation_setup):
    resp = await client.post(
        "/api/v1/analytics/violations/dismiss-all",
        headers=violation_setup["headers"],
    )
    assert resp.status_code == 200
    data = _data(resp)
    assert "cleared" in data
    assert int(data["cleared"]) >= 1


@pytest.mark.anyio
async def test_restore_violation(client: AsyncClient, violation_setup):
    event_id = violation_setup["event_id"]
    dismiss = await client.post(
        f"/api/v1/analytics/violations/{event_id}/dismiss",
        headers=violation_setup["headers"],
    )
    assert dismiss.status_code == 200

    restore = await client.post(
        f"/api/v1/analytics/violations/{event_id}/restore",
        headers=violation_setup["headers"],
    )
    assert restore.status_code == 200
    assert _data(restore) == {"restored": True}


@pytest.mark.anyio
async def test_purge_recycle_bin(client: AsyncClient, violation_setup):
    event_id = violation_setup["event_id"]
    await client.post(
        f"/api/v1/analytics/violations/{event_id}/dismiss",
        headers=violation_setup["headers"],
    )

    purge = await client.post(
        "/api/v1/analytics/violations/purge-recycle-bin",
        headers=violation_setup["headers"],
    )
    assert purge.status_code == 200
    data = _data(purge)
    assert int(data["deleted"]) >= 1

    detail = await client.get(
        f"/api/v1/analytics/violations/{event_id}",
        headers=violation_setup["headers"],
    )
    assert detail.status_code == 404


@pytest.mark.anyio
async def test_static_dismiss_all_not_captured_by_event_id_route(client: AsyncClient, violation_setup):
    """POST /violations/dismiss-all must not be treated as an event id."""
    resp = await client.post(
        "/api/v1/analytics/violations/dismiss-all",
        headers=violation_setup["headers"],
    )
    assert resp.status_code == 200
    assert "cleared" in _data(resp)


@pytest.mark.anyio
async def test_dismiss_violation_requires_auth(client: AsyncClient, violation_setup):
    resp = await client.post(
        f"/api/v1/analytics/violations/{violation_setup['event_id']}/dismiss",
    )
    assert resp.status_code == 401
