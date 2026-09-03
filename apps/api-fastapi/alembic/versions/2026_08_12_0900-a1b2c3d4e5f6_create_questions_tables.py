"""create questions, question_versions, question_tags tables

Revision ID: a1b2c3d4e5f6
Revises: 5c7f9a1d0f2b
Create Date: 2026-08-12 09:00:00.000000+00:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = "c3d4e5f6a7b8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── topics (minimal stub – needed as FK target for questions) ────────────
    op.create_table(
        "topics",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("tenant_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("parent_id", sa.UUID(), nullable=True),
        sa.Column("description", sa.String(length=1000), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["parent_id"], ["topics.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "name", "parent_id", name="uq_topic_tenant_name_parent"),
    )

    # ── questions ────────────────────────────────────────────────────────────
    op.create_table(
        "questions",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("tenant_id", sa.UUID(), nullable=False),
        sa.Column("type", sa.String(length=50), nullable=False),
        sa.Column("difficulty", sa.String(length=50), nullable=False, server_default="MEDIUM"),
        sa.Column("topic_id", sa.UUID(), nullable=True),
        sa.Column("syllabus_topic_id", sa.UUID(), nullable=True),
        sa.Column("title", sa.String(length=500), nullable=True),
        sa.Column("description", sa.String(length=2000), nullable=True),
        sa.Column("status", sa.String(length=50), nullable=False, server_default="DRAFT"),
        sa.Column("current_version_id", sa.UUID(), nullable=True),
        sa.Column("created_by_id", sa.UUID(), nullable=True),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["topic_id"], ["topics.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_questions_tenant_type_status", "questions", ["tenant_id", "type", "status"])
    op.create_index("ix_questions_tenant_difficulty", "questions", ["tenant_id", "difficulty"])

    # ── question_versions ────────────────────────────────────────────────────
    op.create_table(
        "question_versions",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("question_id", sa.UUID(), nullable=False),
        sa.Column("version_number", sa.Integer(), nullable=False),
        sa.Column("content", sa.JSON(), nullable=False),
        sa.Column("options", sa.JSON(), nullable=True),
        sa.Column("correct_answer", sa.JSON(), nullable=True),
        sa.Column("media_refs", sa.JSON(), nullable=True),
        sa.Column("test_cases", sa.JSON(), nullable=True),
        sa.Column("marks", sa.Float(), nullable=False, server_default="1"),
        sa.Column("negative_marks", sa.Float(), nullable=False, server_default="0"),
        sa.Column("explanation", sa.String(length=2000), nullable=True),
        sa.Column("approved_by_id", sa.UUID(), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["question_id"], ["questions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["approved_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("question_id", "version_number", name="uq_question_version"),
    )

    # ── question_tags ────────────────────────────────────────────────────────
    op.create_table(
        "question_tags",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("question_id", sa.UUID(), nullable=False),
        sa.Column("tag", sa.String(length=128), nullable=False),
        sa.ForeignKeyConstraint(["question_id"], ["questions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("question_id", "tag", name="uq_question_tag"),
    )
    op.create_index("ix_question_tags_tag", "question_tags", ["tag"])


def downgrade() -> None:
    op.drop_index("ix_question_tags_tag", table_name="question_tags")
    op.drop_table("question_tags")
    op.drop_table("question_versions")
    op.drop_index("ix_questions_tenant_difficulty", table_name="questions")
    op.drop_index("ix_questions_tenant_type_status", table_name="questions")
    op.drop_table("questions")
    op.drop_table("topics")
