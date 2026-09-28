from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.exam_engine import _duration_minutes, _time_remaining, evaluate_session

VALID_EVENT_TYPES = {
    "NO_FACE",
    "MULTIPLE_FACES",
    "FACE_MISMATCH",
    "LOOKING_AWAY",
    "HEAD_TURNED",
    "PHONE_DETECTED",
    "AUDIO_ANOMALY",
    "TAB_SWITCH",
    "WINDOW_BLUR",
    "COPY_ATTEMPT",
    "PASTE_ATTEMPT",
    "RIGHT_CLICK",
    "DEVTOOLS",
    "PRINT_ATTEMPT",
    "SCREEN_CAPTURE",
    "FULLSCREEN_EXIT",
    "VPN_DETECTED",
    "VM_DETECTED",
}

SEVERITY_WEIGHTS = {"LOW": 5, "MEDIUM": 15, "HIGH": 35, "CRITICAL": 50}

ACTIVE_STATUSES = ("IN_PROGRESS", "PAUSED")
STALE_SESSION_SECONDS = 180

EXAM_VIOLATION_AUTO_SUBMIT_THRESHOLD = 3

VIOLATION_LABELS = {
    "NO_FACE": "No face detected",
    "MULTIPLE_FACES": "Multiple faces detected",
    "FACE_MISMATCH": "Face mismatch",
    "LOOKING_AWAY": "Candidate looked away",
    "HEAD_TURNED": "Head turned from screen",
    "PHONE_DETECTED": "Phone detected",
    "AUDIO_ANOMALY": "Audio anomaly",
    "TAB_SWITCH": "Tab switch detected",
    "WINDOW_BLUR": "Window lost focus",
    "COPY_ATTEMPT": "Copy attempt blocked",
    "PASTE_ATTEMPT": "Paste attempt blocked",
    "COPY_PASTE": "Copy/paste attempt",
    "RIGHT_CLICK": "Right-click blocked",
    "DEVTOOLS": "Developer tools opened",
    "PRINT_ATTEMPT": "Print attempt blocked",
    "SCREEN_CAPTURE": "Screen capture detected",
    "FULLSCREEN_EXIT": "Exited fullscreen",
    "VPN_DETECTED": "VPN detected",
    "VM_DETECTED": "Virtual machine detected",
}


def violation_label(event_type: str) -> str:
    return VIOLATION_LABELS.get(event_type, event_type.replace("_", " ").lower())


def violation_description(event_type: str, metadata: dict | None) -> str:
    descriptions = {
        "TAB_SWITCH": (
            "The candidate left the exam tab or minimized the window. "
            "Repeated tab switches count toward the auto-submit limit."
        ),
        "WINDOW_BLUR": "The exam window lost focus while another window or app was active.",
        "FULLSCREEN_EXIT": "The candidate exited required fullscreen mode.",
        "COPY_ATTEMPT": "A copy action was blocked during the exam.",
        "PASTE_ATTEMPT": "A paste action was blocked during the exam.",
        "RIGHT_CLICK": "Context menu (right-click) was blocked.",
        "DEVTOOLS": "Developer tools may have been opened.",
    }
    base = descriptions.get(
        event_type,
        f"Security event recorded: {violation_label(event_type)}.",
    )
    if metadata and isinstance(metadata.get("action"), str):
        return f"{base} Detail: {metadata['action'].replace('_', ' ')}."
    return base


async def update_risk_score(db: AsyncSession, session_id: str) -> float:
    since = datetime.now(timezone.utc) - timedelta(minutes=5)
    rows = await db.execute(
        text(
            """
            SELECT severity FROM proctoring_events
            WHERE session_id = :sid AND occurred_at >= :since
            ORDER BY occurred_at DESC
            """
        ),
        {"sid": session_id, "since": since},
    )
    risk = 0.0
    for row in rows.mappings():
        risk += SEVERITY_WEIGHTS.get(row["severity"], 5)
    risk = min(risk, 100.0)
    await db.execute(
        text("UPDATE exam_sessions SET risk_score = :r, updated_at = NOW() WHERE id = :sid"),
        {"r": risk, "sid": session_id},
    )
    return risk


