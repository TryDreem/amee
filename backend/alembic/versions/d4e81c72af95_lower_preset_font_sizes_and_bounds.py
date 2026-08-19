"""lower preset font sizes and bounds

Every preset's default `fontSize` drops to at most 4% of video height, and the per-preset
`bounds.fontSize` ceiling drops from 0.12-0.14 to 0.06.

Why: the old ceiling was not a usable range. At 12-14% of a 1080x1920 frame a caption is ~230-270px
tall per line, so a two-line phrase at the segment length limit does not fit the safe area at all —
the slider's top half was dead travel that could only produce overflow. 6% is roughly where a
two-line, ~28-character caption still fits the 85% width budget, so the whole range is now usable.

**This also rewrites stored documents, which a preset-only change could not do safely.**
`fontSize` is validated against the resolved preset's bounds on `PUT /style` and `PUT /ecs`
(INVARIANTS L8/V8), so lowering the ceiling alone would make every already-saved document with a
larger value fail to save — the user would hit a 422 on a project they never touched, caused
entirely by this migration. Any stored `fontSize` above the new ceiling is therefore clamped to it,
in both `caption_style_specs.overrides` and `segments.overrides`.

Revision ID: d4e81c72af95
Revises: b7f2c419ad30
"""

import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "d4e81c72af95"
down_revision: str | Sequence[str] | None = "b7f2c419ad30"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_presets = sa.table(
    "presets",
    sa.column("id", sa.UUID()),
    sa.column("base", postgresql.JSONB()),
    sa.column("bounds", postgresql.JSONB()),
)

_NEW_MAX = 0.06
_NEW_MIN = 0.02
_OLD_MAX = 0.14
_OLD_MIN = 0.03

# Per preset: (id, new default fontSize, previous default fontSize). All new values sit at or below
# 0.04; the ones that differ from each other do so because the look calls for it (a minimal caption
# reads smaller than a heavy caps one), not arbitrarily.
_FONT_SIZES = [
    (
        uuid.UUID("c1a1a1a1-0000-4000-8000-000000000001"),
        0.04,
        0.08,
    ),  # Bold Statement (default)
    (uuid.UUID("c1a1a1a1-0000-4000-8000-000000000002"), 0.04, 0.07),  # Viral Punch
    (uuid.UUID("c1a1a1a1-0000-4000-8000-000000000003"), 0.04, 0.095),  # One Word Hook
    (uuid.UUID("c1a1a1a1-0000-4000-8000-000000000004"), 0.034, 0.048),  # Clean Minimal
    (uuid.UUID("c1a1a1a1-0000-4000-8000-000000000005"), 0.038, 0.065),  # Neon Glow
    (uuid.UUID("c1a1a1a1-0000-4000-8000-000000000006"), 0.038, 0.062),  # Handwritten
]

# The original preset predates the wider bounds the seeded five shipped with, so it needs its own
# "restore this on downgrade" pair rather than one shared constant.
_OLD_BOUNDS_BY_ID = {
    uuid.UUID("c1a1a1a1-0000-4000-8000-000000000001"): {"min": 0.04, "max": 0.12},
}


def _set_font_size(preset_id: uuid.UUID, value: float) -> None:
    op.execute(
        _presets.update()
        .where(_presets.c.id == preset_id)
        .values(
            base=_presets.c.base.op("||")(
                sa.text(f"'{{\"fontSize\": {value}}}'::jsonb")
            )
        )
    )


def _set_bounds(preset_id: uuid.UUID, minimum: float, maximum: float) -> None:
    op.execute(
        _presets.update()
        .where(_presets.c.id == preset_id)
        .values(
            bounds=_presets.c.bounds.op("||")(
                sa.text(
                    f'\'{{"fontSize": {{"min": {minimum}, "max": {maximum}}}}}\'::jsonb'
                )
            )
        )
    )


def _clamp_stored_font_sizes(ceiling: float) -> None:
    """Both places a user-authored `fontSize` can be stored (contract §8 document overrides, and
    the per-segment override of §7/D11). Only rows already above the ceiling are touched."""
    for table in ("caption_style_specs", "segments"):
        op.execute(
            sa.text(
                f"""
                UPDATE {table}
                SET overrides = overrides || jsonb_build_object('fontSize', :ceiling)
                WHERE (overrides->>'fontSize')::float > :ceiling
                """
            ).bindparams(ceiling=ceiling)
        )


def upgrade() -> None:
    """Upgrade schema."""
    for preset_id, new_size, _ in _FONT_SIZES:
        _set_font_size(preset_id, new_size)
        _set_bounds(preset_id, _NEW_MIN, _NEW_MAX)
    _clamp_stored_font_sizes(_NEW_MAX)


def downgrade() -> None:
    """Downgrade schema.

    Restores the old defaults and bounds. Does NOT un-clamp stored documents: the original values
    are gone, and inventing a larger one would be worse than leaving a caption at a size that is
    still valid under the restored (wider) bounds.
    """
    for preset_id, _, old_size in _FONT_SIZES:
        _set_font_size(preset_id, old_size)
        old = _OLD_BOUNDS_BY_ID.get(preset_id, {"min": _OLD_MIN, "max": _OLD_MAX})
        _set_bounds(preset_id, old["min"], old["max"])
