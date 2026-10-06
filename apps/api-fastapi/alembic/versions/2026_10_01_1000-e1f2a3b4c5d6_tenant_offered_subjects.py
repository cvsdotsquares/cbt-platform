"""tenant offered subjects per class

Revision ID: e1f2a3b4c5d6
Revises: d5e6f7a8b9c0
Create Date: 2026-10-01 10:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op

revision: str = "e1f2a3b4c5d6"
down_revision: Union[str, None] = "d5e6f7a8b9c0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS tenant_offered_subjects (
            id TEXT PRIMARY KEY,
            tenant_id TEXT NOT NULL,
            academic_class_id TEXT NOT NULL REFERENCES academic_classes(id) ON DELETE CASCADE,
            subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS tenant_offered_subjects_tenant_class_subject_key
        ON tenant_offered_subjects (tenant_id, academic_class_id, subject_id)
        """
    )
    op.execute(
        """
        CREATE INDEX IF NOT EXISTS tenant_offered_subjects_tenant_class_idx
        ON tenant_offered_subjects (tenant_id, academic_class_id)
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS tenant_offered_subjects_tenant_class_idx")
    op.execute("DROP INDEX IF EXISTS tenant_offered_subjects_tenant_class_subject_key")
    op.execute("DROP TABLE IF EXISTS tenant_offered_subjects")
