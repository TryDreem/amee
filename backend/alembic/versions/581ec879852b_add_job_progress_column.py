"""add jobs.progress column

Revision ID: 581ec879852b
Revises: a1c3e7f92b4d
Create Date: 2026-07-14 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "581ec879852b"
down_revision: str | Sequence[str] | None = "a1c3e7f92b4d"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_job_progress = sa.Enum(
    "preparing", "transcribing", "generating_preview", name="job_progress"
)


def upgrade() -> None:
    """Upgrade schema."""
    _job_progress.create(op.get_bind(), checkfirst=True)
    op.add_column("jobs", sa.Column("progress", _job_progress, nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("jobs", "progress")
    _job_progress.drop(op.get_bind(), checkfirst=True)
