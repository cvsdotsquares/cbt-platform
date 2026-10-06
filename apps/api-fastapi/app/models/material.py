from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import ENUM
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, UuidStr

MaterialTypeEnum = ENUM(
    "NCERT",
    "INSTITUTE_NOTES",
    "QUESTION_BANK",
    "WORKSHEET",
    "TEACHER_NOTES",
    name="MaterialType",
    create_type=False,
)
MaterialStatusEnum = ENUM(
    "PENDING",
    "INDEXING",
    "READY",
    "FAILED",
    name="MaterialStatus",
    create_type=False,
)

if TYPE_CHECKING:
    from app.models.curriculum import AcademicClass, Batch, Book, Chapter, Subject, SyllabusTopic


class StudyMaterial(Base):
    __tablename__ = "study_materials"

    id: Mapped[str] = mapped_column(UuidStr, primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[str] = mapped_column(UuidStr, nullable=False)
    academic_class_id: Mapped[str | None] = mapped_column(UuidStr, ForeignKey("academic_classes.id"), nullable=True)
    batch_id: Mapped[str | None] = mapped_column(UuidStr, ForeignKey("batches.id"), nullable=True)
    subject_id: Mapped[str | None] = mapped_column(UuidStr, ForeignKey("subjects.id"), nullable=True)
    book_id: Mapped[str | None] = mapped_column(UuidStr, ForeignKey("books.id"), nullable=True)
    chapter_id: Mapped[str | None] = mapped_column(UuidStr, ForeignKey("chapters.id"), nullable=True)
    topic_id: Mapped[str | None] = mapped_column(UuidStr, ForeignKey("syllabus_topics.id"), nullable=True)
    is_full_book: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    type: Mapped[str] = mapped_column(MaterialTypeEnum, nullable=False)
    title: Mapped[str] = mapped_column(String, nullable=False)
    file_name: Mapped[str] = mapped_column(String, nullable=False)
    file_url: Mapped[str] = mapped_column(String, nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)
    mime_type: Mapped[str] = mapped_column(String, nullable=False)
    academic_session: Mapped[str] = mapped_column(String, nullable=False, default="2025-26")
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    uploaded_by_id: Mapped[str | None] = mapped_column(UuidStr, nullable=True)
    status: Mapped[str] = mapped_column(MaterialStatusEnum, nullable=False, default="PENDING")
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    chunk_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    indexed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    academic_class: Mapped["AcademicClass | None"] = relationship("AcademicClass", lazy="selectin")
    batch: Mapped["Batch | None"] = relationship("Batch", lazy="selectin")
    subject: Mapped["Subject | None"] = relationship("Subject", lazy="selectin")
    chapter: Mapped["Chapter | None"] = relationship("Chapter", lazy="selectin")
    topic: Mapped["SyllabusTopic | None"] = relationship("SyllabusTopic", lazy="selectin")