async def get_event_detail(db: AsyncSession, event_id: str, tenant_id: str) -> dict | None:
    row = await db.execute(
        text(
            """
            SELECT pe.id, pe.event_type, pe.severity, pe.confidence, pe.metadata, pe.occurred_at,
                   es.id AS session_id, es.status AS session_status, es.risk_score,
                   e.id AS exam_id, e.title AS exam_title, e.code AS exam_code,
                   c.id AS candidate_id, c.registration_number,
                   u.first_name, u.last_name, u.email
            FROM proctoring_events pe
            JOIN exam_sessions es ON es.id = pe.session_id
            JOIN exams e ON e.id = es.exam_id
            JOIN candidates c ON c.id = es.candidate_id
            JOIN users u ON u.id = c.user_id
            WHERE pe.id::text = :eid AND e.tenant_id::text = :tid
            """
        ),
        {"eid": event_id, "tid": tenant_id},
    )
    event_row = row.mappings().first()
    if not event_row:
        return None

    session_id = str(event_row["session_id"])
    meta = event_row.get("metadata")
    if isinstance(meta, str):
        try:
            meta = json.loads(meta)
        except json.JSONDecodeError:
            meta = {}
    if not isinstance(meta, dict):
        meta = {}

    counts_result = await db.execute(
        text(
            """
            SELECT event_type, COUNT(*)::int AS count
            FROM proctoring_events
            WHERE session_id = :sid
            GROUP BY event_type
            ORDER BY count DESC, event_type ASC
            """
        ),
        {"sid": session_id},
    )
    by_type = [
        {
            "eventType": r["event_type"],
            "label": violation_label(r["event_type"]),
            "count": int(r["count"]),
        }
        for r in counts_result.mappings()
    ]
    total_violations = sum(item["count"] for item in by_type)
    tab_switch_count = next(
        (item["count"] for item in by_type if item["eventType"] == "TAB_SWITCH"),
        0,
    )

    timeline = await db.execute(
        text(
            """
            SELECT id, event_type, severity, metadata, occurred_at
            FROM proctoring_events
            WHERE session_id = :sid
            ORDER BY occurred_at DESC
            LIMIT 25
            """
        ),
        {"sid": session_id},
    )
    recent_events = []
    for r in timeline.mappings():
        item_meta = r.get("metadata")
        if isinstance(item_meta, str):
            try:
                item_meta = json.loads(item_meta)
            except json.JSONDecodeError:
                item_meta = {}
        if not isinstance(item_meta, dict):
            item_meta = {}
        et = r["event_type"]
        recent_events.append(
            {
                "id": str(r["id"]),
                "eventType": et,
                "label": violation_label(et),
                "description": violation_description(et, item_meta),
                "severity": r["severity"],
                "occurredAt": r["occurred_at"].isoformat()
                if hasattr(r["occurred_at"], "isoformat")
                else str(r["occurred_at"]),
            }
        )

    et = event_row["event_type"]
    return {
        "event": {
            "id": str(event_row["id"]),
            "eventType": et,
            "label": violation_label(et),
            "description": violation_description(et, meta),
            "severity": event_row["severity"],
            "occurredAt": event_row["occurred_at"].isoformat()
            if hasattr(event_row["occurred_at"], "isoformat")
            else str(event_row["occurred_at"]),
            "metadata": meta,
        },
        "student": {
            "candidateId": str(event_row["candidate_id"]),
            "name": f"{event_row['first_name']} {event_row['last_name']}".strip(),
            "email": event_row["email"],
            "registrationNumber": event_row.get("registration_number"),
        },
        "exam": {
            "id": str(event_row["exam_id"]),
            "title": event_row["exam_title"],
            "code": event_row["exam_code"],
        },
        "session": {
            "sessionId": session_id,
            "status": event_row["session_status"],
            "riskScore": float(event_row["risk_score"] or 0),
            "totalViolations": total_violations,
            "tabSwitchCount": tab_switch_count,
            "autoSubmitThreshold": EXAM_VIOLATION_AUTO_SUBMIT_THRESHOLD,
            "autoSubmitTriggered": total_violations > EXAM_VIOLATION_AUTO_SUBMIT_THRESHOLD,
        },
        "violationSummary": by_type,
        "recentEvents": recent_events,
    }


