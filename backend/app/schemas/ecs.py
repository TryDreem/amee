from uuid import UUID

from pydantic import BaseModel, ConfigDict


class Word(BaseModel):
    id: UUID
    text: str
    start: float
    end: float


class Segment(BaseModel):
    """No `start`/`end` — segment bounds are derived from words, never stored
    (INVARIANTS D5)."""

    id: UUID
    words: list[Word]


class ECS(BaseModel):
    project_id: UUID
    owner_id: UUID
    segments: list[Segment]


class ECSPutBody(BaseModel):
    """Same shape as ECS minus project_id/owner_id — those come from the URL/
    session, not the client (contract §7)."""

    model_config = ConfigDict(extra="forbid")

    segments: list[Segment]
