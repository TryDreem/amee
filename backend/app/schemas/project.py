from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class Project(BaseModel):
    id: UUID
    owner_id: UUID
    name: str
    video_url: str
    language: str | None
    thumbnail_url: str | None
    preview_video_url: str | None
    video_width: int | None
    video_height: int | None
    video_duration_seconds: float | None
    created_at: datetime
    latest_transcribe_job_id: UUID | None
    export_job_ids: list[UUID]
