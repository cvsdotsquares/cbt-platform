# app/models/role_permission.py
from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base

if TYPE_CHECKING:
    from app.models.role import Role
    from app.models.permission import Permission


class RolePermission(Base):
    __tablename__ = "role_permissions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )

    role_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("roles.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    permission_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("permissions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # =========================================================
    # RELATIONSHIPS
    # =========================================================
    role: Mapped["Role"] = relationship(
        "Role",
        back_populates="role_permissions",
        foreign_keys=[role_id],
    )

    permission: Mapped["Permission"] = relationship(
        "Permission",
        back_populates="role_permissions",
        foreign_keys=[permission_id],
    )

    def __repr__(self) -> str:
        return f"<RolePermission(id={self.id}, role_id={self.role_id}, permission_id={self.permission_id})>"


# Table reference for direct SQLAlchemy core queries
role_permissions = RolePermission.__table__