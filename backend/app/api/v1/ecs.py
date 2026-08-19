import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.deps import require_project_owner
from app.db import get_db
from app.schemas.ecs import ECS, ECSPutBody
from app.services import ecs as ecs_service

router = APIRouter(prefix="/projects", tags=["ecs"])


@router.get(
    "/{project_id}/ecs",
    response_model=ECS,
    # segment.overrides is sparse when present, and omitted (not a literal
    # null placeholder) when absent - same convention as CaptionStyleSpec
    # (contract §7, §8).
    response_model_exclude_none=True,
    responses={
        404: {
            "description": "Not transcribed yet, not found, or not owned by the caller"
        }
    },
    dependencies=[Depends(require_project_owner)],
)
async def get_ecs(
    project_id: uuid.UUID, session: AsyncSession = Depends(get_db)
) -> ECS:
    ecs = await ecs_service.get_ecs(session, project_id)
    if ecs is None:
        raise HTTPException(status_code=404, detail="Not transcribed yet")
    return ecs


@router.put(
    "/{project_id}/ecs",
    response_model=ECS,
    response_model_exclude_none=True,
    responses={
        404: {
            "description": "Not transcribed yet, not found, or not owned by the caller"
        },
        422: {"description": "Validation failed (V1-V5)"},
    },
    dependencies=[Depends(require_project_owner)],
)
async def put_ecs(
    project_id: uuid.UUID,
    body: ECSPutBody,
    session: AsyncSession = Depends(get_db),
) -> ECS:
    ecs = await ecs_service.put_ecs(session, project_id, body)
    if ecs is None:
        raise HTTPException(status_code=404, detail="Not transcribed yet")
    return ecs
