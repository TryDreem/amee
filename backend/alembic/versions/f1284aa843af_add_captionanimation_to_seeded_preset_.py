"""data fix: add captionAnimation to seeded preset's base JSONB

Revision ID: f1284aa843af
Revises: a5a17891551d
Create Date: 2026-07-19 21:58:54.205828

Same pattern as a5a17891551d/d131d5287927 - can't edit an already-applied
seed migration in place. `captionAnimation` (INVARIANTS S8) defaults to
`"none"` - no cosmetic entrance transition unless the user picks one.
`revealMode`'s existing seeded value ("progressive") needs no migration:
it's still valid under the expanded enum, just a Python-side addition.
"""

import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f1284aa843af"
down_revision: str | Sequence[str] | None = "a5a17891551d"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

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
    "showPunctuation": False,
    "revealMode": "progressive",
    "verticalPosition": 0.75,
    "safeArea": {"top": 0.1, "bottom": 0.15},
}

_NEW_BASE = {**_OLD_BASE, "captionAnimation": "none"}


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
