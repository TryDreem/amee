"""add users table

Pure infrastructure - no route reads or writes this table yet. Every existing project still
carries `owner_id = PLACEHOLDER_OWNER_ID` (app/constants.py); this migration does not touch
`projects` and does not backfill a `users` row for that placeholder id, since nothing joins
against `users` yet either. That wiring (a real `get_current_user_id` dependency replacing the
placeholder) is a separate, later change - see the auth plan for the full sequencing.

Both `email` and `google_sub` are nullable: a guest row has neither. Google-only auth (confirmed
scope decision, docs/api-contract.md §15 proposed) means no `password_hash` column - there is
nothing to hash.

Revision ID: a3f7c19e5b2d
Revises: f3a52d8b16c7
Create Date: 2026-08-18 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a3f7c19e5b2d"
down_revision: str | Sequence[str] | None = "f3a52d8b16c7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "users",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("email", sa.String(), nullable=True),
        sa.Column("google_sub", sa.String(), nullable=True),
        sa.Column("name", sa.String(), nullable=True),
        sa.Column("avatar_url", sa.String(), nullable=True),
        sa.Column("is_guest", sa.Boolean(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email"),
        sa.UniqueConstraint("google_sub"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("users")
