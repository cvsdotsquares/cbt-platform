# app/models/session.py
from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import String, Boolean, DateTime, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.user import User


class Session(TimestampMixin, Base):
    __tablename__ = "sessions"

    # =========================================================
    # PRIMARY KEY
    # =========================================================
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )

    # =========================================================
    # USER
    # =========================================================
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # =========================================================
    # SESSION SECURITY
    # =========================================================
    refresh_token_hash: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        index=True,
    )

    device_fingerprint: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        default="unknown",
    )

    user_agent: Mapped[str] = mapped_column(
        String(512),
        nullable=False,
        default="unknown",
    )

    ip_address: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        default="unknown",
    )

    is_trusted_device: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
    )

    # =========================================================
    # EXPIRATION / REVOCATION
    # =========================================================
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )

    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    # =========================================================
    # RELATIONSHIP
    # =========================================================
    user: Mapped["User"] = relationship(
        "User",
        back_populates="sessions",
        foreign_keys=[user_id],
    )

    def __repr__(self) -> str:
        return f"<Session id={self.id} user_id={self.user_id} expires_at={self.expires_at}>"