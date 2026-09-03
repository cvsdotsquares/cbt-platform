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
    # Restore users.is_active that was dropped by add_candidate_models migration
    op.add_column(
        'users',
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()),
    )

    # Add roles.is_active that is defined in the Role model but missing from the DB
    op.add_column(
        'roles',
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()),
    )

    # Add roles.description that is defined in the Role model but missing from the DB
    op.add_column(
        'roles',
        sa.Column('description', sa.String(length=255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('roles', 'description')
    op.drop_column('roles', 'is_active')
    op.drop_column('users', 'is_active')
