from uuid import UUID

from pydantic import BaseModel, ConfigDict

from app.schemas.style import StyleOverrides


class Word(BaseModel):
    id: UUID
    text: str
    start: float
    end: float


class Segment(BaseModel):
    """No `start`/`end` — segment bounds are derived from words, never stored
    (INVARIANTS D5). `overrides` is the one deliberate exception to Data
    never carrying Style (INVARIANTS D11, arch §4.2) — only meaningful when
    the project's `CaptionStyleSpec.perPhraseStyle` is true."""

    id: UUID
    words: list[Word]
    overrides: StyleOverrides | None = None


class ECS(BaseModel):
    project_id: UUID
    owner_id: UUID
    segments: list[Segment]


class ECSPutBody(BaseModel):
    """Same shape as ECS minus project_id/owner_id — those come from the URL/
    session, not the client (contract §7)."""

    model_config = ConfigDict(extra="forbid")

    segments: list[Segment]
