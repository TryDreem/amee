"""data fix: add showPunctuation to seeded preset's base JSONB

Revision ID: a5a17891551d
Revises: f207c7fb079f
Create Date: 2026-07-19 12:27:10.912172

Same pattern as d131d5287927 - can't edit the original seed migration
(f4ac66039fe6) in place, already applied. `showPunctuation` (INVARIANTS S7)
defaults to `false` - punctuation hidden unless the user turns it on, per
product decision.
"""

import uuid
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "a5a17891551d"
down_revision: Union[str, Sequence[str], None] = "f207c7fb079f"
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

_NEW_BASE = {**_OLD_BASE, "showPunctuation": False}


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
