import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.schemas.job import Job
from app.services import jobs as job_service

router = APIRouter(prefix="/jobs", tags=["jobs"])


@router.get(
    "/{job_id}",
    response_model=Job,
    responses={404: {"description": "Job not found"}},
)
async def get_job(job_id: uuid.UUID, session: AsyncSession = Depends(get_db)) -> Job:
    job = await job_service.get_job(session, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return job