async def _close_stale_sessions(db: AsyncSession, exam_id: str) -> None:
    """Auto-submit sessions with no heartbeat (updated_at) within the stale window."""
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=STALE_SESSION_SECONDS)
    stale_rows = await db.execute(
        text(
            """
            SELECT es.id
            FROM exam_sessions es
            WHERE es.exam_id = :eid
              AND es.status IN ('IN_PROGRESS', 'PAUSED')
              AND COALESCE(es.updated_at, es.started_at, es.created_at) < :cutoff
            """
        ),
        {"eid": exam_id, "cutoff": cutoff},
    )
    stale_ids = [str(r["id"]) for r in stale_rows.mappings()]
    if not stale_ids:
        return

    now = datetime.now(timezone.utc)
    for sid in stale_ids:
        await db.execute(
            text(
                """
                UPDATE exam_sessions
                SET status = 'AUTO_SUBMITTED',
                    submitted_at = :now,
                    time_remaining_seconds = 0,
                    updated_at = :now
                WHERE id = :sid AND status IN ('IN_PROGRESS', 'PAUSED')
                """
            ),
            {"sid": sid, "now": now},
        )
        await evaluate_session(db, sid)
    await db.commit()


def _exam_proctoring_enabled(security_policy) -> bool:
    if not security_policy:
        return True
    if isinstance(security_policy, str):
        try:
            security_policy = json.loads(security_policy)
        except json.JSONDecodeError:
            return True
    if not isinstance(security_policy, dict):
        return True
    return security_policy.get("proctoringEnabled") is not False


async def get_live_monitoring(db: AsyncSession, exam_id: str, tenant_id: str) -> dict:
    exam_row = await db.execute(
        text("SELECT id, security_policy FROM exams WHERE id = :eid AND tenant_id = :tid"),
        {"eid": exam_id, "tid": tenant_id},
    )
    exam = exam_row.mappings().first()
    if not exam:
        return None
    proctoring_enabled = _exam_proctoring_enabled(exam.get("security_policy"))

    await _close_stale_sessions(db, exam_id)

    result = await db.execute(
        text(
            """
            SELECT
              es.id AS session_id,
              es.candidate_id,
              es.status,
              es.risk_score,
              es.started_at,
              es.time_remaining_seconds,
              es.updated_at,
              e.settings,
              e.start_time,
              e.end_time,
              u.first_name,
              u.last_name,
              (
                SELECT COUNT(*)::int FROM proctoring_events pe
                WHERE pe.session_id = es.id
              ) AS recent_violations
            FROM exam_sessions es
            JOIN exams e ON e.id = es.exam_id
            JOIN candidates c ON c.id = es.candidate_id
            JOIN users u ON u.id = c.user_id
            WHERE es.exam_id = :eid AND es.status IN ('IN_PROGRESS', 'PAUSED')
            ORDER BY es.risk_score DESC, es.started_at DESC NULLS LAST
            """
        ),
        {"eid": exam_id},
    )
    candidates = []
    active_count = 0
    now = datetime.now(timezone.utc)
    for row in result.mappings():
        if row["status"] == "IN_PROGRESS":
            active_count += 1
        stored_remaining = row.get("time_remaining_seconds")
        if stored_remaining is not None and int(stored_remaining) >= 0:
            remaining = int(stored_remaining)
        else:
            duration = _duration_minutes(row["settings"], row["start_time"], row["end_time"])
            remaining = _time_remaining(row["started_at"], duration, row["end_time"])
        updated_at = row["updated_at"]
        if updated_at and getattr(updated_at, "tzinfo", None) is None:
            updated_at = updated_at.replace(tzinfo=timezone.utc)
        seconds_since_active = (
            int((now - updated_at).total_seconds()) if updated_at else None
        )
        candidates.append(
            {
                "sessionId": str(row["session_id"]),
                "candidateId": str(row["candidate_id"]),
                "name": f"{row['first_name']} {row['last_name']}".strip(),
                "riskScore": float(row["risk_score"] or 0),
                "status": row["status"],
                "timeRemaining": remaining,
                "recentViolations": int(row["recent_violations"] or 0),
                "lastActiveSecondsAgo": seconds_since_active,
            }
        )

    return {
        "examId": exam_id,
        "activeCount": active_count,
        "proctoringEnabled": proctoring_enabled,
        "candidates": candidates,
    }


