# app/models/exam_question.py
from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import Float, ForeignKey, Integer
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.exam import Exam
    from app.models.question import Question
    from app.models.exam_section import ExamSection


class ExamQuestion(Base):
    __tablename__ = "exam_questions"

    id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )

    exam_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("exams.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    section_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("exam_sections.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    question_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("questions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    order_index: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=1,
    )

    marks: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
    )

    negative_marks: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
    )

    # =========================================================
    # RELATIONSHIPS
    # =========================================================
    exam: Mapped["Exam"] = relationship(
        "Exam",
        back_populates="exam_questions",
        foreign_keys=[exam_id],
        lazy="selectin",
    )

    question: Mapped["Question"] = relationship(
        "Question",
        back_populates="exam_questions",
        foreign_keys=[question_id],
        lazy="selectin",
    )

    section: Mapped["ExamSection"] = relationship(
        "ExamSection",
        back_populates="exam_questions",
        foreign_keys=[section_id],
        lazy="selectin",
    )

    def __repr__(self) -> str:
        return f"<ExamQuestion(id={self.id}, exam_id={self.exam_id}, question_id={self.question_id})>"