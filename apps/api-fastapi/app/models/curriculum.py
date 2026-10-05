from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import ENUM
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, UuidStr

SyllabusProgressStatusEnum = ENUM(
    "NOT_STARTED",
    "IN_PROGRESS",
    "COMPLETED",
    name="SyllabusProgressStatus",
    create_type=False,
)

if TYPE_CHECKING:
    pass


class AcademicClass(Base):
    __tablename__ = "academic_classes"

    id: Mapped[str] = mapped_column(UuidStr, primary_key=True)
    tenant_id: Mapped[str | None] = mapped_column(UuidStr, nullable=True)
    level: Mapped[int] = mapped_column(Integer, nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    subjects: Mapped[list["Subject"]] = relationship(
        "Subject", back_populates="academic_class", lazy="selectin"
    )


class TenantOfferedSubject(Base):
    """Subjects a tenant offers for a given academic class (grade)."""

    __tablename__ = "tenant_offered_subjects"

    id: Mapped[str] = mapped_column(UuidStr, primary_key=True)
    tenant_id: Mapped[str] = mapped_column(UuidStr, nullable=False)
    academic_class_id: Mapped[str] = mapped_column(
        UuidStr, ForeignKey("academic_classes.id"), nullable=False
    )
    subject_id: Mapped[str] = mapped_column(UuidStr, ForeignKey("subjects.id"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class Subject(Base):
    __tablename__ = "subjects"

    id: Mapped[str] = mapped_column(UuidStr, primary_key=True)
    academic_class_id: Mapped[str] = mapped_column(UuidStr, ForeignKey("academic_classes.id"), nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    code: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    order_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    academic_class: Mapped["AcademicClass"] = relationship("AcademicClass", back_populates="subjects")
    books: Mapped[list["Book"]] = relationship("Book", back_populates="subject", lazy="selectin")


class Book(Base):
    __tablename__ = "books"

    id: Mapped[str] = mapped_column(UuidStr, primary_key=True)
    subject_id: Mapped[str] = mapped_column(UuidStr, ForeignKey("subjects.id"), nullable=False)
    title: Mapped[str] = mapped_column(String, nullable=False)
    publisher: Mapped[str] = mapped_column(String, nullable=False, default="NCERT")
    is_ncert: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    edition: Mapped[str | None] = mapped_column(String, nullable=True)
    order_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    subject: Mapped["Subject"] = relationship("Subject", back_populates="books")
    chapters: Mapped[list["Chapter"]] = relationship("Chapter", back_populates="book", lazy="selectin")


class Chapter(Base):
    __tablename__ = "chapters"

    id: Mapped[str] = mapped_column(UuidStr, primary_key=True)
    book_id: Mapped[str] = mapped_column(UuidStr, ForeignKey("books.id"), nullable=False)
    number: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    order_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    book: Mapped["Book"] = relationship("Book", back_populates="chapters")
    topics: Mapped[list["SyllabusTopic"]] = relationship(
        "SyllabusTopic", back_populates="chapter", lazy="selectin"
    )


class SyllabusTopic(Base):
    __tablename__ = "syllabus_topics"

    id: Mapped[str] = mapped_column(UuidStr, primary_key=True)
    chapter_id: Mapped[str] = mapped_column(UuidStr, ForeignKey("chapters.id"), nullable=False)
    title: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    order_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    chapter: Mapped["Chapter"] = relationship("Chapter", back_populates="topics")


class Batch(Base):
    __tablename__ = "batches"

    id: Mapped[str] = mapped_column(UuidStr, primary_key=True)
    tenant_id: Mapped[str] = mapped_column(UuidStr, nullable=False)
    academic_class_id: Mapped[str] = mapped_column(UuidStr, ForeignKey("academic_classes.id"), nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    academic_year: Mapped[str] = mapped_column(String, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    academic_class: Mapped["AcademicClass"] = relationship("AcademicClass", lazy="selectin")
    enrollments: Mapped[list["BatchEnrollment"]] = relationship(
        "BatchEnrollment", back_populates="batch", lazy="selectin"
    )
    teacher_assignments: Mapped[list["TeacherAssignment"]] = relationship(
        "TeacherAssignment", back_populates="batch", lazy="selectin"
    )


class BatchEnrollment(Base):
    __tablename__ = "batch_enrollments"

    id: Mapped[str] = mapped_column(UuidStr, primary_key=True)
    batch_id: Mapped[str] = mapped_column(UuidStr, ForeignKey("batches.id"), nullable=False)
    candidate_id: Mapped[str] = mapped_column(UuidStr, nullable=False)
    roll_number: Mapped[str | None] = mapped_column(String, nullable=True)
    roll_locked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    enrolled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    batch: Mapped["Batch"] = relationship("Batch", back_populates="enrollments")


class TeacherAssignment(Base):
    __tablename__ = "teacher_assignments"

    id: Mapped[str] = mapped_column(UuidStr, primary_key=True)
    user_id: Mapped[str] = mapped_column(UuidStr, nullable=False)
    batch_id: Mapped[str] = mapped_column(UuidStr, ForeignKey("batches.id"), nullable=False)
    subject_id: Mapped[str] = mapped_column(UuidStr, ForeignKey("subjects.id"), nullable=False)
    assigned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    batch: Mapped["Batch"] = relationship("Batch", back_populates="teacher_assignments")
    subject: Mapped["Subject"] = relationship("Subject", lazy="selectin")


class SyllabusProgress(Base):
    __tablename__ = "syllabus_progress"

    id: Mapped[str] = mapped_column(UuidStr, primary_key=True)
    batch_id: Mapped[str] = mapped_column(UuidStr, ForeignKey("batches.id"), nullable=False)
    chapter_id: Mapped[str | None] = mapped_column(UuidStr, ForeignKey("chapters.id"), nullable=True)
    topic_id: Mapped[str | None] = mapped_column(UuidStr, ForeignKey("syllabus_topics.id"), nullable=True)
    material_id: Mapped[str | None] = mapped_column(
        UuidStr, ForeignKey("study_materials.id"), nullable=True
    )
    status: Mapped[str] = mapped_column(SyllabusProgressStatusEnum, nullable=False, default="NOT_STARTED")
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_by_id: Mapped[str | None] = mapped_column(UuidStr, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
