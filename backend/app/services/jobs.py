import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.integrations import redis as redis_integration
from app.models.job import JobModel
from app.repositories import job as job_repo
from app.repositories import project as project_repo
from app.schemas.job import ExportResult, ExportSrtResult, Job, JobStatus, JobType


async def _to_schema(session: AsyncSession, model: JobModel) -> Job:
    # thumbnail_url mirrors Project.thumbnail_url (contract §5) rather than
    # being stored on the job itself — the probe-and-thumbnail branch
    # (arch §2.8c) writes only to the project row; this join happens at
    # response time so there's exactly one place that field is stored.
    project = await project_repo.get(session, model.project_id)
    thumbnail_url = project.thumbnail_url if project else None

    # result's shape is discriminated by type, not guessed via Pydantic
    # union matching - export and export_srt have disjoint required fields
    # today, but explicit beats implicit for a wire-contract type. transcribe
    # jobs never populate `result` (see JobModel.result's own comment).
    result: ExportResult | ExportSrtResult | None = None
    if model.result is not None:
        if model.type == JobType.export:
            result = ExportResult(**model.result)
        elif model.type == JobType.export_srt:
            result = ExportSrtResult(**model.result)

    # Only meaningful for a currently-rendering export (contract §5) - never
    # queried for other type/status combinations, so a transcribe job's
    # poll never pays for a Redis round trip it can't use. Lives in Redis,
    # not this row (A3/A5) - unavailable/absent just reads as null.
    progress_percent: float | None = None
    if model.type == JobType.export and model.status == JobStatus.processing:
        progress_percent = await redis_integration.get_export_progress(str(model.id))

    return Job(
        id=model.id,
        project_id=model.project_id,
        owner_id=model.owner_id,
        type=model.type,
        status=model.status,
        progress=model.progress,
        progress_percent=progress_percent,
        thumbnail_url=thumbnail_url,
        created_at=model.created_at,
        updated_at=model.updated_at,
        error=model.error,
        result=result,
    )


async def get_job(session: AsyncSession, job_id: uuid.UUID) -> Job | None:
    model = await job_repo.get(session, job_id)
    return await _to_schema(session, model) if model else None
