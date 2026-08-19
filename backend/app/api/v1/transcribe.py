import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.deps import enforce_user_action_limit, require_project_owner
from app.db import get_db
from app.schemas.job import Job
from app.services import transcribe as transcribe_service

router = APIRouter(prefix="/projects", tags=["transcription"])


@router.post(
    "/{project_id}/transcribe",
    response_model=Job,
    status_code=202,
    responses={
        404: {"description": "Project not found, or not owned by the caller"},
        409: {"description": "A transcribe job is already queued/processing/done"},
        429: {"description": "Per-user action rate limit exceeded"},
    },
    dependencies=[
        Depends(enforce_user_action_limit),
        Depends(require_project_owner),
    ],
)
async def transcribe_project(
    project_id: uuid.UUID, session: AsyncSession = Depends(get_db)
) -> Job:
    try:
        job = await transcribe_service.start_transcription(session, project_id)
    except transcribe_service.TranscribeAlreadyInProgress as exc:
        raise HTTPException(
            status_code=409,
            detail="A transcribe job is already queued/processing/done",
        ) from exc
    if job is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return job
