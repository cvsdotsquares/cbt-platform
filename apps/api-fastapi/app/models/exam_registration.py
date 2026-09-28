# app/models/exam_registration.py
from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, String, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.exam import Exam
    from app.models.candidate import Candidate
    from app.models.exam_session import ExamSession


class ExamRegistrationStatus:
    """Exam registration status constants"""
    REGISTERED = "REGISTERED"
    CONFIRMED = "CONFIRMED"
    STARTED = "STARTED"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"
    REJECTED = "REJECTED"


class ExamRegistration(TimestampMixin, Base):
    __tablename__ = "exam_registrations"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )

    # =========================================================
    # FOREIGN KEYS
    # =========================================================
    exam_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("exams.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    candidate_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("candidates.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # =========================================================
    # REGISTRATION INFORMATION
    # =========================================================
    status: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        default=ExamRegistrationStatus.REGISTERED,
        index=True,
    )

    admit_card_url: Mapped[str | None] = mapped_column(
        String(500),
        nullable=True,
    )

    registered_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=datetime.utcnow,
    )

    # =========================================================
    # RELATIONSHIPS
    # =========================================================
    exam: Mapped["Exam"] = relationship(
        "Exam",
        back_populates="registrations",
        foreign_keys=[exam_id],
    )

    candidate: Mapped["Candidate"] = relationship(
        "Candidate",
        back_populates="registrations",
        foreign_keys=[candidate_id],
        lazy="selectin",
    )

    sessions: Mapped[list["ExamSession"]] = relationship(
        "ExamSession",
        back_populates="registration",
        foreign_keys="[ExamSession.registration_id]",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    def __repr__(self) -> str:
        return f"<ExamRegistration(id={self.id}, exam_id={self.exam_id}, candidate_id={self.candidate_id}, status={self.status})>"