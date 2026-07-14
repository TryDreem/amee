"""add projects.thumbnail_url and projects.preview_video_url columns

Revision ID: a0aea5e4f727
Revises: 581ec879852b
Create Date: 2026-07-14 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "a0aea5e4f727"
down_revision: Union[str, Sequence[str], None] = "581ec879852b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("projects", sa.Column("thumbnail_url", sa.String(), nullable=True))
    op.add_column(
        "projects", sa.Column("preview_video_url", sa.String(), nullable=True)
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("projects", "preview_video_url")
    op.drop_column("projects", "thumbnail_url")
