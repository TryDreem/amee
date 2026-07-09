from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class Project(BaseModel):
    id: UUID
    owner_id: UUID
    name: str
    video_url: str
    video_width: int
    video_height: int
    video_duration_seconds: float
    created_at: datetime
    latest_transcribe_job_id: UUID | None
    export_job_ids: list[UUID]
