# app/models/question_version.py
from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any, Dict, List

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, JSON
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.user import User
    from app.models.question import Question


class QuestionVersion(TimestampMixin, Base):
    __tablename__ = "question_versions"

    id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )

    # =========================================================
    # FOREIGN KEYS
    # =========================================================
    question_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("questions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # =========================================================
    # VERSION INFORMATION
    # =========================================================
    version_number: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )

    content: Mapped[Dict[str, Any] | List[Any] | str] = mapped_column(
        JSON,
        nullable=False,
    )

    options: Mapped[Dict[str, Any] | List[Any] | None] = mapped_column(
        JSON,
        nullable=True,
    )

    correct_answer: Mapped[Dict[str, Any] | List[Any] | str | None] = mapped_column(
        JSON,
        nullable=True,
    )

    media_refs: Mapped[Dict[str, Any] | List[Any] | None] = mapped_column(
        JSON,
        nullable=True,
    )

    test_cases: Mapped[Dict[str, Any] | List[Any] | None] = mapped_column(
        JSON,
        nullable=True,
    )

    marks: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        default=1.0,
    )

    negative_marks: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        default=0.0,
    )

    explanation: Mapped[str | None] = mapped_column(
        String(2000),
        nullable=True,
    )

    # =========================================================
    # APPROVAL
    # =========================================================
    approved_by_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    approved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    # =========================================================
    # RELATIONSHIPS
    # =========================================================
    question: Mapped["Question"] = relationship(
        "Question",
        back_populates="versions",
        foreign_keys=[question_id],
    )

    approved_by: Mapped["User | None"] = relationship(
        "User",
        back_populates="approved_question_versions",
        foreign_keys=[approved_by_id],
    )

    def __repr__(self) -> str:
        return f"<QuestionVersion(id={self.id}, question_id={self.question_id}, version={self.version_number})>"