async def record_event(
    db: AsyncSession,
    session_id: str,
    event_type: str,
    severity: str = "LOW",
    confidence: float | None = None,
    metadata: dict | None = None,
) -> dict:
    if event_type not in VALID_EVENT_TYPES:
        raise ValueError(f"Invalid event type: {event_type}")

    sev = severity.upper()
    if sev not in SEVERITY_WEIGHTS:
        sev = "LOW"

    event_id = str(uuid.uuid4())
    await db.execute(
        text(
            """
            INSERT INTO proctoring_events
              (id, session_id, event_type, confidence, severity, metadata, occurred_at)
            VALUES
              (:id, :sid, :etype, :conf, :sev, CAST(:meta AS jsonb), NOW())
            """
        ),
        {
            "id": event_id,
            "sid": session_id,
            "etype": event_type,
            "conf": confidence,
            "sev": sev,
            "meta": json.dumps(metadata or {}),
        },
    )

    risk_score = await update_risk_score(db, session_id) if sev in ("MEDIUM", "HIGH", "CRITICAL") else None
    if risk_score is None:
        row = await db.execute(
            text("SELECT risk_score FROM exam_sessions WHERE id = :sid"),
            {"sid": session_id},
        )
        risk_score = float((row.mappings().first() or {}).get("risk_score") or 0)

    return {"id": event_id, "severity": sev, "riskScore": risk_score}


async def intervene(db: AsyncSession, session_id: str, action: str, message: str | None = None) -> dict | None:
    row = await db.execute(
        text(
            """
            SELECT es.status, es.time_remaining_seconds, es.exam_id, e.tenant_id
            FROM exam_sessions es
            JOIN exams e ON e.id = es.exam_id
            WHERE es.id = :sid
            """
        ),
        {"sid": session_id},
    )
    session = row.mappings().first()
    if not session:
        return None

    new_status = session["status"]
    now = datetime.now(timezone.utc)
    if action == "PAUSE":
        new_status = "PAUSED"
        await db.execute(
            text("UPDATE exam_sessions SET status = 'PAUSED', updated_at = :now WHERE id = :sid"),
            {"sid": session_id, "now": now},
        )
    elif action == "RESUME":
        new_status = "IN_PROGRESS"
        await db.execute(
            text("UPDATE exam_sessions SET status = 'IN_PROGRESS', updated_at = :now WHERE id = :sid"),
            {"sid": session_id, "now": now},
        )
    elif action == "TERMINATE":
        new_status = "TERMINATED"
        await db.execute(
            text(
                """
                UPDATE exam_sessions
                SET status = 'TERMINATED', submitted_at = :now, updated_at = :now
                WHERE id = :sid
                """
            ),
            {"sid": session_id, "now": now},
        )
    else:
        raise ValueError(f"Unknown intervention type: {action}")

    return {
        "sessionId": session_id,
        "examId": str(session["exam_id"]),
        "action": action,
        "status": new_status,
        "message": message or f"Proctor action: {action}",
        "tenantId": str(session["tenant_id"]),
    }
