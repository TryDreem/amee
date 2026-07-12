import asyncio
import uuid
from collections.abc import Iterator

import pytest

from app.db import async_session_factory
from app.repositories import job as job_repo
from app.repositories import project as project_repo
from app.schemas.job import JobStatus, JobType
from app.workers.celery_app import celery_app
from app.workers.tasks import transcribe_task


@pytest.fixture
def eager_celery() -> Iterator[None]:
    # Eager mode runs the task synchronously in-process, still through
    # Celery's own dispatch — this is what "enqueue a fake task" means
    # without needing a real worker process in the test suite. Reset after,
    # so this doesn't leak into any other test that touches celery_app.
    original_eager = celery_app.conf.task_always_eager
    original_propagates = celery_app.conf.task_eager_propagates
    celery_app.conf.task_always_eager = True
    celery_app.conf.task_eager_propagates = True
    try:
        yield
    finally:
        celery_app.conf.task_always_eager = original_eager
        celery_app.conf.task_eager_propagates = original_propagates


async def _create_queued_job() -> uuid.UUID:
    async with async_session_factory() as session:
        project = await project_repo.create(
            session,
            owner_id=uuid.uuid4(),
            name="Transcribe task test",
            video_url="/files/projects/z/source.mp4",
            video_width=100,
            video_height=100,
            video_duration_seconds=1.0,
        )
        job = await job_repo.create(
            session,
            project_id=project.id,
            owner_id=project.owner_id,
            job_type=JobType.transcribe,
        )
        assert job.status == JobStatus.queued
        return job.id


async def _get_status(job_id: uuid.UUID) -> JobStatus:
    async with async_session_factory() as session:
        job = await job_repo.get(session, job_id)
        assert job is not None
        return job.status


def test_transcribe_task_transitions_queued_to_done(eager_celery: None) -> None:
    """A plain (non-async) test on purpose: the task's own asyncio.run()
    (app/workers/tasks.py — the same pattern a real Celery worker process
    uses, arch §2.2) can't run inside a loop that's already running, which
    is exactly what an `async def` test would be."""
    job_id = asyncio.run(_create_queued_job())

    transcribe_task.delay(str(job_id))

    assert asyncio.run(_get_status(job_id)) == JobStatus.done
