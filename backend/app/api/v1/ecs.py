import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.schemas.ecs import ECS, ECSPutBody
from app.services import ecs as ecs_service

router = APIRouter(prefix="/projects", tags=["ecs"])


@router.get(
    "/{project_id}/ecs",
    response_model=ECS,
    responses={404: {"description": "Not transcribed yet"}},
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
    responses={
        404: {"description": "Not transcribed yet"},
        422: {"description": "Validation failed (V1-V5)"},
    },
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
