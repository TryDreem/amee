import uuid
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.job import JobModel
from app.schemas.job import JobProgress, JobStatus, JobType

_UNSET: Any = object()


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
    progress: JobProgress | None = _UNSET,
    error: str | None = None,
    result: dict[str, str] | None = None,
) -> JobModel:
    """`progress` defaults to the `_UNSET` sentinel rather than `None` so a
    caller can explicitly clear it (pass `progress=None` on done/failed)
    without that being indistinguishable from "didn't pass progress at all"
    (arch §2.8 — progress is only meaningful mid-`processing`)."""
    job = await session.get(JobModel, job_id)
    if job is None:
        raise ValueError(f"job {job_id} not found")
    job.status = status
    if progress is not _UNSET:
        job.progress = progress
    if error is not None:
        job.error = error
    if result is not None:
        job.result = result
    await session.commit()
    await session.refresh(job)
    return job


async def get_latest_by_project(
    session: AsyncSession, project_id: uuid.UUID, job_type: JobType
) -> JobModel | None:
    result = await session.execute(
        select(JobModel)
        .where(JobModel.project_id == project_id, JobModel.type == job_type)
        .order_by(JobModel.created_at.desc())
        .limit(1)
    )
    return result.scalars().first()


async def list_ids_by_project(
    session: AsyncSession, project_id: uuid.UUID, job_type: JobType
) -> list[uuid.UUID]:
    """Backs `Project.export_job_ids` (contract §4) — every id, not just the
    latest, so the frontend can (eventually) show export history. Selects
    only the id column rather than loading full `JobModel` rows, since
    that's all this needs."""
    result = await session.execute(
        select(JobModel.id)
        .where(JobModel.project_id == project_id, JobModel.type == job_type)
        .order_by(JobModel.created_at.desc())
    )
    return list(result.scalars().all())


async def delete_by_project(session: AsyncSession, project_id: uuid.UUID) -> None:
    """Used by `DELETE /projects/{id}` (contract §4, X8) - `jobs.project_id`
    has no `ON DELETE CASCADE` at the DB level, so this has to run before
    the `Project` row itself or Postgres rejects the delete on the foreign
    key."""
    await session.execute(delete(JobModel).where(JobModel.project_id == project_id))
    await session.commit()
