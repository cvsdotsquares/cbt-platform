# app/models/question.py
from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin
from app.models.question_version import QuestionVersion

if TYPE_CHECKING:
    from app.models.user import User
    from app.models.tenant import Tenant
    from app.models.topic import Topic
    from app.models.exam_question import ExamQuestion


class QuestionStatus:
    """Question status constants"""
    DRAFT = "DRAFT"
    PENDING_REVIEW = "PENDING_REVIEW"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    ARCHIVED = "ARCHIVED"
    PUBLISHED = "PUBLISHED"


class Question(TimestampMixin, Base):
    __tablename__ = "questions"

    id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    type: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        default="MCQ",
    )

    difficulty: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        default="MEDIUM",
    )

    topic_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("topics.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    syllabus_topic_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        nullable=True,
    )

    title: Mapped[str | None] = mapped_column(
        String(500),
        nullable=True,
        index=True,
    )

    description: Mapped[str | None] = mapped_column(
        String(2000),
        nullable=True,
    )

    status: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        default=QuestionStatus.DRAFT,
        index=True,
    )

    current_version_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        nullable=True,
    )

    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # =========================================================
    # RELATIONSHIPS
    # =========================================================
    tenant: Mapped["Tenant"] = relationship(
        "Tenant",
        back_populates="questions",
        foreign_keys=[tenant_id],
    )

    topic: Mapped["Topic | None"] = relationship(
        "Topic",
        back_populates="questions",
        foreign_keys=[topic_id],
        lazy="selectin",
    )

    created_by: Mapped["User | None"] = relationship(
        "User",
        back_populates="created_questions",
        foreign_keys=[created_by_id],
        lazy="selectin",
    )

    versions: Mapped[list["QuestionVersion"]] = relationship(
        "QuestionVersion",
        back_populates="question",
        foreign_keys="[QuestionVersion.question_id]",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    exam_questions: Mapped[list["ExamQuestion"]] = relationship(
        "ExamQuestion",
        back_populates="question",
        foreign_keys="[ExamQuestion.question_id]",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    def __repr__(self) -> str:
        return f"<Question(id={self.id}, type={self.type}, status={self.status})>"


__all__ = ["Question", "QuestionStatus", "QuestionVersion"]