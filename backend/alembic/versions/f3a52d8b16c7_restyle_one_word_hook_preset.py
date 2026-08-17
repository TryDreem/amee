"""restyle the One Word Hook preset

Rebuilt from a look the human assembled in the editor and asked to become the preset: Archivo
Black at Black weight, 4.6% of video height, large black outline plus a small black shadow. Reveal
mode, entrance, colour and position are already what that look uses and are left alone.

Two things worth knowing about this preset from here on:

- Archivo Black is Latin-only (`lang: "lat"` in frontend/src/lib/fonts.ts). Every other seeded
  preset deliberately uses a Cyrillic-capable family, because a preset that renders Russian
  captions as fallback glyphs is worse than no preset. This one is now the exception, chosen
  explicitly rather than by oversight.
- The family ships a single weight (400), so `fontWeight: 900` is synthesised by the browser
  rather than loaded. That is not a parity problem: preview and export are the same component in
  the same engine (P9), so both fake the same bold.

Revision ID: f3a52d8b16c7
Revises: e91b3d7c04a6
"""

import json
import uuid
from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa
from alembic import op

revision: str = "f3a52d8b16c7"
down_revision: str | Sequence[str] | None = "e91b3d7c04a6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_ONE_WORD_HOOK_ID = uuid.UUID("c1a1a1a1-0000-4000-8000-000000000003")

_NEW: dict[str, Any] = {
    "fontFamily": "Archivo Black",
    "fontWeight": 900,
    "fontSize": 0.046,
    "outline": {"size": "large", "color": "#000000", "alpha": 100},
    "shadow": {"size": "small", "color": "#000000", "alpha": 100},
}

# What the seed (b7f2c419ad30) plus the font-size migration (d4e81c72af95) left here.
_OLD: dict[str, Any] = {
    "fontFamily": "Unbounded",
    "fontWeight": 800,
    "fontSize": 0.04,
    "outline": {"size": "medium", "color": "#000000", "alpha": 100},
    "shadow": None,
}


def _patch_base(patch: dict[str, Any]) -> None:
    """Merges into `base` rather than replacing it — every other field of PresetBase has to survive
    untouched, and a preset row is only ever valid when it is complete."""
    op.execute(
        sa.text("UPDATE presets SET base = base || CAST(:patch AS jsonb) WHERE id = :preset_id")
        .bindparams(patch=json.dumps(patch), preset_id=_ONE_WORD_HOOK_ID)
    )


def upgrade() -> None:
    """Upgrade schema."""
    _patch_base(_NEW)


def downgrade() -> None:
    """Downgrade schema."""
    _patch_base(_OLD)
