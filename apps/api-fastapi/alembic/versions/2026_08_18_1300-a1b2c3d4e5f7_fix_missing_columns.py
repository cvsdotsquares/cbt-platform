"""fix missing columns: restore users.is_active, add roles.is_active and roles.description

Revision ID: a1b2c3d4e5f7
Revises: eef6c646c1b2
Create Date: 2026-08-18 13:00:00.000000+00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'a1b2c3d4e5f7'
down_revision: Union[str, None] = 'eef6c646c1b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Idempotent — demo DBs may already have some columns from Prisma / partial migrates
    op.execute(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active "
        "BOOLEAN NOT NULL DEFAULT true"
    )
    op.execute(
        "ALTER TABLE roles ADD COLUMN IF NOT EXISTS is_active "
        "BOOLEAN NOT NULL DEFAULT true"
    )
    op.execute(
        "ALTER TABLE roles ADD COLUMN IF NOT EXISTS description VARCHAR(255)"
    )


def downgrade() -> None:
    op.drop_column('roles', 'description')
    op.drop_column('roles', 'is_active')x
    op.drop_column('users', 'is_active')
