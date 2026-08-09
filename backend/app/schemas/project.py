from datetime import datetime
from enum import Enum
from uuid import UUID

from pydantic import BaseModel


class ProjectSort(str, Enum):
    """A closed enum rather than a free-form field name + direction pair:
    the set of orderings is a product decision (it's the dropdown in the
    project list), and leaving it open would let a client order by any
    column, which is a much larger surface to keep indexed and correct."""

    newest = "newest"
    oldest = "oldest"
    updated = "updated"
    az = "az"
    za = "za"
    opened = "opened"


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
    updated_at: datetime
    last_opened_at: datetime | None
    latest_transcribe_job_id: UUID | None
    export_job_ids: list[UUID]


class ProjectPage(BaseModel):
    """`total` is a real count of everything matching the query, not
    `len(items)` — the UI renders "page X of Y", which a `has_more` boolean
    couldn't answer (contract §4)."""

    items: list[Project]
    total: int
