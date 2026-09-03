# app/models/user.py
from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import ENUM
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UuidStr
from app.models.user_role import UserRole, user_roles

UserStatusEnum = ENUM(
    "ACTIVE",
    "INACTIVE",
    "SUSPENDED",
    "PENDING_VERIFICATION",
    name="UserStatus",
    create_type=False,
)

if TYPE_CHECKING:
    from app.models.tenant import Tenant
    from app.models.role import Role
    from app.models.candidate import Candidate
    from app.models.session import Session
    from app.models.refresh_token import RefreshToken
    from app.models.login_history import LoginHistory
    from app.models.exam import Exam
    from app.models.question import Question
    from app.models.question_version import QuestionVersion


class UserStatus:
    """Allowed status values for a user."""
    PENDING_VERIFICATION = "PENDING_VERIFICATION"
    ACTIVE = "ACTIVE"
    SUSPENDED = "SUSPENDED"
    DISABLED = "DISABLED"
    BLOCKED = "BLOCKED"


class User(TimestampMixin, Base):
    __tablename__ = "users"

    # ============================================================
    # PRIMARY KEY
    # ============================================================
    id: Mapped[str] = mapped_column(
        UuidStr,
        primary_key=True,
        default=lambda: str(uuid.uuid4()),
    )

    # ============================================================
    # USER INFORMATION
    # ============================================================
    email: Mapped[str] = mapped_column(
        String(320),
        unique=True,
        index=True,
        nullable=False,
    )

    first_name: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True,
        default="",
    )

    last_name: Mapped[str | None] = mapped_column(
        String(100),
        nullable=True,
        default="",
    )

    # ============================================================
    # AUTHENTICATION
    # ============================================================
    password_hash: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )

    # ============================================================
    # STATUS
    # ============================================================
    status: Mapped[str] = mapped_column(
        UserStatusEnum,
        nullable=False,
        default=UserStatus.ACTIVE,
    )

    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
    )

    # ============================================================
    # TENANT
    # ============================================================
    tenant_id: Mapped[str] = mapped_column(
        UuidStr,
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # ============================================================
    # ADDITIONAL FIELDS
    # ============================================================
    failed_attempts: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
    )

    locked_until: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    phone: Mapped[str | None] = mapped_column(
        String(50),
        nullable=True,
    )

    avatar_url: Mapped[str | None] = mapped_column(
        String(500),
        nullable=True,
    )

    mfa_enabled: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
    )

    mfa_secret: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
    )

    email_verified: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
    )

    phone_verified: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
    )

    last_login_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    # ============================================================
    # RELATIONSHIPS
    # ============================================================
    tenant: Mapped["Tenant"] = relationship(
        "Tenant",
        back_populates="users",
        foreign_keys=[tenant_id],
    )

    user_roles: Mapped[list["UserRole"]] = relationship(
        "UserRole",
        back_populates="user",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    roles: Mapped[list["Role"]] = relationship(
        "Role",
        secondary="user_roles",
        viewonly=True,
        lazy="select",
    )

    candidate: Mapped["Candidate | None"] = relationship(
        "Candidate",
        back_populates="user",
        uselist=False,
        cascade="all, delete-orphan",
        lazy="select",
    )

    sessions: Mapped[list["Session"]] = relationship(
        "Session",
        back_populates="user",
        cascade="all, delete-orphan",
        lazy="select",
    )

    refresh_tokens: Mapped[list["RefreshToken"]] = relationship(
        "RefreshToken",
        back_populates="user",
        cascade="all, delete-orphan",
        lazy="select",
    )

    login_history: Mapped[list["LoginHistory"]] = relationship(
        "LoginHistory",
        back_populates="user",
        cascade="all, delete-orphan",
        lazy="select",
    )

    created_exams: Mapped[list["Exam"]] = relationship(
        "Exam",
        back_populates="created_by",
        foreign_keys="[Exam.created_by_id]",
    )

    created_questions: Mapped[list["Question"]] = relationship(
        "Question",
        back_populates="created_by",
        foreign_keys="[Question.created_by_id]",
    )

    approved_question_versions: Mapped[list["QuestionVersion"]] = relationship(
        "QuestionVersion",
        back_populates="approved_by",
        foreign_keys="[QuestionVersion.approved_by_id]",
    )

    @property
    def full_name(self) -> str:
        first = self.first_name or ""
        last = self.last_name or ""
        return f"{first} {last}".strip() or self.email

    @property
    def role(self) -> str:
        if self.roles and len(self.roles) > 0:
            return self.roles[0].name
        return "user"

    @property
    def is_superuser(self) -> bool:
        role_names = [r.name.lower() for r in (self.roles or [])]
        return "admin" in role_names or "super_admin" in role_names

    # ============================================================
    # REPRESENTATION
    # ============================================================
    def __repr__(self) -> str:
        return f"<User(id={self.id}, email={self.email}, status={self.status})>"


__all__ = ["User", "UserStatus", "UserRole", "user_roles"]