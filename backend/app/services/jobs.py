import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.job import JobModel
from app.repositories import job as job_repo
from app.repositories import project as project_repo
from app.schemas.job import ExportResult, Job


async def _to_schema(session: AsyncSession, model: JobModel) -> Job:
    # thumbnail_url mirrors Project.thumbnail_url (contract §5) rather than
    # being stored on the job itself — the probe-and-thumbnail branch
    # (arch §2.8c) writes only to the project row; this join happens at
    # response time so there's exactly one place that field is stored.
    project = await project_repo.get(session, model.project_id)
    thumbnail_url = project.thumbnail_url if project else None

    return Job(
        id=model.id,
        project_id=model.project_id,
        owner_id=model.owner_id,
        type=model.type,
        status=model.status,
        progress=model.progress,
        thumbnail_url=thumbnail_url,
        created_at=model.created_at,
        updated_at=model.updated_at,
        error=model.error,
        result=ExportResult(**model.result) if model.result else None,
    )


async def get_job(session: AsyncSession, job_id: uuid.UUID) -> Job | None:
    model = await job_repo.get(session, job_id)
    return await _to_schema(session, model) if model else None
