"""add users.projects_uploaded_count

Backs the quota model's new persistence rule: the count survives project deletion (a live
`COUNT(*) WHERE owner_id` on `projects` was the old mechanism and is being replaced) and only
increments on a transcribe job that actually reaches `done` - not on a bare upload, and not on a
job that fails (duration cap, no speech detected, or any other error). `server_default="0"` so
every existing row starts at zero rather than requiring a backfill pass.

Revision ID: 6f6c2d5a00b5
Revises: a3f7c19e5b2d
Create Date: 2026-08-19 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "6f6c2d5a00b5"
down_revision: str | Sequence[str] | None = "a3f7c19e5b2d"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "users",
        sa.Column(
            "projects_uploaded_count",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("users", "projects_uploaded_count")
