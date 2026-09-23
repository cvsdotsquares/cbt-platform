"""create registration_invites table for student signup links

Revision ID: c4d5e6f7a8b9
Revises: a1b2c3d4e5f7
Create Date: 2026-09-14 12:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op

revision: str = "c4d5e6f7a8b9"
down_revision: Union[str, None] = "a1b2c3d4e5f7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS registration_invites (
            id TEXT NOT NULL,
            tenant_id TEXT NOT NULL,
            email TEXT NOT NULL,
            token_hash TEXT NOT NULL,
            first_name TEXT,
            last_name TEXT,
            batch_id TEXT,
            registration_number TEXT,
            expires_at TIMESTAMP(3) NOT NULL,
            used_at TIMESTAMP(3),
            created_by_id TEXT,
            created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT registration_invites_pkey PRIMARY KEY (id)
        );
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS registration_invites_tenant_id_email_idx
            ON registration_invites (tenant_id, email);
    """)
    op.execute("""
        CREATE INDEX IF NOT EXISTS registration_invites_token_hash_idx
            ON registration_invites (token_hash);
    """)
    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'registration_invites_tenant_id_fkey'
            ) THEN
                ALTER TABLE registration_invites
                    ADD CONSTRAINT registration_invites_tenant_id_fkey
                    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
                    ON DELETE CASCADE ON UPDATE CASCADE;
            END IF;
        END;
        $$;
    """)
    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'registration_invites_batch_id_fkey'
            ) THEN
                ALTER TABLE registration_invites
                    ADD CONSTRAINT registration_invites_batch_id_fkey
                    FOREIGN KEY (batch_id) REFERENCES batches(id)
                    ON DELETE SET NULL ON UPDATE CASCADE;
            END IF;
        END;
        $$;
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS registration_invites CASCADE;")
