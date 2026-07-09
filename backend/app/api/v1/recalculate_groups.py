from fastapi import APIRouter, HTTPException

from app.schemas.recalculate import (
    PolymorphicJobResponse,
    RecalculateGroupsRequest,
    RecalculateGroupsResult,
)

router = APIRouter(prefix="/projects", tags=["recalculate-groups"])


@router.post(
    "/{project_id}/recalculate-groups",
    responses={
        200: {"model": RecalculateGroupsResult},
        202: {"model": PolymorphicJobResponse},
    },
)
def recalculate_groups(
    project_id: str, body: RecalculateGroupsRequest
) -> RecalculateGroupsResult | PolymorphicJobResponse:
    raise HTTPException(
        status_code=501,
        detail="POST /projects/{id}/recalculate-groups not implemented",
    )
