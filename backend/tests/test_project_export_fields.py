import asyncio
import uuid
from collections.abc import Iterator
from pathlib import Path

import httpx
import pytest
from httpx import ASGITransport

from app.db import async_session_factory
from app.integrations import storage
from app.integrations.ffmpeg import probe_video
from app.integrations.whisperx import TranscribedWord
from app.main import app
from app.repositories import job as job_repo
from app.repositories import project as project_repo
from app.schemas.job import JobStatus, JobType
from app.services import ecs as ecs_service
from app.services import style as style_service
from app.workers.celery_app import celery_app
from app.workers.tasks import export_task


@pytest.fixture
def eager_celery() -> Iterator[None]:
    original_eager = celery_app.conf.task_always_eager
    original_propagates = celery_app.conf.task_eager_propagates
    celery_app.conf.task_always_eager = True
    celery_app.conf.task_eager_propagates = True
    try:
        yield
    finally:
        celery_app.conf.task_always_eager = original_eager
        celery_app.conf.task_eager_propagates = original_propagates


async def _create_transcribed_project(video_path: Path) -> uuid.UUID:
    async with async_session_factory() as session:
        project_id = uuid.uuid4()
        _, video_url = storage.save_video(
            project_id, "sample.mp4", video_path.read_bytes()
        )
        project = await project_repo.create(
            session,
            project_id=project_id,
            owner_id=uuid.uuid4(),
            name="Export fields test",
            video_url=video_url,
        )
        probe = await probe_video(video_path)
        await project_repo.update_media(
            session,
            project.id,
            width=probe.width,
            height=probe.height,
            duration_seconds=probe.duration_seconds,
            thumbnail_url="/files/projects/z/thumbnail.jpg",
        )
        await style_service.create_default_style(
            session, project_id=project.id, owner_id=project.owner_id
        )
        await ecs_service.create_initial_ecs(
            session,
            project_id=project.id,
            owner_id=project.owner_id,
            words=[TranscribedWord(text="hi", start=0.0, end=0.3)],
        )
        return project.id


async def _get_project_json(project_id: uuid.UUID) -> dict[str, object]:
    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get(f"/api/v1/projects/{project_id}")
    assert response.status_code == 200
    return dict(response.json())


def test_latest_export_fields_are_null_before_any_export(sample_video: Path) -> None:
    project_id = asyncio.run(_create_transcribed_project(sample_video))

    body = asyncio.run(_get_project_json(project_id))

    assert body["export_job_ids"] == []
    assert body["latest_export_job_id"] is None
    assert body["latest_export_url"] is None


def test_latest_export_url_is_null_while_export_is_processing(
    sample_video: Path,
) -> None:
    """Only a *done* export job's result counts - a queued/processing one
    has no `result` yet, so `latest_export_url` must not surface a stale or
    partial value."""
    project_id = asyncio.run(_create_transcribed_project(sample_video))

    async def _create_job() -> uuid.UUID:
        async with async_session_factory() as session:
            job = await job_repo.create(
                session,
                project_id=project_id,
                owner_id=uuid.uuid4(),
                job_type=JobType.export,
            )
            return job.id

    job_id = asyncio.run(_create_job())

    body = asyncio.run(_get_project_json(project_id))

    assert body["export_job_ids"] == [str(job_id)]
    assert body["latest_export_job_id"] == str(job_id)
    assert body["latest_export_url"] is None


def test_latest_export_fields_populate_once_export_completes(
    eager_celery: None, sample_video: Path
) -> None:
    project_id = asyncio.run(_create_transcribed_project(sample_video))

    async def _create_job() -> uuid.UUID:
        async with async_session_factory() as session:
            job = await job_repo.create(
                session,
                project_id=project_id,
                owner_id=uuid.uuid4(),
                job_type=JobType.export,
            )
            return job.id

    job_id = asyncio.run(_create_job())
    export_task.delay(str(job_id))

    body = asyncio.run(_get_project_json(project_id))

    assert body["latest_export_job_id"] == str(job_id)
    assert (
        body["latest_export_url"]
        == f"/files/projects/{project_id}/exports/{job_id}/video.mp4"
    )


def test_export_srt_jobs_never_count_as_the_latest_export(
    eager_celery: None, sample_video: Path
) -> None:
    """contract §4: latest_export_job_id/url are always `type: "export"`,
    never `"export_srt"` - an SRT-only run isn't "the export" a project-list
    card means by "Exported"."""
    project_id = asyncio.run(_create_transcribed_project(sample_video))

    async def _create_srt_job() -> uuid.UUID:
        async with async_session_factory() as session:
            job = await job_repo.create(
                session,
                project_id=project_id,
                owner_id=uuid.uuid4(),
                job_type=JobType.export_srt,
            )
            await job_repo.update_status(
                session,
                job.id,
                status=JobStatus.done,
                progress=None,
                result={"srt_url": "/files/projects/x/exports/y/captions.srt"},
            )
            return job.id

    asyncio.run(_create_srt_job())

    body = asyncio.run(_get_project_json(project_id))

    assert body["export_job_ids"] == []
    assert body["latest_export_job_id"] is None
    assert body["latest_export_url"] is None


def test_export_job_ids_lists_multiple_exports_newest_first(
    eager_celery: None, sample_video: Path
) -> None:
    project_id = asyncio.run(_create_transcribed_project(sample_video))

    async def _create_job() -> uuid.UUID:
        async with async_session_factory() as session:
            job = await job_repo.create(
                session,
                project_id=project_id,
                owner_id=uuid.uuid4(),
                job_type=JobType.export,
            )
            return job.id

    first_job_id = asyncio.run(_create_job())
    export_task.delay(str(first_job_id))
    second_job_id = asyncio.run(_create_job())
    export_task.delay(str(second_job_id))

    body = asyncio.run(_get_project_json(project_id))

    assert body["export_job_ids"] == [str(second_job_id), str(first_job_id)]
    assert body["latest_export_job_id"] == str(second_job_id)
