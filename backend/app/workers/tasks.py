import asyncio
import logging
import tempfile
import uuid
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from app.db import async_session_factory
from app.integrations import storage
from app.integrations.ffmpeg import (
    VideoProbe,
    burn_in_captions,
    extract_thumbnail,
    probe_video,
    transcode_proxy,
)
from app.integrations.subtitles import generate_ass, generate_srt
from app.integrations.whisperx import TranscribedWord
from app.repositories import ecs as ecs_repo
from app.repositories import job as job_repo
from app.repositories import project as project_repo
from app.schemas.ecs import ECS, Segment
from app.schemas.export import ExportRequestBody
from app.schemas.job import JobProgress, JobStatus
from app.schemas.style import CaptionStyleSpec
from app.services import ecs as ecs_service
from app.services import presets as presets_service
from app.services import raw_transcript as raw_transcript_service
from app.services import smart_splitter
from app.services import style as style_service
from app.services.language import SMART_SPLIT_LANGUAGES
from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)

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

    # Everything after the row is marked `processing` runs under one try -
    # a failure anywhere (missing project, malformed video_url, a branch
    # blowing up) must land the job in `failed`, never leave it stuck in
    # `processing` with no worker attached.
    started: list[asyncio.Task[Any]] = []
    try:
        async with async_session_factory() as session:
            project = await project_repo.get(session, project_id)
        if project is None:
            raise ValueError(f"project {project_id} not found")
        video_path = storage.resolve_url(project.video_url)
        source_video_url = project.video_url

        probe_task: asyncio.Task[VideoProbe] = asyncio.create_task(
            probe_video(video_path)
        )

        async def transcribe_split_and_persist_ecs() -> None:
            async with async_session_factory() as session:
                await job_repo.update_status(
                    session,
                    job_id,
                    status=JobStatus.processing,
                    progress=JobProgress.transcribing,
                )
            # Retry path (P2 allows re-running after `failed`): a prior
            # attempt may have persisted the Raw Transcript before dying.
            # Reusing it honors P1 (WhisperX exactly once per video) and
            # avoids the write-once PK rejecting a second insert (D1).
            async with async_session_factory() as session:
                raw = await raw_transcript_service.get_raw_transcript(
                    session, project_id
                )
            if raw is None:
                async with async_session_factory() as session:
                    raw = await raw_transcript_service.create_raw_transcript(
                        session, project_id
                    )
            async with async_session_factory() as session:
                existing_ecs = await ecs_service.get_ecs(session, project_id)
            if existing_ecs is not None:
                return  # same retry case - the ECS already exists, keep it
            words = [
                TranscribedWord(text=w.text, start=w.start, end=w.end)
                for w in raw.words
            ]
            async with async_session_factory() as session:
                await ecs_service.create_initial_ecs(
                    session, project_id=project_id, owner_id=raw.owner_id, words=words
                )

            # Smart re-split (Step 14, arch §5.3's "AI semantic splitter",
            # P7): a required refinement of the ECS just persisted above,
            # not a replacement of the Initial Splitter. Awaited directly,
            # not dispatched as a separate Celery task/queue: this closure
            # already has to block until it resolves (so the overall
            # transcribe Job's `done` transition, gated on `await task_a`
            # below, waits too - GET /ecs must never 404-then-change-under-
            # the-user mid-edit, D7), and since the transcribe worker slot
            # sits occupied waiting either way, a separate queue would add
            # machinery (a second Job row, cross-task dispatch) without
            # buying any real concurrency.
            # `raw.language` (what WhisperX actually detected/used), not
            # `project.language` (the user's upload-time choice, arch §2.9
            # - null forever when they picked "auto"): gating on the latter
            # meant smart-split silently never ran for anyone who left the
            # upload form on its default "auto detect" setting.
            if raw.language not in SMART_SPLIT_LANGUAGES:
                logger.info(
                    "smart-split skipped for project %s: detected language %r "
                    "not in allowlist %s",
                    project_id,
                    raw.language,
                    sorted(SMART_SPLIT_LANGUAGES),
                )
                return  # no LLM call attempted at all - dumb split is final

            logger.info(
                "smart-split starting for project %s, language=%s",
                project_id,
                raw.language,
            )
            try:
                applied = await _apply_smart_split(
                    project_id,
                    owner_id=raw.owner_id,
                    language=raw.language,
                )
            except Exception:
                # P7: smart-split failure (LLM error, exhausted validation
                # retries, or anything else) never fails the overall
                # transcribe Job - the dumb-split ECS persisted above is
                # already the accepted fallback. Caught here, not left to
                # propagate into _run_transcribe's own try/except, which
                # would otherwise (wrongly) mark the whole transcribe Job
                # `failed` over a smart-split-only problem.
                logger.exception(
                    "smart-split raised unexpectedly for project %s - keeping "
                    "the dumb split",
                    project_id,
                )
            else:
                logger.info(
                    "smart-split finished for project %s: applied=%s",
                    project_id,
                    applied,
                )

        async def persist_probe_and_thumbnail() -> None:
            probe = await probe_task
            thumb_path, thumb_url = storage.thumbnail_path(project_id)
            await extract_thumbnail(
                video_path, probe.duration_seconds, thumb_path, is_hdr=probe.is_hdr
            )
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

        started.append(probe_task)
        task_a = asyncio.create_task(transcribe_split_and_persist_ecs())
        task_b = asyncio.create_task(persist_probe_and_thumbnail())
        task_d = asyncio.create_task(maybe_generate_proxy())
        started += [task_a, task_b, task_d]

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
        for task in started:
            if not task.done():
                task.cancel()
        await asyncio.gather(*started, return_exceptions=True)
        async with async_session_factory() as session:
            await job_repo.update_status(
                session, job_id, status=JobStatus.failed, progress=None, error=str(exc)
            )
        return

    async with async_session_factory() as session:
        await job_repo.update_status(
            session, job_id, status=JobStatus.done, progress=None
        )


