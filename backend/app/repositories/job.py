import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.job import JobModel
from app.schemas.job import JobStatus, JobType


async def create(
    session: AsyncSession,
    *,
    project_id: uuid.UUID,
    owner_id: uuid.UUID,
    job_type: JobType,
    job_id: uuid.UUID | None = None,
) -> JobModel:
    job = JobModel(
        project_id=project_id,
        owner_id=owner_id,
        type=job_type,
        status=JobStatus.queued,
    )
    if job_id is not None:
        job.id = job_id
    session.add(job)
    await session.commit()
    await session.refresh(job)
    return job


async def get(session: AsyncSession, job_id: uuid.UUID) -> JobModel | None:
    return await session.get(JobModel, job_id)


async def update_status(
    session: AsyncSession,
    job_id: uuid.UUID,
    *,
    status: JobStatus,
    error: str | None = None,
    result: dict[str, str] | None = None,
) -> JobModel:
    job = await session.get(JobModel, job_id)
    if job is None:
        raise ValueError(f"job {job_id} not found")
    job.status = status
    if error is not None:
        job.error = error
    if result is not None:
        job.result = result
    await session.commit()
    await session.refresh(job)
    return job
