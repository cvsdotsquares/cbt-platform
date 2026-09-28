import re
from datetime import datetime, timedelta, timezone
from math import ceil
from zoneinfo import ZoneInfo
from typing import Any

from fastapi import HTTPException
from fastapi import status as http_status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
import uuid

from app.models.candidate import Candidate

DEFAULT_EXAM_TIMEZONE = "Asia/Kolkata"
DEFAULT_PAST_START_GRACE_MINUTES = 2
DEFAULT_EXAM_START_STEP_MINUTES = 5
CANDIDATE_VISIBLE_EXAM_STATUSES = frozenset({"PUBLISHED", "IN_PROGRESS", "COMPLETED"})

# Mirror of NestJS Permission enum — only the exam-related subset used here.
# The full permission system belongs to a future auth phase; for now we map
# NestJS permissions to the coarse role-check already in security.py.
EXAM_WRITE_ROLES = frozenset({"admin", "manager"})
EXAM_READ_ROLES = frozenset({"admin", "manager", "user"})


def is_utc_iso_or_offset(value: str) -> bool:
    return bool(re.search(r"[zZ]$|[+-]\d{2}:\d{2}$", value.strip()))


def parse_exam_datetime(value: str, time_zone: str = DEFAULT_EXAM_TIMEZONE) -> datetime:
    trimmed = value.strip()
    if is_utc_iso_or_offset(trimmed):
        parsed = datetime.fromisoformat(trimmed)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)

    parsed = datetime.fromisoformat(trimmed)
    if parsed.tzinfo is not None:
        return parsed.astimezone(timezone.utc)

    try:
        tz = ZoneInfo(time_zone)
    except Exception as exc:
        raise ValueError(f"Invalid timezone: {time_zone}") from exc

    local_dt = parsed.replace(tzinfo=tz)
    return local_dt.astimezone(timezone.utc)


def round_up_exam_start(
    now: datetime | None = None,
    step_minutes: int = DEFAULT_EXAM_START_STEP_MINUTES,
    min_ahead_minutes: int = 1,
) -> datetime:
    """Next start instant on a 5-minute clock, at least `min_ahead_minutes` ahead."""
    if now is None:
        now = datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    now_utc = now.astimezone(timezone.utc)
    step_seconds = max(1, int(step_minutes)) * 60
    min_start = now_utc.timestamp() + max(0, min_ahead_minutes) * 60
    return datetime.fromtimestamp(ceil(min_start / step_seconds) * step_seconds, tz=timezone.utc)


def get_draft_exam_window(
    duration_minutes: int,
    now: datetime | None = None,
) -> tuple[datetime, datetime]:
    minutes = int(duration_minutes) if duration_minutes and duration_minutes > 0 else 30
    start = round_up_exam_start(now)
    return start, start + timedelta(minutes=minutes)


def validate_exam_schedule(
    start: datetime,
    end: datetime,
    duration_minutes: int | None = None,
    disallow_past_start: bool = False,
    past_grace_minutes: int = DEFAULT_PAST_START_GRACE_MINUTES,
) -> dict[str, Any]:
    if start.tzinfo is None or end.tzinfo is None:
        return {"ok": False, "message": "Start and end times must include timezone information."}
    if end <= start:
        return {
            "ok": False,
            "message": (
                "End time must be after start time. "
                "Choose a later end time for the exam window."
            ),
        }
    if disallow_past_start:
        now = datetime.now(timezone.utc)
        grace = max(0, past_grace_minutes)
        if start < now - timedelta(minutes=grace):
            return {
                "ok": False,
                "message": "Start time cannot be in the past. Choose a future start time.",
            }
    if duration_minutes is not None and duration_minutes > 0:
        window_minutes = (end - start).total_seconds() / 60
        if window_minutes < duration_minutes:
            return {
                "ok": False,
                "message": (
                    f"Exam window must be at least {duration_minutes} minutes long "
                    f"(test duration). End time is too early."
                ),
            }
    return {"ok": True}


async def resolve_candidate_id(db: AsyncSession, user_id: uuid.UUID) -> uuid.UUID:
    result = await db.execute(select(Candidate).where(Candidate.user_id == user_id))
    candidate = result.scalar_one_or_none()
    if candidate is None:
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail="Candidate profile not found. Please complete registration.",
        )
    return candidate.id


def assert_exam_visible_to_candidate(exam_status: str) -> None:
    """Raise 400 if the exam is not in a state visible to candidates.

    NOTE: parameter is named `exam_status` (not `status`) to avoid shadowing
    `fastapi.status` which was the bug in the original implementation.
    """
    if exam_status not in CANDIDATE_VISIBLE_EXAM_STATUSES:
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail="This exam has not been published yet",
        )


# Re-export ExamStatus so the router can import it from here without touching models directly
from app.models.exam import ExamStatus  # noqa: E402 – intentional re-export
