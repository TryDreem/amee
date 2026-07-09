from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from app.schemas.ecs import ECSPutBody
from app.schemas.style import CaptionStyleSpecPutBody


class ExportRequestBody(BaseModel):
    """Carries the whole ECS + style documents, not just a project id — export
    must reflect exactly what's on screen, not stale backend state (contract
    §12)."""

    model_config = ConfigDict(extra="forbid")

    ecs: ECSPutBody
    style: CaptionStyleSpecPutBody


class ExportedJsonBundle(BaseModel):
    """The shape of the file at `json_url` — a portable snapshot, not a response
    body of any endpoint (contract §12)."""

    project_id: UUID
    owner_id: UUID
    exported_at: datetime
    ecs: ECSPutBody
    style: CaptionStyleSpecPutBody
