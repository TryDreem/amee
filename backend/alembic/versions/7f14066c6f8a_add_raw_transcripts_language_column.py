"""add raw_transcripts.language column

Revision ID: 7f14066c6f8a
Revises: a8c65bfa0cb9
Create Date: 2026-07-28 00:00:00.000000

Surfaces the language WhisperX actually detected/used for alignment,
distinct from Project.language (the user's upload-time choice, set once,
never mutated - arch §2.9). Needed so the LLM smart re-splitter (Step 14)
can gate on the real detected language even when the user picked "auto"
and Project.language stays null forever. Nullable: rows written before
this column existed have no known value, treated the same as "language
unsupported for smart-split" rather than backfilled with a guess.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "7f14066c6f8a"
down_revision: str | Sequence[str] | None = "a8c65bfa0cb9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("raw_transcripts", sa.Column("language", sa.String(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("raw_transcripts", "language")
