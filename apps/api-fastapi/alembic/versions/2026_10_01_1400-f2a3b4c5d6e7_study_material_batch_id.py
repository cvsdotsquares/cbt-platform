"""add batch_id to study_materials for section-scoped uploads

Revision ID: f2a3b4c5d6e7
Revises: e1f2a3b4c5d6
Create Date: 2026-10-01 14:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op

revision: str = "f2a3b4c5d6e7"
down_revision: Union[str, None] = "e1f2a3b4c5d6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE study_materials
        ADD COLUMN IF NOT EXISTS batch_id TEXT NULL
        REFERENCES batches(id) ON DELETE SET NULL
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS study_materials_batch_id_idx
        ON study_materials (batch_id)
        WHERE batch_id IS NOT NULL
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS study_materials_batch_id_idx")
    op.execute("ALTER TABLE study_materials DROP COLUMN IF EXISTS batch_id")
