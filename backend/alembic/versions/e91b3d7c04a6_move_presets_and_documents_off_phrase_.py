"""move presets and documents off the "phrase" reveal mode

The style panel no longer offers `revealMode: "phrase"` as a choice. The value stays valid on the
wire (contract §8 still lists all three, and both renderers still handle it) — this migration only
makes sure nothing in the database is *sitting* on a mode the UI has no button for, which would
show up as a reveal control with nothing selected and no way back to it.

Why the button went: "phrase" never meant "the whole phrase appears at once". Every word still
enters at its own `start`, because the entrance animation is applied per word with a negative
delay derived from that word's timestamp. The only thing "phrase" changes versus "progressive" is
that every word wears the highlight colour instead of just the active one. The look people
actually reach for under that name — everything on screen from the first frame — is
`captionAnimation: "none"`, which is a separate control and always was.

One seeded preset (Handwritten, `...0006`) and any user document that saved the value are moved to
`"progressive"`. The match is on the value itself rather than on a list of ids: the point is that
no row is left on "phrase", not that six specific rows are updated.

Revision ID: e91b3d7c04a6
Revises: d4e81c72af95
"""

import uuid
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "e91b3d7c04a6"
down_revision: str | Sequence[str] | None = "d4e81c72af95"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_HANDWRITTEN_ID = uuid.UUID("c1a1a1a1-0000-4000-8000-000000000006")


def _replace_reveal_mode(table: str, column: str, before: str, after: str) -> None:
    op.execute(
        sa.text(
            f"""
            UPDATE {table}
            SET {column} = {column} || jsonb_build_object('revealMode', :after)
            WHERE {column}->>'revealMode' = :before
            """
        ).bindparams(before=before, after=after)
    )


def upgrade() -> None:
    """Upgrade schema."""
    _replace_reveal_mode("presets", "base", "phrase", "progressive")
    # Both places a user-authored revealMode can be stored: the document-level overrides of
    # contract §8, and the per-segment override of §7/D11.
    _replace_reveal_mode("caption_style_specs", "overrides", "phrase", "progressive")
    _replace_reveal_mode("segments", "overrides", "phrase", "progressive")


def downgrade() -> None:
    """Downgrade schema.

    Restores only the one preset whose original value is known from its own seed migration.
    Documents are left alone: which of them said "phrase" before is not recoverable, and guessing
    would rewrite captions the user may since have set deliberately.
    """
    op.execute(
        sa.text(
            """
            UPDATE presets
            SET base = base || jsonb_build_object('revealMode', 'phrase')
            WHERE id = :preset_id
            """
        ).bindparams(preset_id=_HANDWRITTEN_ID)
    )
