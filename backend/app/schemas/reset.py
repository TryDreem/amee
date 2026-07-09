from uuid import UUID

from pydantic import BaseModel

from app.schemas.ecs import Segment


class ResetToRawResult(BaseModel):
    """200 branch — same shape as GET /ecs (contract §11)."""

    project_id: UUID
    owner_id: UUID
    segments: list[Segment]
