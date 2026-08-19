"""add segments.overrides column

Revision ID: e5c1f39cb553
Revises: d131d5287927
Create Date: 2026-07-18 17:44:17.124000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e5c1f39cb553"
down_revision: str | Sequence[str] | None = "d131d5287927"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "segments",
        sa.Column("overrides", postgresql.JSONB(), nullable=True),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("segments", "overrides")
