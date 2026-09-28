# app/models/role.py
from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import String, Boolean, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UuidStr

if TYPE_CHECKING:
    from app.models.tenant import Tenant
    from app.models.user_role import UserRole
    from app.models.role_permission import RolePermission
    from app.models.permission import Permission
    from app.models.user import User


class Role(TimestampMixin, Base):
    __tablename__ = "roles"

    id: Mapped[str] = mapped_column(
        UuidStr,
        primary_key=True,
        default=lambda: str(uuid.uuid4()),
    )

    # =========================================================
    # ROLE INFORMATION
    # =========================================================
    name: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        index=True,
    )

    description: Mapped[str | None] = mapped_column(
        String(255),
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
    # FOREIGN KEYS
    # =========================================================
    tenant_id: Mapped[str | None] = mapped_column(
        UuidStr,
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )

    # =========================================================
    # RELATIONSHIPS
    # =========================================================
    tenant: Mapped["Tenant | None"] = relationship(
        "Tenant",
        back_populates="roles",
        foreign_keys=[tenant_id],
    )

    user_roles: Mapped[list["UserRole"]] = relationship(
        "UserRole",
        back_populates="role",
        cascade="all, delete-orphan",
        lazy="select",
    )

    role_permissions: Mapped[list["RolePermission"]] = relationship(
        "RolePermission",
        back_populates="role",
        cascade="all, delete-orphan",
        lazy="select",
    )

    permissions: Mapped[list["Permission"]] = relationship(
        "Permission",
        secondary="role_permissions",
        viewonly=True,
        lazy="select",
    )

    users: Mapped[list["User"]] = relationship(
        "User",
        secondary="user_roles",
        viewonly=True,
        lazy="select",
    )

    def __repr__(self) -> str:
        return f"<Role(id={self.id}, name={self.name})>"