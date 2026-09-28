# app/models/candidate.py
from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any, Dict

from sqlalchemy import DateTime, ForeignKey, String, JSON
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.user import User
    from app.models.tenant import Tenant
    from app.models.exam_registration import ExamRegistration
    from app.models.exam_session import ExamSession
    from app.models.exam_result import ExamResult


class Candidate(TimestampMixin, Base):
    __tablename__ = "candidates"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )

    # =========================================================
    # FOREIGN KEYS
    # =========================================================
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # =========================================================
    # CANDIDATE INFORMATION
    # =========================================================
    registration_number: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )

    date_of_birth: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    gender: Mapped[str | None] = mapped_column(
        String(50),
        nullable=True,
    )

    profile_data: Mapped[Dict[str, Any] | None] = mapped_column(
        JSON,
        nullable=True,
    )

    # =========================================================
    # RELATIONSHIPS
    # =========================================================
    tenant: Mapped["Tenant"] = relationship(
        "Tenant",
        back_populates="candidates",
        foreign_keys=[tenant_id],
    )

    user: Mapped["User"] = relationship(
        "User",
        back_populates="candidate",
        foreign_keys=[user_id],
    )

    registrations: Mapped[list["ExamRegistration"]] = relationship(
        "ExamRegistration",
        back_populates="candidate",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    sessions: Mapped[list["ExamSession"]] = relationship(
        "ExamSession",
        back_populates="candidate",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    results: Mapped[list["ExamResult"]] = relationship(
        "ExamResult",
        back_populates="candidate",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    def __repr__(self) -> str:
        return f"<Candidate(id={self.id}, user_id={self.user_id}, reg_no={self.registration_number})>"