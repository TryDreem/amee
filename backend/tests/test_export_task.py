import asyncio
import json
import uuid
from collections.abc import Iterator
from pathlib import Path
from unittest.mock import patch

import pytest

from app.db import async_session_factory
from app.integrations import storage
from app.integrations.ffmpeg import probe_video
from app.integrations.whisperx import TranscribedWord
from app.models.job import JobModel
from app.repositories import job as job_repo
from app.repositories import project as project_repo
from app.schemas.export import ExportedJsonBundle
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


async def _create_export_job(video_path: Path) -> uuid.UUID:
    async with async_session_factory() as session:
        project_id = uuid.uuid4()
        _, video_url = storage.save_video(
            project_id, "sample.mp4", video_path.read_bytes()
        )
        project = await project_repo.create(
            session,
            project_id=project_id,
            owner_id=uuid.uuid4(),
            name="Export task test",
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
            words=[
                TranscribedWord(text="hello", start=0.0, end=0.4),
                TranscribedWord(text="world", start=0.4, end=0.9),
            ],
        )
        job = await job_repo.create(
            session,
            project_id=project.id,
            owner_id=project.owner_id,
            job_type=JobType.export,
        )
        return job.id


async def _get_job(job_id: uuid.UUID) -> JobModel:
    async with async_session_factory() as session:
        job = await job_repo.get(session, job_id)
        assert job is not None
        return job


def test_export_task_produces_video_srt_and_json(
    eager_celery: None, sample_video: Path
) -> None:
    job_id = asyncio.run(_create_export_job(sample_video))

    export_task.delay(str(job_id))

    finished = asyncio.run(_get_job(job_id))
    assert finished.status == JobStatus.done
    assert finished.error is None
    assert finished.result is not None

    video_path = storage.resolve_url(finished.result["video_url"])
    srt_path = storage.resolve_url(finished.result["srt_url"])
    json_path = storage.resolve_url(finished.result["json_url"])

    assert video_path.exists() and video_path.stat().st_size > 0
    assert "hello" in srt_path.read_text()

    bundle = ExportedJsonBundle.model_validate(json.loads(json_path.read_text()))
    assert [w.text for seg in bundle.ecs.segments for w in seg.words] == [
        "hello",
        "world",
    ]


def test_export_task_marks_job_failed_when_setup_fails(
    eager_celery: None, sample_video: Path
) -> None:
    job_id = asyncio.run(_create_export_job(sample_video))

    with patch(
        "app.workers.tasks.storage.resolve_url",
        side_effect=RuntimeError("bad storage url"),
    ):
        export_task.delay(str(job_id))

    finished = asyncio.run(_get_job(job_id))
    assert finished.status == JobStatus.failed
    assert finished.error == "bad storage url"
