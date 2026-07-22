from datetime import datetime
from enum import Enum
from uuid import UUID

from pydantic import BaseModel


class JobType(str, Enum):
    """`export_srt` shares the `export` queue (INVARIANTS P5, X6) - it is not
    a third queue, just a second job type on an existing one. A future
    `split` queue is a pure addition to this enum, not modeled here."""

    transcribe = "transcribe"
    export = "export"
    export_srt = "export_srt"


class JobStatus(str, Enum):
    queued = "queued"
    processing = "processing"
    done = "done"
    failed = "failed"


class JobProgress(str, Enum):
    """Best-effort "current bottleneck" signal across the transcribe job's
    four parallel branches (arch §2.8) — meaningful only while
    status="processing", null at every other status."""

    preparing = "preparing"
    transcribing = "transcribing"
    generating_preview = "generating_preview"


class ExportResult(BaseModel):
    video_url: str


class ExportSrtResult(BaseModel):
    srt_url: str


class Job(BaseModel):
    id: UUID
    project_id: UUID
    owner_id: UUID
    type: JobType
    status: JobStatus
    progress: JobProgress | None
    thumbnail_url: str | None
    created_at: datetime
    updated_at: datetime
    error: str | None
    result: ExportResult | ExportSrtResult | None
