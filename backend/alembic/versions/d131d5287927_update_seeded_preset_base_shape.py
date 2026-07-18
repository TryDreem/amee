"""data fix: update seeded preset's base JSONB to the expanded shape

Revision ID: d131d5287927
Revises: 8ec97f9726e7
Create Date: 2026-07-17 00:00:00.000001

Step 1's seed migration (f4ac66039fe6) wrote the old singular `highlightColor`
shape. Can't edit that migration in place - already applied, breaks
reproducibility for anyone who ran it. This is a fresh data-only migration:
same preset row (same id), `base` JSONB replaced with the shape
PresetBase now expects (`highlightColors` array, `textTransform`, `italic`,
`glow`, `outline`, `shadow`) - `bounds` is unchanged, those three fields
have no per-preset bounds entry (arch §10).
"""

import uuid
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "d131d5287927"
down_revision: Union[str, Sequence[str], None] = "8ec97f9726e7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_DEFAULT_PRESET_ID = uuid.UUID("c1a1a1a1-0000-4000-8000-000000000001")

_presets = sa.table(
    "presets",
    sa.column("id", sa.UUID()),
    sa.column("base", postgresql.JSONB()),
)

_OLD_BASE = {
    "fontSize": 0.08,
    "fontFamily": "Inter",
    "fontWeight": 700,
    "color": "#ffffff",
    "highlightColor": "#ffe600",
    "revealMode": "progressive",
    "verticalPosition": 0.75,
    "safeArea": {"top": 0.1, "bottom": 0.15},
}

_NEW_BASE = {
    "fontSize": 0.08,
    "fontFamily": "Inter",
    "fontWeight": 700,
    "color": "#ffffff",
    "highlightColors": ["#ffe600"],
    "textTransform": "none",
    "italic": False,
    "glow": False,
    "outline": None,
    "shadow": None,
    "revealMode": "progressive",
    "verticalPosition": 0.75,
    "safeArea": {"top": 0.1, "bottom": 0.15},
}


def upgrade() -> None:
    """Upgrade schema."""
    op.execute(
        _presets.update()
        .where(_presets.c.id == _DEFAULT_PRESET_ID)
        .values(base=_NEW_BASE)
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.execute(
        _presets.update()
        .where(_presets.c.id == _DEFAULT_PRESET_ID)
        .values(base=_OLD_BASE)
    )
