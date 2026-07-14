import asyncio
import uuid

from app.db import async_session_factory
from app.integrations import storage
from app.integrations.ffmpeg import (
    VideoProbe,
    extract_thumbnail,
    probe_video,
    transcode_proxy,
)
from app.integrations.whisperx import TranscribedWord
from app.repositories import job as job_repo
from app.repositories import project as project_repo
from app.schemas.job import JobProgress, JobStatus
from app.services import ecs as ecs_service
from app.services import raw_transcript as raw_transcript_service
from app.workers.celery_app import celery_app

# Above 1080p, the source is downscaled for the editor's preview player
# (arch §2.8d) — the standard "proxy editing" pattern.
_PROXY_HEIGHT_THRESHOLD = 1080


@celery_app.task(queue="transcribe")
def transcribe_task(job_id: str) -> None:
    asyncio.run(_run_transcribe(uuid.UUID(job_id)))


async def _run_transcribe(job_id: uuid.UUID) -> None:
    """Runs the four branches from arch §2.8 concurrently, one Celery task,
    one job, one status row:
    (a) WhisperX -> Raw Transcript -> Initial Splitter -> ECS
    (b) ffmpeg probe (width/height/duration)
    (c) thumbnail extraction (needs (b)'s duration for the midpoint)
    (d) conditional preview-proxy transcode (needs (b)'s height)
    (b) runs once as a shared task; (c) and (d) each await it rather than
    probing a second time."""
    async with async_session_factory() as session:
        job = await job_repo.update_status(
            session,
            job_id,
            status=JobStatus.processing,
            progress=JobProgress.preparing,
        )
        project_id = job.project_id

    async with async_session_factory() as session:
        project = await project_repo.get(session, project_id)
    if project is None:
        raise ValueError(f"project {project_id} not found")
    video_path = storage.resolve_url(project.video_url)
    source_video_url = project.video_url

    probe_task: asyncio.Task[VideoProbe] = asyncio.create_task(probe_video(video_path))

    async def transcribe_split_and_persist_ecs() -> None:
        async with async_session_factory() as session:
            await job_repo.update_status(
                session,
                job_id,
                status=JobStatus.processing,
                progress=JobProgress.transcribing,
            )
        async with async_session_factory() as session:
            raw = await raw_transcript_service.create_raw_transcript(
                session, project_id
            )
        words = [
            TranscribedWord(text=w.text, start=w.start, end=w.end) for w in raw.words
        ]
        async with async_session_factory() as session:
            await ecs_service.create_initial_ecs(
                session, project_id=project_id, owner_id=raw.owner_id, words=words
            )

    async def persist_probe_and_thumbnail() -> None:
        probe = await probe_task
        thumb_path, thumb_url = storage.thumbnail_path(project_id)
        await extract_thumbnail(video_path, probe.duration_seconds, thumb_path)
        async with async_session_factory() as session:
            await project_repo.update_media(
                session,
                project_id,
                width=probe.width,
                height=probe.height,
                duration_seconds=probe.duration_seconds,
                thumbnail_url=thumb_url,
            )

    async def maybe_generate_proxy() -> None:
        probe = await probe_task
        if probe.height > _PROXY_HEIGHT_THRESHOLD:
            proxy_dest, preview_url = storage.proxy_path(project_id)
            await transcode_proxy(video_path, proxy_dest)
        else:
            preview_url = source_video_url
        async with async_session_factory() as session:
            await project_repo.update_preview(
                session, project_id, preview_video_url=preview_url
            )

    task_a = asyncio.create_task(transcribe_split_and_persist_ecs())
    task_b = asyncio.create_task(persist_probe_and_thumbnail())
    task_d = asyncio.create_task(maybe_generate_proxy())
    branches = (task_a, task_b, task_d)

    try:
        await task_a
        if not task_d.done():
            async with async_session_factory() as session:
                await job_repo.update_status(
                    session,
                    job_id,
                    status=JobStatus.processing,
                    progress=JobProgress.generating_preview,
                )
        await asyncio.gather(task_b, task_d)
    except Exception as exc:
        for branch in branches:
            if not branch.done():
                branch.cancel()
        await asyncio.gather(*branches, return_exceptions=True)
        async with async_session_factory() as session:
            await job_repo.update_status(
                session, job_id, status=JobStatus.failed, progress=None, error=str(exc)
            )
        return

    async with async_session_factory() as session:
        await job_repo.update_status(
            session, job_id, status=JobStatus.done, progress=None
        )
