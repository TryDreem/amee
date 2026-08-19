"""seed caption style presets

Five ready-made looks alongside the original "Bold Statement", so a new project has something to
pick from instead of one starting point plus a panel of raw controls.

Each is a complete `PresetBase` — font, size, colours, outline/shadow/glow, reveal mode and
entrance — chosen so the set spans the range rather than repeating one look in different colours:
a heavy MrBeast-style caps look, a one-word punch, a clean minimal, a neon glow, and a script.

`default` stays on "Bold Statement": exactly one preset may be flagged, and `POST /projects` uses
it to initialise every new project's style (contract §9). Changing which one is default would
silently restyle every project created afterwards, so it is left alone here.

Fonts are referenced by bare family name, matching `frontend/src/lib/fonts.ts` — every family used
below is loaded by both HTML entry points and has Cyrillic coverage, since a preset that renders
as fallback glyphs on Russian captions is worse than no preset.

Revision ID: b7f2c419ad30
Revises: c3d9b471e2a4
"""

import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "b7f2c419ad30"
down_revision: str | Sequence[str] | None = "c3d9b471e2a4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_presets = sa.table(
    "presets",
    sa.column("id", sa.UUID()),
    sa.column("name", sa.String()),
    sa.column("default", sa.Boolean()),
    sa.column("base", postgresql.JSONB()),
    sa.column("bounds", postgresql.JSONB()),
)

# Fixed ids, not generated at migration time: a preset id is referenced by every
# CaptionStyleSpec.presetId that points at it, so re-running this on another database has to
# produce the same ids or those documents would dangle.
_IDS = {
    "punch": uuid.UUID("c1a1a1a1-0000-4000-8000-000000000002"),
    "one_word": uuid.UUID("c1a1a1a1-0000-4000-8000-000000000003"),
    "clean": uuid.UUID("c1a1a1a1-0000-4000-8000-000000000004"),
    "neon": uuid.UUID("c1a1a1a1-0000-4000-8000-000000000005"),
    "script": uuid.UUID("c1a1a1a1-0000-4000-8000-000000000006"),
}

# Wider than the original preset's range on purpose: these looks are built around a specific size,
# and the bounds only need to stop genuinely unusable values (contract §9, L8 - bounds are
# per-preset, never one global constant).
_BOUNDS = {
    "fontSize": {"min": 0.03, "max": 0.14},
    "verticalPosition": {"min": 0.1, "max": 0.9},
    "safeArea": {
        "top": {"min": 0.05, "max": 0.2},
        "bottom": {"min": 0.05, "max": 0.25},
    },
}

_SAFE_AREA = {"top": 0.1, "bottom": 0.15}


def _base(**overrides: object) -> dict[str, object]:
    """Every field of PresetBase, so a preset row is always complete — the style cascade treats a
    preset as the bottom layer and never fills a gap in it."""
    return {
        "fontSize": 0.06,
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
        "captionAnimation": "none",
        "verticalPosition": 0.75,
        "safeArea": _SAFE_AREA,
        **overrides,
    }


_SEEDS = [
    {
        "id": _IDS["punch"],
        "name": "Viral Punch",
        "default": False,
        # The genre's default look: heavy caps, thick black stroke, yellow highlight, popping in.
        "base": _base(
            fontFamily="Russo One",
            fontWeight=400,
            fontSize=0.07,
            textTransform="uppercase",
            highlightColors=["#ffe600", "#00e5ff", "#ff4d4d"],
            outline={"size": "large", "color": "#000000", "alpha": 100},
            captionAnimation="pop",
            verticalPosition=0.78,
        ),
        "bounds": _BOUNDS,
    },
    {
        "id": _IDS["one_word"],
        "name": "One Word Hook",
        "default": False,
        # Single-word reveal: one big word at a time, the pattern used to hold attention in the
        # opening seconds of a short.
        "base": _base(
            fontFamily="Unbounded",
            fontWeight=800,
            fontSize=0.095,
            textTransform="uppercase",
            highlightColors=["#ffffff"],
            outline={"size": "medium", "color": "#000000", "alpha": 100},
            revealMode="single-word",
            captionAnimation="bounce",
            verticalPosition=0.5,
        ),
        "bounds": _BOUNDS,
    },
    {
        "id": _IDS["clean"],
        "name": "Clean Minimal",
        "default": False,
        # No outline, no glow, a soft shadow for legibility only — for footage that should stay
        # the subject rather than compete with the captions.
        "base": _base(
            fontFamily="Manrope",
            fontWeight=800,
            fontSize=0.048,
            highlightColors=["#7cf8c0"],
            shadow={"size": "small", "color": "#000000", "alpha": 60},
            showPunctuation=True,
            captionAnimation="fade",
            verticalPosition=0.82,
        ),
        "bounds": _BOUNDS,
    },
    {
        "id": _IDS["neon"],
        "name": "Neon Glow",
        "default": False,
        # Glow carries the contrast here instead of an outline, so the highlight colour is what
        # the eye follows.
        "base": _base(
            fontFamily="Exo 2",
            fontWeight=800,
            fontSize=0.065,
            textTransform="uppercase",
            color="#f2f7ff",
            highlightColors=["#00e5ff", "#b96bff", "#ff5cc8"],
            glow=True,
            shadow={"size": "medium", "color": "#001a2e", "alpha": 80},
            captionAnimation="blur",
            verticalPosition=0.74,
        ),
        "bounds": _BOUNDS,
    },
    {
        "id": _IDS["script"],
        "name": "Handwritten",
        "default": False,
        # Phrase reveal, not progressive: a script face reads as a written line, and revealing it
        # word by word fights that.
        "base": _base(
            fontFamily="Pacifico",
            fontWeight=400,
            fontSize=0.062,
            color="#fffaf2",
            highlightColors=["#ffb347"],
            shadow={"size": "medium", "color": "#3a1d00", "alpha": 70},
            showPunctuation=True,
            revealMode="phrase",
            captionAnimation="fade",
            verticalPosition=0.8,
        ),
        "bounds": _BOUNDS,
    },
]


def upgrade() -> None:
    """Upgrade schema."""
    op.bulk_insert(_presets, _SEEDS)


def downgrade() -> None:
    """Downgrade schema."""
    op.execute(
        _presets.delete().where(_presets.c.id.in_([seed["id"] for seed in _SEEDS]))
    )
