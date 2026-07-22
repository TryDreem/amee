"""add export_srt value to job_type enum

Revision ID: a8c65bfa0cb9
Revises: f1284aa843af
Create Date: 2026-07-22 00:00:00.000000

Step 13 splits SRT generation out of POST /export into its own async
endpoint (POST /export-srt), backed by a new JobType value. Postgres
refuses ALTER TYPE ... ADD VALUE inside the same transaction that might
read/write the type being altered - Alembic wraps upgrade() in one
transaction by default, so autocommit_block() is the documented escape
hatch for this specific piece of DDL.
"""

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a8c65bfa0cb9"
down_revision: Union[str, Sequence[str], None] = "f1284aa843af"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE job_type ADD VALUE 'export_srt'")


def downgrade() -> None:
    """Downgrade schema."""
    # Postgres has no ALTER TYPE ... DROP VALUE - reversing this requires
    # rebuilding the enum type from scratch (rename, create, migrate
    # column, drop). Not worth building for a rollback path that's rarely
    # exercised; raising is the honest signal, not a silent no-op that
    # implies state was actually reverted.
    raise NotImplementedError(
        "job_type enum values cannot be dropped in Postgres without "
        "rebuilding the type; downgrade past this revision manually"
    )
