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
    # What WhisperX actually detected/used, distinct from Project.language
    # (the user's upload-time choice - arch §2.9). Null for rows written
    # before this field existed. Not settable by any client - read-only,
    # like the rest of this endpoint (D1).
    language: str | None = None
