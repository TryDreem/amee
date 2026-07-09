from pydantic import BaseModel, ConfigDict

from app.schemas.ecs import Segment, Word
from app.schemas.job import Job


class RecalculateGroupsRequest(BaseModel):
    """Carries the live frontend Words[], not just a project id — this endpoint
    must operate on unsaved edits too (contract §10)."""

    model_config = ConfigDict(extra="forbid")

    words: list[Word]


class RecalculateGroupsResult(BaseModel):
    """200 branch — the active splitter is cheap (MVP default)."""

    segments: list[Segment]


class PolymorphicJobResponse(BaseModel):
    """202 branch — the active splitter is expensive. Shared shape for both
    recalculate-groups and reset-to-raw (contract §10, §11). Never exercised by
    the MVP splitter today (INVARIANTS P5)."""

    job: Job
