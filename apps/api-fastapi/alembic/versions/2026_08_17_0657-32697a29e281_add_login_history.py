"""add login history

Revision ID: 32697a29e281
Revises: f3a4b5c6d7e8
Create Date: 2026-08-17 06:57:41.925950+00:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "32697a29e281"
down_revision: Union[str, None] = "f3a4b5c6d7e8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create login_history table."""

    op.create_table(
        "login_history",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("ip_address", sa.String(length=64), nullable=False),
        sa.Column("user_agent", sa.String(length=512), nullable=False),
        sa.Column(
            "device_fingerprint",
            sa.String(length=255),
            nullable=False,
        ),
        sa.Column("success", sa.Boolean(), nullable=False),
        sa.Column(
            "failure_reason",
            sa.String(length=255),
            nullable=True,
        ),
        sa.Column(
            "geo_country",
            sa.String(length=100),
            nullable=True,
        ),
        sa.Column(
            "geo_city",
            sa.String(length=100),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )

    op.create_index(
        "ix_login_history_user_id",
        "login_history",
        ["user_id"],
        unique=False,
    )


def downgrade() -> None:
    """Drop login_history table."""

    op.drop_index(
        "ix_login_history_user_id",
        table_name="login_history",
    )

    op.drop_table("login_history")