# app/models/exam.py
from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any, Dict

from sqlalchemy import DateTime, ForeignKey, String, JSON
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin
from app.models.exam_section import ExamSection
from app.models.exam_question import ExamQuestion
from app.models.exam_registration import ExamRegistration, ExamRegistrationStatus
from app.models.exam_session import ExamSession
from app.models.exam_result import ExamResult

if TYPE_CHECKING:
    from app.models.user import User
    from app.models.tenant import Tenant


class ExamStatus:
    """Exam status constants"""
    DRAFT = "DRAFT"
    PUBLISHED = "PUBLISHED"
    ACTIVE = "ACTIVE"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"
    ARCHIVED = "ARCHIVED"


class Exam(TimestampMixin, Base):
    __tablename__ = "exams"

    id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )

    # =========================================================
    # TENANT
    # =========================================================
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # =========================================================
    # BASIC INFORMATION
    # =========================================================
    title: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        index=True,
    )

    code: Mapped[str] = mapped_column(
        String(128),
        nullable=False,
    )

    type: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        default="PRACTICE",
    )

    status: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        default=ExamStatus.DRAFT,
        index=True,
    )

    description: Mapped[str | None] = mapped_column(
        String(1000),
        nullable=True,
    )

    # =========================================================
    # SCHEDULE & TIMEZONE
    # =========================================================
    start_time: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )

    end_time: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )

    timezone: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        default="UTC",
    )

    # =========================================================
    # CONFIGURATIONS (JSON)
    # =========================================================
    settings: Mapped[Dict[str, Any] | None] = mapped_column(
        JSON,
        nullable=True,
    )

    security_policy: Mapped[Dict[str, Any] | None] = mapped_column(
        JSON,
        nullable=True,
    )

    # =========================================================
    # FOREIGN KEYS
    # =========================================================
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    published_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    # =========================================================
    # RELATIONSHIPS
    # =========================================================
    tenant: Mapped["Tenant"] = relationship(
        "Tenant",
        back_populates="exams",
        foreign_keys=[tenant_id],
    )

    created_by: Mapped["User | None"] = relationship(
        "User",
        back_populates="created_exams",
        foreign_keys=[created_by_id],
    )

    sections: Mapped[list["ExamSection"]] = relationship(
        "ExamSection",
        back_populates="exam",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="ExamSection.order_index",
    )

    exam_questions: Mapped[list["ExamQuestion"]] = relationship(
        "ExamQuestion",
        back_populates="exam",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    registrations: Mapped[list["ExamRegistration"]] = relationship(
        "ExamRegistration",
        back_populates="exam",
        foreign_keys="[ExamRegistration.exam_id]",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    sessions: Mapped[list["ExamSession"]] = relationship(
        "ExamSession",
        back_populates="exam",
        foreign_keys="[ExamSession.exam_id]",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    results: Mapped[list["ExamResult"]] = relationship(
        "ExamResult",
        back_populates="exam",
        foreign_keys="[ExamResult.exam_id]",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    # Compatibility properties
    @property
    def duration_minutes(self) -> int:
        if self.start_time and self.end_time:
            return int((self.end_time - self.start_time).total_seconds() / 60)
        return 0

    def __repr__(self) -> str:
        return f"<Exam(id={self.id}, title={self.title[:50]}, status={self.status})>"


__all__ = [
    "Exam",
    "ExamStatus",
    "ExamSection",
    "ExamQuestion",
    "ExamRegistration",
    "ExamRegistrationStatus",
    "ExamSession",
    "ExamResult",
]