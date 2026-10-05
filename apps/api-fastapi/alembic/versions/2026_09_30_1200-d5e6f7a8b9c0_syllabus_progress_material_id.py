"""add material_id to syllabus_progress for note completion ticks

Revision ID: d5e6f7a8b9c0
Revises: c4d5e6f7a8b9
Create Date: 2026-09-30 12:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op

revision: str = "d5e6f7a8b9c0"
down_revision: Union[str, None] = "c4d5e6f7a8b9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE syllabus_progress
        ADD COLUMN IF NOT EXISTS material_id TEXT NULL
        REFERENCES study_materials(id) ON DELETE CASCADE
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS syllabus_progress_batch_id_material_id_key
        ON syllabus_progress (batch_id, material_id)
        WHERE material_id IS NOT NULL
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS syllabus_progress_batch_id_material_id_key")
    op.execute("ALTER TABLE syllabus_progress DROP COLUMN IF EXISTS material_id")
