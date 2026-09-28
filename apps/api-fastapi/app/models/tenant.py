# app/models/tenant.py
from __future__ import annotations

import uuid
from typing import TYPE_CHECKING, Dict, Any

from sqlalchemy import Boolean, String, JSON, Enum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UuidStr

if TYPE_CHECKING:
    from app.models.user import User
    from app.models.role import Role
    from app.models.candidate import Candidate
    from app.models.topic import Topic
    from app.models.exam import Exam
    from app.models.question import Question


class TenantIsolationMode:
    """Tenant isolation mode constants"""
    SCHEMA = "SCHEMA"
    DATABASE = "DATABASE"
    ROW_LEVEL = "ROW_LEVEL"


class Tenant(TimestampMixin, Base):
    __tablename__ = "tenants"

    id: Mapped[str] = mapped_column(
        UuidStr,
        primary_key=True,
        default=lambda: str(uuid.uuid4()),
    )

    # =========================================================
    # TENANT INFORMATION
    # =========================================================
    name: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        index=True,
    )

    slug: Mapped[str] = mapped_column(
        String(255),
        unique=True,
        nullable=False,
        index=True,
    )

    domain: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
        unique=True,
    )

    logo_url: Mapped[str | None] = mapped_column(
        String(500),
        nullable=True,
    )

    branding: Mapped[Dict[str, Any] | None] = mapped_column(
        JSON,
        nullable=True,
    )

    # =========================================================
    # CONFIGURATION
    # =========================================================
    isolation_mode: Mapped[str] = mapped_column(
        Enum("SCHEMA", "DATABASE", "ROW_LEVEL", name="tenantisolationmode"),
        nullable=False,
        default=TenantIsolationMode.SCHEMA,
    )

    security_config: Mapped[Dict[str, Any] | None] = mapped_column(
        JSON,
        nullable=True,
    )

    settings: Mapped[Dict[str, Any] | None] = mapped_column(
        JSON,
        nullable=True,
    )

    # =========================================================
    # STATUS
    # =========================================================
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
    )

    # =========================================================
    # RELATIONSHIPS
    # =========================================================
    users: Mapped[list["User"]] = relationship(
        "User",
        back_populates="tenant",
        cascade="all, delete-orphan",
        lazy="select",
    )

    roles: Mapped[list["Role"]] = relationship(
        "Role",
        back_populates="tenant",
        cascade="all, delete-orphan",
        lazy="select",
    )

    candidates: Mapped[list["Candidate"]] = relationship(
        "Candidate",
        back_populates="tenant",
        cascade="all, delete-orphan",
        lazy="select",
    )

    topics: Mapped[list["Topic"]] = relationship(
        "Topic",
        back_populates="tenant",
        cascade="all, delete-orphan",
        lazy="select",
    )

    exams: Mapped[list["Exam"]] = relationship(
        "Exam",
        back_populates="tenant",
        cascade="all, delete-orphan",
        lazy="select",
    )

    questions: Mapped[list["Question"]] = relationship(
        "Question",
        back_populates="tenant",
        cascade="all, delete-orphan",
        lazy="select",
    )

    def __repr__(self) -> str:
        return f"<Tenant(id={self.id}, name={self.name}, slug={self.slug})>"