import asyncio
import threading
import time
import uuid
from collections.abc import Iterator
from pathlib import Path
from unittest.mock import patch

import pytest

from app.db import async_session_factory
from app.integrations import storage
from app.integrations.whisperx import TranscribedWord
from app.models.job import JobModel
from app.models.project import ProjectModel
from app.repositories import job as job_repo
from app.repositories import project as project_repo
from app.repositories import raw_transcript as raw_transcript_repo
from app.schemas.job import JobStatus, JobType
from app.workers.celery_app import celery_app
from app.workers.tasks import transcribe_task

# The task calls the real whisperx integration in production; tests mock it
# out here rather than actually loading a model — that's what the live
# smoke test (run manually, not part of the suite) is for. ffmpeg (probe,
# thumbnail, proxy) runs for real against a real file, since it's fast and
# has no equivalent manual-only smoke test.
_FAKE_WORDS = [
    TranscribedWord(text="hello", start=0.0, end=0.4),
    TranscribedWord(text="world", start=0.4, end=0.9),
]


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


async def _create_queued_job(video_path: Path) -> uuid.UUID:
    async with async_session_factory() as session:
        project_id = uuid.uuid4()
        _, video_url = storage.save_video(
            project_id, "sample.mp4", video_path.read_bytes()
        )
        project = await project_repo.create(
            session,
            project_id=project_id,
            owner_id=uuid.uuid4(),
            name="Transcribe task test",
            video_url=video_url,
        )
        job = await job_repo.create(
            session,
            project_id=project.id,
            owner_id=project.owner_id,
            job_type=JobType.transcribe,
        )
        assert job.status == JobStatus.queued
        return job.id


async def _get_job(job_id: uuid.UUID) -> JobModel:
    async with async_session_factory() as session:
        job = await job_repo.get(session, job_id)
        assert job is not None
        return job


async def _get_project(project_id: uuid.UUID) -> ProjectModel:
    async with async_session_factory() as session:
        project = await project_repo.get(session, project_id)
        assert project is not None
        return project


async def _get_raw_transcript_words(
    project_id: uuid.UUID,
) -> list[dict[str, str | float]] | None:
    async with async_session_factory() as session:
        raw = await raw_transcript_repo.get_by_project(session, project_id)
        return raw.words if raw else None


def test_transcribe_task_transitions_queued_to_done(
    eager_celery: None, sample_video: Path
) -> None:
    """A plain (non-async) test on purpose: the task's own asyncio.run()
    (app/workers/tasks.py — the same pattern a real Celery worker process
    uses, arch §2.2) can't run inside a loop that's already running, which
    is exactly what an `async def` test would be."""
    job_id = asyncio.run(_create_queued_job(sample_video))
    job = asyncio.run(_get_job(job_id))

    with patch(
        "app.services.raw_transcript.transcribe_video", return_value=_FAKE_WORDS
    ):
        transcribe_task.delay(str(job_id))

    finished = asyncio.run(_get_job(job_id))
    assert finished.status == JobStatus.done
    assert finished.error is None
    assert finished.progress is None

    words = asyncio.run(_get_raw_transcript_words(job.project_id))
    assert words == [
        {"text": "hello", "start": 0.0, "end": 0.4},
        {"text": "world", "start": 0.4, "end": 0.9},
    ]

    project = asyncio.run(_get_project(job.project_id))
    assert project.video_width == 320
    assert project.video_height == 240
    assert project.thumbnail_url is not None
    # sample_video is 240p — no proxy needed, preview equals the source.
    assert project.preview_video_url == project.video_url


def test_transcribe_task_generates_proxy_above_1080p(
    eager_celery: None, tall_sample_video: Path
) -> None:
    job_id = asyncio.run(_create_queued_job(tall_sample_video))
    job = asyncio.run(_get_job(job_id))

    with patch(
        "app.services.raw_transcript.transcribe_video", return_value=_FAKE_WORDS
    ):
        transcribe_task.delay(str(job_id))

    finished = asyncio.run(_get_job(job_id))
    assert finished.status == JobStatus.done

    project = asyncio.run(_get_project(job.project_id))
    assert project.video_height == 1440
    assert project.preview_video_url is not None
    assert project.preview_video_url != project.video_url
    assert project.preview_video_url.endswith("proxy.mp4")


def test_transcribe_task_reports_progress_while_processing(
    eager_celery: None, sample_video: Path
) -> None:
    """Polls the job row from a second thread while transcribe_task (whose
    own asyncio.run() blocks the main thread until done) runs, to observe
    intermediate `progress` values a single before/after snapshot can't
    catch."""
    job_id = asyncio.run(_create_queued_job(sample_video))

    def slow_transcribe(
        path: Path, language: str | None = None
    ) -> list[TranscribedWord]:
        time.sleep(0.4)
        return _FAKE_WORDS

    observed: list[str | None] = []

    def poll() -> None:
        for _ in range(100):
            job = asyncio.run(_get_job(job_id))
            observed.append(job.progress.value if job.progress else None)
            if job.status == JobStatus.done:
                return
            time.sleep(0.02)

    with patch(
        "app.services.raw_transcript.transcribe_video", side_effect=slow_transcribe
    ):
        poller = threading.Thread(target=poll)
        poller.start()
        transcribe_task.delay(str(job_id))
        poller.join(timeout=5)

    assert "transcribing" in observed
    assert observed[-1] is None


def test_transcribe_task_marks_job_failed_on_whisperx_error(
    eager_celery: None, sample_video: Path
) -> None:
    job_id = asyncio.run(_create_queued_job(sample_video))

    with patch(
        "app.services.raw_transcript.transcribe_video",
        side_effect=RuntimeError("model blew up"),
    ):
        transcribe_task.delay(str(job_id))

    finished = asyncio.run(_get_job(job_id))
    assert finished.status == JobStatus.failed
    assert finished.error == "model blew up"
    assert finished.progress is None
