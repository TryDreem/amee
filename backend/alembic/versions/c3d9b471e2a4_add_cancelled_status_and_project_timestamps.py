"""add cancelled to job_status, add projects.updated_at/last_opened_at

Revision ID: c3d9b471e2a4
Revises: 7f14066c6f8a
Create Date: 2026-08-08 23:30:00.000000

Foundation for the project-management pass (contract §4/§5): a real
`cancelled` job status distinct from `failed` (export cancellation), plus
the two timestamps `GET /projects?sort=updated|opened` orders by.

`updated_at` backfills to `created_at` rather than `now()` — a project
nobody has edited since upload should sort as "last updated at upload
time", not "all existing projects updated the moment this migration ran",
which would flatten the ordering this column exists to provide.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c3d9b471e2a4"
down_revision: str | Sequence[str] | None = "7f14066c6f8a"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    # Postgres refuses ALTER TYPE ... ADD VALUE inside the same transaction
    # that might read/write the type being altered; autocommit_block() is
    # the documented escape hatch (same pattern as a8c65bfa0cb9).
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE job_status ADD VALUE 'cancelled'")

    op.add_column(
        "projects",
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "projects",
        sa.Column("last_opened_at", sa.DateTime(timezone=True), nullable=True),
    )
    # Added nullable so existing rows can be backfilled, then tightened to
    # match the model (nullable=False) — the standard three-step add-column
    # dance. `last_opened_at` stays nullable by design (D13: null means
    # "never opened", not "unknown").
    op.execute("UPDATE projects SET updated_at = created_at")
    op.alter_column(
        "projects",
        "updated_at",
        nullable=False,
        server_default=sa.text("now()"),
    )


def downgrade() -> None:
    """Downgrade schema."""
    # Postgres has no ALTER TYPE ... DROP VALUE — reversing the enum half of
    # this migration requires rebuilding the type from scratch. Raising is
    # the honest signal (same call as a8c65bfa0cb9); dropping only the two
    # columns while silently leaving the enum value behind would report a
    # rollback that only partly happened.
    raise NotImplementedError(
        "job_status enum values cannot be dropped in Postgres without "
        "rebuilding the type; downgrade past this revision manually"
    )
