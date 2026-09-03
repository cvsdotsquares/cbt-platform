# app/models/exam_session.py
from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any, Dict, List

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, JSON
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.exam import Exam
    from app.models.candidate import Candidate
    from app.models.exam_registration import ExamRegistration
    from app.models.exam_result import ExamResult


class ExamSession(TimestampMixin, Base):
    __tablename__ = "exam_sessions"

    id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )

    # =========================================================
    # FOREIGN KEYS
    # =========================================================
    exam_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("exams.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    candidate_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("candidates.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    registration_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("exam_registrations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # =========================================================
    # SESSION DETAILS
    # =========================================================
    status: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        default="WAITING",
        index=True,
    )

    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    submitted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    time_remaining_seconds: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )

    current_section_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        nullable=True,
    )

    question_order: Mapped[Dict[str, Any] | List[Any] | None] = mapped_column(
        JSON,
        nullable=True,
    )

    risk_score: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        default=0.0,
    )

    ip_address: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
    )

    device_fingerprint: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
    )

    user_agent: Mapped[str | None] = mapped_column(
        String(512),
        nullable=True,
    )

    attempt_number: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=1,
    )

    # =========================================================
    # RELATIONSHIPS
    # =========================================================
    exam: Mapped["Exam"] = relationship(
        "Exam",
        back_populates="sessions",
        foreign_keys=[exam_id],
    )

    candidate: Mapped["Candidate"] = relationship(
        "Candidate",
        back_populates="sessions",
        foreign_keys=[candidate_id],
    )

    registration: Mapped["ExamRegistration"] = relationship(
        "ExamRegistration",
        back_populates="sessions",
        foreign_keys=[registration_id],
    )

    result: Mapped["ExamResult | None"] = relationship(
        "ExamResult",
        back_populates="session",
        uselist=False,
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    def __repr__(self) -> str:
        return f"<ExamSession(id={self.id}, exam_id={self.exam_id}, candidate_id={self.candidate_id}, status={self.status})>"