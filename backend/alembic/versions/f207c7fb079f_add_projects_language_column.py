"""add projects.language column

Revision ID: f207c7fb079f
Revises: e5c1f39cb553
Create Date: 2026-07-18 23:33:17.325529

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "f207c7fb079f"
down_revision: Union[str, Sequence[str], None] = "e5c1f39cb553"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("projects", sa.Column("language", sa.String(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("projects", "language")
