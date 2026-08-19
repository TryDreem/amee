import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.deps import enforce_user_action_limit, require_project_owner
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
        404: {"description": "Project not found, or not owned by the caller"},
        422: {"description": "Validation failed (shared with PUT /ecs, PUT /style)"},
        429: {"description": "Per-user action rate limit exceeded"},
    },
    dependencies=[
        Depends(enforce_user_action_limit),
        Depends(require_project_owner),
    ],
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
        404: {"description": "Project not found, or not owned by the caller"},
        422: {"description": "Validation failed (request body is not persisted)"},
        429: {"description": "Per-user action rate limit exceeded"},
    },
    dependencies=[
        Depends(enforce_user_action_limit),
        Depends(require_project_owner),
    ],
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


@router.post(
    "/{project_id}/jobs/{job_id}/cancel",
    response_model=Job,
    status_code=202,
    responses={
        404: {"description": "Project or job not found, or not owned by the caller"},
        409: {"description": ("Job isn't type export, or isn't queued/processing")},
    },
    dependencies=[Depends(require_project_owner)],
)
async def cancel_export(
    project_id: uuid.UUID,
    job_id: uuid.UUID,
    session: AsyncSession = Depends(get_db),
) -> Job:
    try:
        job = await export_service.cancel_export(session, project_id, job_id)
    except export_service.ExportNotCancellable as exc:
        raise HTTPException(
            status_code=409,
            detail="Job isn't type export, or isn't queued/processing",
        ) from exc
    if job is None:
        raise HTTPException(status_code=404, detail="Project or job not found")
    return job
