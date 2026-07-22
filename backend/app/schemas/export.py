from pydantic import BaseModel, ConfigDict

from app.schemas.ecs import ECSPutBody
from app.schemas.style import CaptionStyleSpecPutBody


class ExportRequestBody(BaseModel):
    """Carries the whole ECS + style documents, not just a project id — export
    must reflect exactly what's on screen, not stale backend state (contract
    §12). Shared verbatim by `POST /export` and `POST /export-srt` — both
    need the same ecs/style to do their respective jobs, and a second,
    structurally identical schema would just be one more thing that can
    drift from this one."""

    model_config = ConfigDict(extra="forbid")

    ecs: ECSPutBody
    style: CaptionStyleSpecPutBody
