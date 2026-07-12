import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.job import JobModel
from app.repositories import job as job_repo
from app.schemas.job import ExportResult, Job


def _to_schema(model: JobModel) -> Job:
    return Job(
        id=model.id,
        project_id=model.project_id,
        owner_id=model.owner_id,
        type=model.type,
        status=model.status,
        created_at=model.created_at,
        updated_at=model.updated_at,
        error=model.error,
        result=ExportResult(**model.result) if model.result else None,
    )


async def get_job(session: AsyncSession, job_id: uuid.UUID) -> Job | None:
    model = await job_repo.get(session, job_id)
    return _to_schema(model) if model else None
