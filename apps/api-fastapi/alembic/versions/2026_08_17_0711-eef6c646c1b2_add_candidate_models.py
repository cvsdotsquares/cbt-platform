"""add candidate models

Revision ID: eef6c646c1b2
Revises: 32697a29e281
Create Date: 2026-08-17 07:11:40.810523+00:00

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# ---------------------------------------------------------------------------
# Revision identifiers
# ---------------------------------------------------------------------------

revision: str = "eef6c646c1b2"
down_revision: Union[str, None] = "32697a29e281"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# ---------------------------------------------------------------------------
# Upgrade
# ---------------------------------------------------------------------------

def upgrade() -> None:

    # =======================================================================
    # CANDIDATE DOCUMENTS
    # =======================================================================

    op.create_table(
        "candidate_documents",

        sa.Column(
            "candidate_id",
            sa.UUID(),
            nullable=False,
        ),

        sa.Column(
            "type",
            sa.String(length=100),
            nullable=False,
        ),

        sa.Column(
            "file_name",
            sa.String(length=255),
            nullable=False,
        ),

        sa.Column(
            "file_url",
            sa.String(length=1000),
            nullable=False,
        ),

        sa.Column(
            "file_size",
            sa.Integer(),
            nullable=False,
        ),

        sa.Column(
            "mime_type",
            sa.String(length=255),
            nullable=False,
        ),

        sa.Column(
            "verified",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),

        sa.Column(
            "uploaded_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),

        sa.Column(
            "id",
            sa.UUID(),
            nullable=False,
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
            ["candidate_id"],
            ["candidates.id"],
            ondelete="CASCADE",
        ),

        sa.PrimaryKeyConstraint("id"),
    )

    op.create_index(
        "ix_candidate_documents_candidate_type",
        "candidate_documents",
        ["candidate_id", "type"],
        unique=False,
    )


    # =======================================================================
    # CANDIDATES
    # =======================================================================

    op.add_column(
        "candidates",
        sa.Column(
            "aadhaar_hash",
            sa.String(length=255),
            nullable=True,
        ),
    )

    op.add_column(
        "candidates",
        sa.Column(
            "kyc_status",
            sa.String(length=50),
            nullable=False,
            server_default="PENDING",
        ),
    )

    op.add_column(
        "candidates",
        sa.Column(
            "kyc_verified_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )

    op.add_column(
        "candidates",
        sa.Column(
            "photo_url",
            sa.String(length=500),
            nullable=True,
        ),
    )

    op.add_column(
        "candidates",
        sa.Column(
            "face_embedding",
            sa.String(length=5000),
            nullable=True,
        ),
    )


    # -----------------------------------------------------------------------
    # Convert profile_data JSON -> JSONB
    # -----------------------------------------------------------------------

    op.alter_column(
        "candidates",
        "profile_data",
        existing_type=postgresql.JSON(astext_type=sa.Text()),
        type_=postgresql.JSONB(astext_type=sa.Text()),
        existing_nullable=True,
    )


    # -----------------------------------------------------------------------
    # Candidate indexes / constraints
    # -----------------------------------------------------------------------

    op.drop_index(
        op.f("ix_candidates_tenant_id"),
        table_name="candidates",
    )

    op.drop_constraint(
        op.f("uq_candidate_tenant_user"),
        "candidates",
        type_="unique",
    )

    op.create_index(
        "ix_candidates_tenant_kyc_status",
        "candidates",
        ["tenant_id", "kyc_status"],
        unique=False,
    )

    op.create_unique_constraint(
        "uq_candidate_tenant_registration",
        "candidates",
        ["tenant_id", "registration_number"],
    )

    op.create_unique_constraint(
        "uq_candidates_user_id",
        "candidates",
        ["user_id"],
    )


    # -----------------------------------------------------------------------
    # Recreate candidate foreign keys
    # -----------------------------------------------------------------------

    op.drop_constraint(
        op.f("candidates_tenant_id_fkey"),
        "candidates",
        type_="foreignkey",
    )

    op.drop_constraint(
        op.f("candidates_user_id_fkey"),
        "candidates",
        type_="foreignkey",
    )

    op.create_foreign_key(
        "candidates_tenant_id_fkey",
        "candidates",
        "tenants",
        ["tenant_id"],
        ["id"],
    )

    op.create_foreign_key(
        "candidates_user_id_fkey",
        "candidates",
        "users",
        ["user_id"],
        ["id"],
    )


    # =======================================================================
    # ROLES
    # =======================================================================

    # op.create_unique_constraint(
    #     "uq_role_tenant_name",
    #     "roles",
    #     ["tenant_id", "name"],
    # )


    # =======================================================================
    # SESSIONS
    # =======================================================================

    op.drop_index(
        op.f("ix_sessions_refresh_hash"),
        table_name="sessions",
    )

    op.drop_index(
        op.f("ix_sessions_user_expires"),
        table_name="sessions",
    )

    op.create_index(
        "ix_sessions_refresh_token_hash",
        "sessions",
        ["refresh_token_hash"],
        unique=False,
    )


    # =======================================================================
    # USERS
    # =======================================================================

    # -----------------------------------------------------------------------
    # phone
    # -----------------------------------------------------------------------

    op.add_column(
        "users",
        sa.Column(
            "phone",
            sa.String(length=50),
            nullable=True,
        ),
    )


    # -----------------------------------------------------------------------
    # avatar_url
    # -----------------------------------------------------------------------

    op.add_column(
        "users",
        sa.Column(
            "avatar_url",
            sa.String(length=500),
            nullable=True,
        ),
    )


    # -----------------------------------------------------------------------
    # status
    #
    # IMPORTANT:
    # Existing users already exist, therefore we MUST provide a server
    # default when adding a NOT NULL column.
    # -----------------------------------------------------------------------

    op.add_column(
        "users",
        sa.Column(
            "status",
            sa.String(length=50),
            nullable=False,
            server_default="PENDING_VERIFICATION",
        ),
    )

    # Remove the database default after existing rows have been populated.
    # The SQLAlchemy model still provides the application-level default.
    op.alter_column(
        "users",
        "status",
        server_default=None,
    )


    # -----------------------------------------------------------------------
    # MFA enabled
    # -----------------------------------------------------------------------

    op.add_column(
        "users",
        sa.Column(
            "mfa_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )

    op.alter_column(
        "users",
        "mfa_enabled",
        server_default=None,
    )


    # -----------------------------------------------------------------------
    # MFA secret
    # -----------------------------------------------------------------------

    op.add_column(
        "users",
        sa.Column(
            "mfa_secret",
            sa.String(length=255),
            nullable=True,
        ),
    )


    # -----------------------------------------------------------------------
    # Email verified
    # -----------------------------------------------------------------------

    op.add_column(
        "users",
        sa.Column(
            "email_verified",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )

    op.alter_column(
        "users",
        "email_verified",
        server_default=None,
    )


    # -----------------------------------------------------------------------
    # Phone verified
    # -----------------------------------------------------------------------

    op.add_column(
        "users",
        sa.Column(
            "phone_verified",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )

    op.alter_column(
        "users",
        "phone_verified",
        server_default=None,
    )


    # -----------------------------------------------------------------------
    # Last login
    # -----------------------------------------------------------------------

    op.add_column(
        "users",
        sa.Column(
            "last_login_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
    )


    # -----------------------------------------------------------------------
    # Failed attempts
    #
    # NOTE:
    # This column already exists in your User model.
    # If it does NOT already exist in the database, add it here.
    # -----------------------------------------------------------------------

    # We are intentionally NOT adding failed_attempts here because
    # the autogenerate output did not detect it as a new column.


    # -----------------------------------------------------------------------
    # locked_until
    #
    # Same reasoning as failed_attempts.
    # -----------------------------------------------------------------------

    # Not added because Alembic did not detect it as a new column.


    # =======================================================================
    # USER COLUMN CHANGES
    # =======================================================================

    # -----------------------------------------------------------------------
    # first_name
    #
    # Existing data may contain NULL values.
    # Populate them before applying NOT NULL.
    # -----------------------------------------------------------------------

    op.execute(
        """
        UPDATE users
        SET first_name = ''
        WHERE first_name IS NULL
        """
    )

    op.alter_column(
        "users",
        "first_name",
        existing_type=sa.VARCHAR(length=255),
        type_=sa.String(length=100),
        nullable=False,
    )


    # -----------------------------------------------------------------------
    # last_name
    # -----------------------------------------------------------------------

    op.execute(
        """
        UPDATE users
        SET last_name = ''
        WHERE last_name IS NULL
        """
    )

    op.alter_column(
        "users",
        "last_name",
        existing_type=sa.VARCHAR(length=255),
        type_=sa.String(length=100),
        nullable=False,
    )


    # -----------------------------------------------------------------------
    # email
    #
    # IMPORTANT:
    # We are NOT automatically reducing VARCHAR(320) -> VARCHAR(255)
    # because existing production data could contain values longer than
    # 255 characters.
    #
    # The model can later be aligned after checking the actual data.
    # -----------------------------------------------------------------------


    # =======================================================================
    # USER UNIQUE CONSTRAINT
    # =======================================================================

    op.drop_constraint(
        op.f("uq_user_tenant_email"),
        "users",
        type_="unique",
    )


    # =======================================================================
    # USER TENANT FOREIGN KEY
    # =======================================================================

    op.drop_constraint(
        op.f("users_tenant_id_fkey"),
        "users",
        type_="foreignkey",
    )

    op.create_foreign_key(
        "users_tenant_id_fkey",
        "users",
        "tenants",
        ["tenant_id"],
        ["id"],
    )


    # =======================================================================
    # OLD USER IS_ACTIVE
    # =======================================================================

    op.drop_column(
        "users",
        "is_active",
    )


    # =======================================================================
    # IMPORTANT
    # =======================================================================
    #
    # DO NOT DROP user_roles here.
    #
    # Your current User model still contains:
    #
    #     user_roles: Mapped[list["UserRole"]]
    #
    # Therefore the user_roles table is still required.
    #
    # The original Alembic generated:
    #
    #     op.drop_table("user_roles")
    #
    # That would delete the existing role assignments.
    #
    # We intentionally removed that operation.
    # =======================================================================


    # =======================================================================
    # OLD INDEXES
    # =======================================================================

    # These indexes were detected by Alembic as removed because the current
    # SQLAlchemy models apparently no longer declare them.

    op.drop_index(
        op.f("ix_exam_questions_exam_id"),
        table_name="exam_questions",
    )

    op.drop_index(
        op.f("ix_exam_registrations_exam_status"),
        table_name="exam_registrations",
    )

    op.drop_index(
        op.f("ix_exam_results_candidate"),
        table_name="exam_results",
    )

    op.drop_index(
        op.f("ix_exam_results_exam_rank"),
        table_name="exam_results",
    )

    op.drop_index(
        op.f("ix_exam_sessions_candidate_exam"),
        table_name="exam_sessions",
    )

    op.drop_index(
        op.f("ix_exam_sessions_exam_status"),
        table_name="exam_sessions",
    )

    op.drop_index(
        op.f("ix_exams_start_end"),
        table_name="exams",
    )

    op.drop_index(
        op.f("ix_exams_tenant_status"),
        table_name="exams",
    )

    op.drop_index(
        op.f("ix_login_history_user_id"),
        table_name="login_history",
    )

    op.drop_index(
        op.f("ix_question_tags_tag"),
        table_name="question_tags",
    )

    op.drop_index(
        op.f("ix_questions_tenant_difficulty"),
        table_name="questions",
    )

    op.drop_index(
        op.f("ix_questions_tenant_type_status"),
        table_name="questions",
    )


# ---------------------------------------------------------------------------
# Downgrade
# ---------------------------------------------------------------------------

def downgrade() -> None:

    # =======================================================================
    # USERS
    # =======================================================================

    op.add_column(
        "users",
        sa.Column(
            "is_active",
            sa.BOOLEAN(),
            autoincrement=False,
            nullable=False,
            server_default=sa.true(),
        ),
    )

    op.alter_column(
        "users",
        "is_active",
        server_default=None,
    )

    op.drop_constraint(
        "users_tenant_id_fkey",
        "users",
        type_="foreignkey",
    )

    op.create_foreign_key(
        "users_tenant_id_fkey",
        "users",
        "tenants",
        ["tenant_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.create_unique_constraint(
        "uq_user_tenant_email",
        "users",
        ["tenant_id", "email"],
    )

    op.alter_column(
        "users",
        "last_name",
        existing_type=sa.String(length=100),
        type_=sa.VARCHAR(length=255),
        nullable=True,
    )

    op.alter_column(
        "users",
        "first_name",
        existing_type=sa.String(length=100),
        type_=sa.VARCHAR(length=255),
        nullable=True,
    )

    op.drop_column(
        "users",
        "last_login_at",
    )

    op.drop_column(
        "users",
        "phone_verified",
    )

    op.drop_column(
        "users",
        "email_verified",
    )

    op.drop_column(
        "users",
        "mfa_secret",
    )

    op.drop_column(
        "users",
        "mfa_enabled",
    )

    op.drop_column(
        "users",
        "status",
    )

    op.drop_column(
        "users",
        "avatar_url",
    )

    op.drop_column(
        "users",
        "phone",
    )


    # =======================================================================
    # SESSIONS
    # =======================================================================

    op.drop_index(
        "ix_sessions_refresh_token_hash",
        table_name="sessions",
    )

    op.create_index(
        "ix_sessions_user_expires",
        "sessions",
        ["user_id", "expires_at"],
        unique=False,
    )

    op.create_index(
        "ix_sessions_refresh_hash",
        "sessions",
        ["refresh_token_hash"],
        unique=False,
    )


    # =======================================================================
    # ROLES
    # =======================================================================

    # op.drop_constraint(
    #     "uq_role_tenant_name",
    #     "roles",
    #     type_="unique",
    # )


    # =======================================================================
    # OLD INDEXES
    # =======================================================================

    op.create_index(
        "ix_questions_tenant_type_status",
        "questions",
        ["tenant_id", "type", "status"],
        unique=False,
    )

    op.create_index(
        "ix_questions_tenant_difficulty",
        "questions",
        ["tenant_id", "difficulty"],
        unique=False,
    )

    op.create_index(
        "ix_question_tags_tag",
        "question_tags",
        ["tag"],
        unique=False,
    )

    op.create_index(
        "ix_login_history_user_id",
        "login_history",
        ["user_id"],
        unique=False,
    )

    op.create_index(
        "ix_exams_tenant_status",
        "exams",
        ["tenant_id", "status"],
        unique=False,
    )

    op.create_index(
        "ix_exams_start_end",
        "exams",
        ["start_time", "end_time"],
        unique=False,
    )

    op.create_index(
        "ix_exam_sessions_exam_status",
        "exam_sessions",
        ["exam_id", "status"],
        unique=False,
    )

    op.create_index(
        "ix_exam_sessions_candidate_exam",
        "exam_sessions",
        ["candidate_id", "exam_id"],
        unique=False,
    )

    op.create_index(
        "ix_exam_results_exam_rank",
        "exam_results",
        ["exam_id", "rank"],
        unique=False,
    )

    op.create_index(
        "ix_exam_results_candidate",
        "exam_results",
        ["candidate_id"],
        unique=False,
    )

    op.create_index(
        "ix_exam_registrations_exam_status",
        "exam_registrations",
        ["exam_id", "status"],
        unique=False,
    )

    op.create_index(
        "ix_exam_questions_exam_id",
        "exam_questions",
        ["exam_id"],
        unique=False,
    )


    # =======================================================================
    # CANDIDATES
    # =======================================================================

    op.drop_constraint(
        "candidates_user_id_fkey",
        "candidates",
        type_="foreignkey",
    )

    op.drop_constraint(
        "candidates_tenant_id_fkey",
        "candidates",
        type_="foreignkey",
    )

    op.create_foreign_key(
        "candidates_user_id_fkey",
        "candidates",
        "users",
        ["user_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.create_foreign_key(
        "candidates_tenant_id_fkey",
        "candidates",
        "tenants",
        ["tenant_id"],
        ["id"],
        ondelete="CASCADE",
    )

    op.drop_constraint(
        "uq_candidates_user_id",
        "candidates",
        type_="unique",
    )

    op.drop_constraint(
        "uq_candidate_tenant_registration",
        "candidates",
        type_="unique",
    )

    op.drop_index(
        "ix_candidates_tenant_kyc_status",
        table_name="candidates",
    )

    op.create_unique_constraint(
        "uq_candidate_tenant_user",
        "candidates",
        ["tenant_id", "user_id"],
    )

    op.create_index(
        "ix_candidates_tenant_id",
        "candidates",
        ["tenant_id"],
        unique=False,
    )

    op.alter_column(
        "candidates",
        "profile_data",
        existing_type=postgresql.JSONB(astext_type=sa.Text()),
        type_=postgresql.JSON(astext_type=sa.Text()),
        existing_nullable=True,
    )

    op.drop_column(
        "candidates",
        "face_embedding",
    )

    op.drop_column(
        "candidates",
        "photo_url",
    )

    op.drop_column(
        "candidates",
        "kyc_verified_at",
    )

    op.drop_column(
        "candidates",
        "kyc_status",
    )

    op.drop_column(
        "candidates",
        "aadhaar_hash",
    )


    # =======================================================================
    # CANDIDATE DOCUMENTS
    # =======================================================================

    op.drop_index(
        "ix_candidate_documents_candidate_type",
        table_name="candidate_documents",
    )

    op.drop_table(
        "candidate_documents",
    )