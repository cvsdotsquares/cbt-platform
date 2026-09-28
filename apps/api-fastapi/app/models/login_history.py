# app/models/login_history.py
from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, String, Boolean
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.user import User


class LoginHistory(TimestampMixin, Base):
    __tablename__ = "login_history"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )

    # =========================================================
    # FOREIGN KEYS
    # =========================================================
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # =========================================================
    # LOGIN INFORMATION
    # =========================================================
    ip_address: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
    )

    user_agent: Mapped[str] = mapped_column(
        String(512),
        nullable=False,
    )

    device_fingerprint: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        default="unknown",
    )

    # =========================================================
    # STATUS
    # =========================================================
    success: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
    )

    failure_reason: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
    )

    geo_country: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True,
    )

    geo_city: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True,
    )

    # =========================================================
    # RELATIONSHIPS
    # =========================================================
    user: Mapped["User"] = relationship(
        "User",
        back_populates="login_history",
        foreign_keys=[user_id],
    )

    def __repr__(self) -> str:
        return f"<LoginHistory(id={self.id}, user_id={self.user_id}, success={self.success})>"