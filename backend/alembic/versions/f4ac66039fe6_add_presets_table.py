"""add presets table, seed default preset

Revision ID: f4ac66039fe6
Revises: c86103ed75d6
Create Date: 2026-07-15 00:00:00.000000

Seed values match frontend/src/mocks/fixtures.ts's presetsFixture exactly,
same PRESET_ID, so mocked and real backends agree.
"""

import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f4ac66039fe6"
down_revision: str | Sequence[str] | None = "c86103ed75d6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_DEFAULT_PRESET_ID = uuid.UUID("c1a1a1a1-0000-4000-8000-000000000001")

_presets = sa.table(
    "presets",
    sa.column("id", sa.UUID()),
    sa.column("name", sa.String()),
    sa.column("default", sa.Boolean()),
    sa.column("base", postgresql.JSONB()),
    sa.column("bounds", postgresql.JSONB()),
)


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "presets",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("default", sa.Boolean(), nullable=False),
        sa.Column("base", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("bounds", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.bulk_insert(
        _presets,
        [
            {
                "id": _DEFAULT_PRESET_ID,
                "name": "Bold Statement",
                "default": True,
                "base": {
                    "fontSize": 0.08,
                    "fontFamily": "Inter",
                    "fontWeight": 700,
                    "color": "#ffffff",
                    "highlightColor": "#ffe600",
                    "revealMode": "progressive",
                    "verticalPosition": 0.75,
                    "safeArea": {"top": 0.1, "bottom": 0.15},
                },
                "bounds": {
                    "fontSize": {"min": 0.04, "max": 0.12},
                    "verticalPosition": {"min": 0.1, "max": 0.85},
                    "safeArea": {
                        "top": {"min": 0.05, "max": 0.2},
                        "bottom": {"min": 0.05, "max": 0.25},
                    },
                },
            }
        ],
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("presets")
