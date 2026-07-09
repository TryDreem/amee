from uuid import UUID

from pydantic import BaseModel


class RawTranscriptWord(BaseModel):
    """No `id` — raw-transcript words carry no link back from the ECS (INVARIANTS D2)."""

    text: str
    start: float
    end: float


class RawTranscript(BaseModel):
    project_id: UUID
    owner_id: UUID
    words: list[RawTranscriptWord]
