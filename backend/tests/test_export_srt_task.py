import asyncio
import uuid
from collections.abc import Iterator
from pathlib import Path
from unittest.mock import patch

import pytest

from app.db import async_session_factory
from app.integrations import storage
from app.models.job import JobModel
from app.repositories import job as job_repo
from app.repositories import project as project_repo
from app.schemas.export import ExportRequestBody
from app.schemas.job import JobStatus, JobType
from app.services import style as style_service
from app.workers.celery_app import celery_app
from app.workers.tasks import export_srt_task

_DEFAULT_PRESET_ID = uuid.UUID("c1a1a1a1-0000-4000-8000-000000000001")


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


def _valid_body() -> ExportRequestBody:
    return ExportRequestBody.model_validate(
        {
            "ecs": {
                "segments": [
                    {
                        "id": str(uuid.uuid4()),
                        "words": [
                            {
                                "id": str(uuid.uuid4()),
                                "text": "hello",
                                "start": 0.0,
                                "end": 0.4,
                            },
                            {
                                "id": str(uuid.uuid4()),
                                "text": "world",
                                "start": 0.4,
                                "end": 0.9,
                            },
                        ],
                    }
                ]
            },
            "style": {"presetId": str(_DEFAULT_PRESET_ID), "overrides": {}},
        }
    )


async def _create_srt_job(video_path: Path) -> uuid.UUID:
    """Deliberately does NOT set video_width/video_height (unlike
    test_export_task.py's helper) - proving _run_srt_export never needs
    them is the point of the "no video dimensions required" test below."""
    async with async_session_factory() as session:
        project_id = uuid.uuid4()
        _, video_url = await storage.save_video(
            project_id, "sample.mp4", video_path.read_bytes()
        )
        project = await project_repo.create(
            session,
            project_id=project_id,
            owner_id=uuid.uuid4(),
            name="Export SRT task test",
            video_url=video_url,
        )
        await style_service.create_default_style(
            session, project_id=project.id, owner_id=project.owner_id
        )
        job = await job_repo.create(
            session,
            project_id=project.id,
            owner_id=project.owner_id,
            job_type=JobType.export_srt,
        )
        return job.id


async def _get_job(job_id: uuid.UUID) -> JobModel:
    async with async_session_factory() as session:
        job = await job_repo.get(session, job_id)
        assert job is not None
        return job


def test_export_srt_task_produces_srt_without_video_dimensions(
    eager_celery: None, sample_video: Path
) -> None:
    job_id = asyncio.run(_create_srt_job(sample_video))

    export_srt_task.delay(str(job_id), _valid_body().model_dump(mode="json"))

    finished = asyncio.run(_get_job(job_id))
    assert finished.status == JobStatus.done
    assert finished.error is None
    assert finished.result is not None
    assert set(finished.result.keys()) == {"srt_url"}

    srt_path = asyncio.run(storage.resolve_url(finished.result["srt_url"]))
    text = srt_path.read_text()
    assert "hello" in text
    assert "world" in text


def test_export_srt_task_marks_job_failed_when_preset_missing(
    eager_celery: None, sample_video: Path
) -> None:
    job_id = asyncio.run(_create_srt_job(sample_video))
    body = _valid_body()
    body.style.presetId = uuid.uuid4()

    export_srt_task.delay(str(job_id), body.model_dump(mode="json"))

    finished = asyncio.run(_get_job(job_id))
    assert finished.status == JobStatus.failed
    assert finished.error is not None


def test_export_srt_task_marks_job_failed_when_setup_fails(
    eager_celery: None, sample_video: Path
) -> None:
    job_id = asyncio.run(_create_srt_job(sample_video))

    with patch(
        "app.workers.tasks.project_repo.get",
        side_effect=RuntimeError("db exploded"),
    ):
        export_srt_task.delay(str(job_id), _valid_body().model_dump(mode="json"))

    finished = asyncio.run(_get_job(job_id))
    assert finished.status == JobStatus.failed
    assert finished.error == "db exploded"
