"""add caption_style_specs.per_phrase_style column

Revision ID: 8ec97f9726e7
Revises: 7089d2dafb24
Create Date: 2026-07-17 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "8ec97f9726e7"
down_revision: str | Sequence[str] | None = "7089d2dafb24"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "caption_style_specs",
        sa.Column(
            "per_phrase_style",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("caption_style_specs", "per_phrase_style")
