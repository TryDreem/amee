import asyncio
import uuid
from collections.abc import Iterator
from pathlib import Path
from unittest.mock import patch

import pytest

from app.db import async_session_factory
from app.integrations import redis as redis_integration
from app.integrations import storage
from app.integrations.browser_render import CaptionBand
from app.integrations.ffmpeg import FfmpegError, probe_video
from app.integrations.whisperx import TranscribedWord
from app.models.job import JobModel
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


def test_export_task_produces_video_only(
    eager_celery: None, sample_video: Path
) -> None:
    job_id = asyncio.run(_create_export_job(sample_video))

    export_task.delay(str(job_id))

    finished = asyncio.run(_get_job(job_id))
    assert finished.status == JobStatus.done
    assert finished.error is None
    assert finished.result is not None
    assert set(finished.result.keys()) == {"video_url"}

    video_path = storage.resolve_url(finished.result["video_url"])
    assert video_path.exists() and video_path.stat().st_size > 0


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


def test_export_task_reports_progress_to_redis_and_clears_it_on_done(
    eager_celery: None, sample_video: Path
) -> None:
    """contract §5/A5: _do_export blends both phases' progress into one
    0-100 bar and pushes it to Redis (throttled - see
    _PROGRESS_WRITE_THRESHOLD_PERCENT), and the key is gone once the job
    reaches done, not left to expire on its TTL.

    The two phases occupy disjoint bands (_RENDER_PHASE_SHARE), so a full
    frame-render phase reaching 100% must report 70, not 100 - otherwise the
    bar would hit 100 while the composite hadn't even started, then appear
    frozen."""
    job_id = asyncio.run(_create_export_job(sample_video))

    async def _fake_render_frames(
        dest_dir: Path,
        **kwargs: object,
    ) -> CaptionBand:
        on_progress = kwargs["on_progress"]
        assert kwargs["should_cancel"] is not None
        for percent in (50.0, 100.0):
            await on_progress(percent)  # type: ignore[operator]
        return CaptionBand(y=100, height=50)

    async def _fake_burn_in_captions(
        video_path: Path,
        frames_dir: Path,
        dest: Path,
        *,
        fps: float,
        overlay_y: int = 0,
        on_progress: object = None,
        total_duration_seconds: float | None = None,
        on_pid: object = None,
    ) -> None:
        assert on_progress is not None
        assert total_duration_seconds is not None
        assert on_pid is not None
        assert fps > 0
        # The band's offset must reach ffmpeg, or the strip would be composited
        # at the top of the frame instead of where the caption sits.
        assert overlay_y == 100
        await on_pid(4242)  # type: ignore[operator]
        for percent in (50.0, 100.0):
            await on_progress(percent)  # type: ignore[operator]
        dest.write_bytes(b"fake video bytes")

    reported: list[float] = []
    original_set = redis_integration.set_export_progress

    async def _recording_set(job_id_str: str, percent: float) -> None:
        reported.append(percent)
        await original_set(job_id_str, percent)

    with (
        # browser_render is imported lazily inside _do_export now (same reasoning as
        # whisperx.py's own lazy import - keeps Playwright out of the API server's process,
        # which imports this module transitively via services/export.py), so the patch target
        # is the real module, not a module-level name on tasks that no longer exists.
        patch("app.integrations.browser_render.render_frames", _fake_render_frames),
        patch("app.workers.tasks.burn_in_captions", _fake_burn_in_captions),
        patch(
            "app.workers.tasks.redis_integration.set_export_progress",
            _recording_set,
        ),
    ):
        export_task.delay(str(job_id))

    # Render phase 50/100 -> 35/70; composite phase 50/100 -> 85/100.
    assert reported == [35.0, 70.0, 85.0, 100.0]
    finished = asyncio.run(_get_job(job_id))
    assert finished.status == JobStatus.done
    assert asyncio.run(redis_integration.get_export_progress(str(job_id))) is None


def test_export_task_marks_cancelled_when_queued_job_was_cancelled_before_starting(
    eager_celery: None, sample_video: Path
) -> None:
    """contract §5: a job cancelled while still `queued` (no ffmpeg pid to
    kill yet) is caught by _do_export's own early check - burn_in_captions
    must never even be called."""
    job_id = asyncio.run(_create_export_job(sample_video))
    asyncio.run(redis_integration.request_export_cancel(str(job_id)))

    with patch("app.workers.tasks.burn_in_captions") as mock_burn_in:
        export_task.delay(str(job_id))
        mock_burn_in.assert_not_called()

    finished = asyncio.run(_get_job(job_id))
    assert finished.status == JobStatus.cancelled
    assert finished.error is None
    assert asyncio.run(redis_integration.is_export_cancel_requested(str(job_id))) is (
        False
    )


def test_export_task_marks_cancelled_and_deletes_partial_file_when_killed(
    eager_celery: None, sample_video: Path
) -> None:
    """Simulates what a real `POST .../cancel` does concurrently: the
    process dies (FfmpegError, same shape as any ffmpeg crash) and the
    cancel flag is set. X7: the partial file burn_in_captions had already
    started writing must not survive."""
    job_id = asyncio.run(_create_export_job(sample_video))

    async def _killed_mid_render(
        video_path: Path, ass_path: Path, dest: Path, **kwargs: object
    ) -> None:
        dest.write_bytes(b"partial, truncated video bytes")
        await redis_integration.request_export_cancel(str(job_id))
        raise FfmpegError("Conversion failed! (killed by signal 15)")

    project_id = asyncio.run(_get_job(job_id)).project_id
    video_dest, _ = storage.video_export_paths(project_id, job_id)

    with patch("app.workers.tasks.burn_in_captions", _killed_mid_render):
        export_task.delay(str(job_id))

    finished = asyncio.run(_get_job(job_id))
    assert finished.status == JobStatus.cancelled
    assert finished.error is None
    assert not video_dest.exists()


def test_export_task_deletes_partial_file_on_genuine_failure_too(
    eager_celery: None, sample_video: Path
) -> None:
    """X7's cleanup isn't cancel-specific - a real, uncancelled ffmpeg crash
    must not leave a partial file behind either."""
    job_id = asyncio.run(_create_export_job(sample_video))

    async def _crashes_mid_render(
        video_path: Path, ass_path: Path, dest: Path, **kwargs: object
    ) -> None:
        dest.write_bytes(b"partial, truncated video bytes")
        raise FfmpegError("Error while filtering: Generic error")

    project_id = asyncio.run(_get_job(job_id)).project_id
    video_dest, _ = storage.video_export_paths(project_id, job_id)

    with patch("app.workers.tasks.burn_in_captions", _crashes_mid_render):
        export_task.delay(str(job_id))

    finished = asyncio.run(_get_job(job_id))
    assert finished.status == JobStatus.failed
    assert "Generic error" in (finished.error or "")
    assert not video_dest.exists()
