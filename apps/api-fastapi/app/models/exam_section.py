# app/models/exam_section.py
from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

if TYPE_CHECKING:
    from app.models.exam import Exam
    from app.models.exam_question import ExamQuestion


class ExamSection(TimestampMixin, Base):
    __tablename__ = "exam_sections"

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

    # =========================================================
    # SECTION DETAILS
    # =========================================================
    name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )

    description: Mapped[str | None] = mapped_column(
        String(1000),
        nullable=True,
    )

    order_index: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=1,
    )

    duration_minutes: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )

    instructions: Mapped[str | None] = mapped_column(
        String(1000),
        nullable=True,
    )

    negative_marking: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
    )

    # =========================================================
    # RELATIONSHIPS
    # =========================================================
    exam: Mapped["Exam"] = relationship(
        "Exam",
        back_populates="sections",
        foreign_keys=[exam_id],
    )

    exam_questions: Mapped[list["ExamQuestion"]] = relationship(
        "ExamQuestion",
        back_populates="section",
        foreign_keys="[ExamQuestion.section_id]",
        lazy="selectin",
        cascade="all, delete-orphan",
    )

    def __repr__(self) -> str:
        return f"<ExamSection(id={self.id}, name={self.name}, order_index={self.order_index})>"