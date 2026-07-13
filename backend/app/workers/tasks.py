import asyncio
import uuid

from app.db import async_session_factory
from app.repositories import job as job_repo
from app.schemas.job import JobStatus
from app.services import raw_transcript as raw_transcript_service
from app.workers.celery_app import celery_app


@celery_app.task(queue="transcribe")
def transcribe_task(job_id: str) -> None:
    asyncio.run(_run_transcribe(uuid.UUID(job_id)))


async def _run_transcribe(job_id: uuid.UUID) -> None:
    """WhisperX + Raw Transcript persistence land here now (M1 step 5); the
    Initial Splitter + ECS slot in between the same two status updates in
    step 6 — the pipeline shape doesn't change, just what happens inside it."""
    async with async_session_factory() as session:
        job = await job_repo.update_status(session, job_id, status=JobStatus.processing)
        project_id = job.project_id

    try:
        async with async_session_factory() as session:
            await raw_transcript_service.create_raw_transcript(session, project_id)
    except Exception as exc:
        async with async_session_factory() as session:
            await job_repo.update_status(
                session, job_id, status=JobStatus.failed, error=str(exc)
            )
        return

    async with async_session_factory() as session:
        await job_repo.update_status(session, job_id, status=JobStatus.done)
