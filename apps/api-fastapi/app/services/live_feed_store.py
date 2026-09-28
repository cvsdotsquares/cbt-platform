"""In-memory latest proctoring frame per session (FastAPI dev / no Socket.IO)."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from datetime import datetime, timezone

MAX_THUMBNAIL_LEN = 600_000
FEED_TTL_SECONDS = 300


@dataclass
class SessionFeed:
    screen: str | None = None
    camera: str | None = None
    updated_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


_lock = asyncio.Lock()
_feeds: dict[str, SessionFeed] = {}
_session_exam: dict[str, str] = {}


def _is_stale(feed: SessionFeed) -> bool:
    age = (datetime.now(timezone.utc) - feed.updated_at).total_seconds()
    return age > FEED_TTL_SECONDS


async def set_live_frame(
    session_id: str,
    exam_id: str,
    source: str,
    thumbnail: str,
) -> None:
    if source not in ("screen", "camera"):
        raise ValueError("Invalid source")
    if not thumbnail or len(thumbnail) > MAX_THUMBNAIL_LEN:
        raise ValueError("Invalid thumbnail")

    async with _lock:
        feed = _feeds.get(session_id) or SessionFeed()
        if source == "screen":
            feed.screen = thumbnail
        else:
            feed.camera = thumbnail
        feed.updated_at = datetime.now(timezone.utc)
        _feeds[session_id] = feed
        _session_exam[session_id] = exam_id


async def get_exam_feeds(exam_id: str, session_ids: list[str] | None = None) -> dict[str, dict]:
    async with _lock:
        out: dict[str, dict] = {}
        ids = session_ids if session_ids is not None else [
            sid for sid, eid in _session_exam.items() if eid == exam_id
        ]
        for sid in ids:
            feed = _feeds.get(sid)
            if not feed or _is_stale(feed):
                continue
            out[sid] = {
                "screen": feed.screen,
                "camera": feed.camera,
                "updatedAt": feed.updated_at.isoformat(),
            }
        return out