async def _run_job(
    job_id: uuid.UUID,
    do_work: Callable[[uuid.UUID, uuid.UUID], Awaitable[dict[str, str]]],
) -> None:
    """Shared status-transition skeleton for the two export-flavored tasks
    below (`_do_export`, `_do_srt_export`): mark `processing`, run the
    caller's work with `(project_id, job_id)`, mark `failed` with the
    exception message on any error, mark `done` with the work's returned
    result dict otherwise. `_run_transcribe` above is deliberately NOT built
    on this - it has multiple progress phases and concurrent branches with
    their own cancellation-on-failure handling, a genuinely different shape
    this skeleton would only obscure, not simplify."""
    async with async_session_factory() as session:
        job = await job_repo.update_status(
            session, job_id, status=JobStatus.processing, progress=None
        )
        project_id = job.project_id

    try:
        result = await do_work(project_id, job_id)
    except Exception as exc:
        async with async_session_factory() as session:
            await job_repo.update_status(
                session, job_id, status=JobStatus.failed, progress=None, error=str(exc)
            )
        return

    async with async_session_factory() as session:
        await job_repo.update_status(
            session, job_id, status=JobStatus.done, progress=None, result=result
        )


@celery_app.task(queue="export")
def export_task(job_id: str) -> None:
    asyncio.run(_run_job(uuid.UUID(job_id), _do_export))


async def _do_export(project_id: uuid.UUID, job_id: uuid.UUID) -> dict[str, str]:
    """`app/services/export.py` has already validated and persisted the
    submitted ecs/style by the time this runs (X5) - renders the one output
    artifact, the burned-in video, from what's now on disk/DB. SRT
    generation is a separate job (`_do_srt_export`) that does not persist
    anything (X6); the internal JSON bundle this used to also produce has
    been removed entirely (Step 13)."""
    async with async_session_factory() as session:
        project = await project_repo.get(session, project_id)
        if project is None:
            raise ValueError(f"project {project_id} not found")
        if project.video_width is None or project.video_height is None:
            raise ValueError(f"project {project_id} has no probed video dimensions")

        ecs = await ecs_service.get_ecs(session, project_id)
        if ecs is None:
            raise ValueError(f"project {project_id} has no ECS")
        style = await style_service.get_style(session, project_id)
        if style is None:
            raise ValueError(f"project {project_id} has no style")
        preset = await presets_service.get_preset(session, style.presetId)
        if preset is None:
            raise ValueError(f"preset {style.presetId} not found")

    video_path = storage.resolve_url(project.video_url)
    video_dest, video_url = storage.video_export_paths(project_id, job_id)

    ass_text = generate_ass(
        ecs, style, preset, project.video_width, project.video_height
    )

    with tempfile.TemporaryDirectory() as tmp_dir:
        ass_path = Path(tmp_dir) / "captions.ass"
        ass_path.write_text(ass_text)
        await burn_in_captions(video_path, ass_path, video_dest)

    return {"video_url": video_url}


