"""add failed_attempts and locked_until to users; add tenant+email unique constraint

Revision ID: d1e2f3a4b5c6
Revises: b2c3d4e5f6a7
Create Date: 2026-08-12 10:00:00.000000+00:00

"""
from typing import Sequence, Union
import sqlalchemy as sa
from alembic import op

revision: str = "d1e2f3a4b5c6"
down_revision: Union[str, None] = "b2c3d4e5f6a7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add lockout columns to users
    op.add_column("users", sa.Column("failed_attempts", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("users", sa.Column("locked_until", sa.DateTime(timezone=True), nullable=True))

    # Drop the old global unique constraint on email (if it exists) and replace
    # with a per-tenant unique constraint so the same email can exist in different tenants.
    # We use a try/except pattern via execute to handle the case where
    # the old constraint may or may not exist by its specific name.
    op.execute("""
        DO $$
        BEGIN
            -- Drop old single-column unique index on email if present
            IF EXISTS (
                SELECT 1 FROM pg_indexes
                WHERE tablename = 'users' AND indexname = 'users_email_key'
            ) THEN
                ALTER TABLE users DROP CONSTRAINT users_email_key;
            END IF;
        END;
        $$;
    """)

    # Add composite unique constraint (tenant_id, email)
    # Only add if it doesn't already exist
    op.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'uq_user_tenant_email' AND conrelid = 'users'::regclass
            ) THEN
                ALTER TABLE users ADD CONSTRAINT uq_user_tenant_email UNIQUE (tenant_id, email);
            END IF;
        END;
        $$;
    """)


def downgrade() -> None:
    op.execute("""
        DO $$
        BEGIN
            IF EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'uq_user_tenant_email' AND conrelid = 'users'::regclass
            ) THEN
                ALTER TABLE users DROP CONSTRAINT uq_user_tenant_email;
            END IF;
        END;
        $$;
    """)
    op.drop_column("users", "locked_until")
    op.drop_column("users", "failed_attempts")
