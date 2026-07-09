from datetime import datetime
from enum import Enum
from uuid import UUID

from pydantic import BaseModel


class JobType(str, Enum):
    """Only the two queues that actually exist (INVARIANTS P5). A future `split`
    queue is a pure addition to this enum, not modeled here."""

    transcribe = "transcribe"
    export = "export"


class JobStatus(str, Enum):
    queued = "queued"
    processing = "processing"
    done = "done"
    failed = "failed"


class ExportResult(BaseModel):
    video_url: str
    srt_url: str
    json_url: str


class Job(BaseModel):
    id: UUID
    project_id: UUID
    owner_id: UUID
    type: JobType
    status: JobStatus
    created_at: datetime
    updated_at: datetime
    error: str | None
    result: ExportResult | None
