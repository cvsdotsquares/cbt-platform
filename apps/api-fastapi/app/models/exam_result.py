# app/models/exam_result.py
from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.exam import Exam
    from app.models.candidate import Candidate
    from app.models.exam_session import ExamSession


class ExamResult(TimestampMixin, Base):
    __tablename__ = "exam_results"

    id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )

    # =========================================================
    # FOREIGN KEYS
    # =========================================================
    session_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("exam_sessions.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )

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

    # =========================================================
    # SCORES & RANKS
    # =========================================================
    total_score: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        default=0.0,
    )

    max_score: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        default=0.0,
    )

    percentage: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        default=0.0,
    )

    rank: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )

    percentile: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
    )

    evaluation_status: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        default="PENDING",
    )

    published: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
    )

    published_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    cutoff_met: Mapped[bool | None] = mapped_column(
        Boolean,
        nullable=True,
    )

    # =========================================================
    # RELATIONSHIPS
    # =========================================================
    session: Mapped["ExamSession"] = relationship(
        "ExamSession",
        back_populates="result",
        foreign_keys=[session_id],
    )

    exam: Mapped["Exam"] = relationship(
        "Exam",
        back_populates="results",
        foreign_keys=[exam_id],
    )

    candidate: Mapped["Candidate"] = relationship(
        "Candidate",
        back_populates="results",
        foreign_keys=[candidate_id],
    )

    def __repr__(self) -> str:
        return f"<ExamResult(id={self.id}, exam_id={self.exam_id}, total_score={self.total_score})>"