@celery_app.task(queue="export")
def export_srt_task(job_id: str, export_request: dict[str, Any]) -> None:
    body = ExportRequestBody.model_validate(export_request)
    asyncio.run(
        _run_job(uuid.UUID(job_id), lambda pid, jid: _do_srt_export(pid, jid, body))
    )


async def _do_srt_export(
    project_id: uuid.UUID, job_id: uuid.UUID, body: ExportRequestBody
) -> dict[str, str]:
    """Unlike `_do_export`, nothing has been persisted (X6): ecs/style come
    straight from the request body captured at enqueue time, never reloaded
    from ecs_repo/style_repo - this function never imports either of those
    repositories, which is what actually guarantees it can't persist
    anything, not just a comment saying so. The only DB reads are read-only
    lookups needed to build the domain ECS/CaptionStyleSpec objects and
    resolve the style cascade: the project (for owner_id - ECS/
    CaptionStyleSpec require one, otherwise unused by generate_srt) and the
    preset (to resolve showPunctuation, S7). No video_width/height check, no
    video_path resolution, no ffmpeg call - SRT is plain text, it never
    touches the source video."""
    async with async_session_factory() as session:
        project = await project_repo.get(session, project_id)
        if project is None:
            raise ValueError(f"project {project_id} not found")
        preset = await presets_service.get_preset(session, body.style.presetId)
        if preset is None:
            raise ValueError(f"preset {body.style.presetId} not found")

    ecs = ECS(
        project_id=project_id, owner_id=project.owner_id, segments=body.ecs.segments
    )
    style = CaptionStyleSpec(
        project_id=project_id,
        owner_id=project.owner_id,
        presetId=body.style.presetId,
        perPhraseStyle=body.style.perPhraseStyle,
        overrides=body.style.overrides,
    )

    srt_text = generate_srt(ecs, style, preset)
    srt_dest, srt_url = storage.srt_export_paths(project_id, job_id)
    srt_dest.write_text(srt_text)

    return {"srt_url": srt_url}


async def _apply_smart_split(
    project_id: uuid.UUID, *, owner_id: uuid.UUID, language: str | None
) -> bool:
    """Plain awaited function, not a Celery task (Step 14 - see the comment
    in `transcribe_split_and_persist_ecs` for why). Re-fetches the ECS
    `transcribe_split_and_persist_ecs` just persisted (the dumb split) and,
    if the smart-splitter produces a valid result, replaces it. Returns
    whether it was applied - `False` (language not in the allowlist -
    already filtered by the caller, or 3 attempts exhausted without a valid
    result) is a normal outcome, not an error: the dumb split is left as-is
    either way."""
    async with async_session_factory() as session:
        ecs = await ecs_service.get_ecs(session, project_id)
    if ecs is None:
        return False

    words = [w for segment in ecs.segments for w in segment.words]
    groups = await smart_splitter.try_smart_split(words, language=language)
    if groups is None:
        return False

    # Original Word id/text/start/end are reused unchanged from the
    # already-persisted, already-valid ECS - only which segment each word
    # belongs to changes. Fresh Segment.id per new boundary. No defensive
    # ecs_validation.validate_segments call: apply_breaks only cuts an
    # already-ascending, non-overlapping word list into contiguous ranges -
    # it cannot reorder, duplicate, or drop a word, so V1-V5 hold by
    # construction, not by re-checking.
    new_segments = [
        Segment(id=uuid.uuid4(), words=list(group), overrides=None) for group in groups
    ]
    async with async_session_factory() as session:
        await ecs_repo.replace(
            session, project_id=project_id, owner_id=owner_id, segments=new_segments
        )
    return True
