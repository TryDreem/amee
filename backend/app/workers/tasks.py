import asyncio
import uuid

from app.db import async_session_factory
from app.repositories import job as job_repo
from app.schemas.job import JobStatus
from app.workers.celery_app import celery_app


@celery_app.task(queue="transcribe")
def transcribe_task(job_id: str) -> None:
    asyncio.run(_run_transcribe(uuid.UUID(job_id)))


async def _run_transcribe(job_id: uuid.UUID) -> None:
    """Status transitions only for now (M1 step 4). WhisperX, Raw Transcript,
    and the Initial Splitter land in steps 5-6 and slot in between these two
    updates — the pipeline shape doesn't change, just what happens inside it."""
    async with async_session_factory() as session:
        await job_repo.update_status(session, job_id, status=JobStatus.processing)

    async with async_session_factory() as session:
        await job_repo.update_status(session, job_id, status=JobStatus.done)
