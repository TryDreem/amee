import uuid

from fastapi import APIRouter

from app.schemas.recalculate import (
    PolymorphicJobResponse,
    RecalculateGroupsRequest,
    RecalculateGroupsResult,
)
from app.services import recalculate as recalculate_service

router = APIRouter(prefix="/projects", tags=["recalculate-groups"])


@router.post(
    "/{project_id}/recalculate-groups",
    responses={
        200: {"model": RecalculateGroupsResult},
        202: {"model": PolymorphicJobResponse},
    },
)
def recalculate_groups(
    project_id: uuid.UUID, body: RecalculateGroupsRequest
) -> RecalculateGroupsResult | PolymorphicJobResponse:
    # Always 200 for MVP - only the cheap Simple Splitter exists (P5, no
    # `split` queue built). project_id isn't used: this is fully stateless,
    # operating only on the words in the request body (contract §10) - no
    # DB session, nothing to look up.
    return recalculate_service.recalculate_groups(body)
