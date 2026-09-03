"""add user password_hash

Revision ID: 304cee13a9d2
Revises: '44d0a50db61e'
Create Date: 2026-08-12 07:09:38.827999+00:00

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '304cee13a9d2'
down_revision: Union[str, None] = '44d0a50db61e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "password_hash",
            sa.String(length=255),
            nullable=False,
            server_default="",
        ),
    )
    op.alter_column(
        "users",
        "password_hash",
        server_default=None,
        existing_type=sa.String(length=255),
        existing_nullable=False,
    )


def downgrade() -> None:
    op.drop_column("users", "password_hash")
