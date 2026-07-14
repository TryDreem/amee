import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories import job as job_repo
from app.repositories import project as project_repo
from app.schemas.job import Job, JobStatus, JobType
from app.services import jobs as job_service
from app.workers.tasks import transcribe_task

# A prior failed job doesn't count against the once-per-video budget (P2,
# contract §4) — only these three statuses block a new transcribe job.
_BLOCKING_STATUSES = {JobStatus.queued, JobStatus.processing, JobStatus.done}


class TranscribeAlreadyInProgress(Exception):
    """Raised, never an HTTPException, so app/api/v1/transcribe.py stays the
    only place that knows this becomes a 409 (A1 — services never see
    Request/Response types)."""


async def start_transcription(
    session: AsyncSession, project_id: uuid.UUID
) -> Job | None:
    """Creates a `Job` and enqueues `transcribe_task` on the `transcribe`
    queue (arch §2.8). Returns `None` if the project doesn't exist; raises
    `TranscribeAlreadyInProgress` if the P2 guard blocks it."""
    project = await project_repo.get(session, project_id)
    if project is None:
        return None

    existing = await job_repo.get_latest_by_project(
        session, project_id, JobType.transcribe
    )
    if existing is not None and existing.status in _BLOCKING_STATUSES:
        raise TranscribeAlreadyInProgress()

    job = await job_repo.create(
        session,
        project_id=project_id,
        owner_id=project.owner_id,
        job_type=JobType.transcribe,
    )
    transcribe_task.delay(str(job.id))
    return await job_service.get_job(session, job.id)
