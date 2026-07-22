import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.schemas.export import ExportRequestBody
from app.schemas.job import Job
from app.services import export as export_service

router = APIRouter(prefix="/projects", tags=["export"])


@router.post(
    "/{project_id}/export",
    response_model=Job,
    status_code=202,
    responses={
        422: {"description": "Validation failed (shared with PUT /ecs, PUT /style)"}
    },
)
async def export_project(
    project_id: uuid.UUID,
    body: ExportRequestBody,
    session: AsyncSession = Depends(get_db),
) -> Job:
    job = await export_service.start_export(session, project_id, body)
    if job is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return job


@router.post(
    "/{project_id}/export-srt",
    response_model=Job,
    status_code=202,
    responses={
        422: {"description": "Validation failed (request body is not persisted)"}
    },
)
async def export_project_srt(
    project_id: uuid.UUID,
    body: ExportRequestBody,
    session: AsyncSession = Depends(get_db),
) -> Job:
    job = await export_service.start_export_srt(session, project_id, body)
    if job is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return job
