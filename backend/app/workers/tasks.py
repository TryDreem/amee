import asyncio
import logging
import tempfile
import uuid
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from app.db import async_session_factory
from app.integrations import redis as redis_integration
from app.integrations import storage
from app.integrations.ffmpeg import (
    VideoProbe,
    burn_in_captions,
    copy_video,
    extract_thumbnail,
    probe_video,
    transcode_proxy,
)
from app.integrations.subtitles import generate_srt
from app.integrations.whisperx import TranscribedWord
from app.repositories import ecs as ecs_repo
from app.repositories import job as job_repo
from app.repositories import project as project_repo
from app.repositories import user as user_repo
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

# ffmpeg's -progress fires far more often than a percent-based UI needs, or
# than Redis should be written to (A5) - only persist on at least this much
# movement, plus always the final 100 (handled separately in ffmpeg.py).
_PROGRESS_WRITE_THRESHOLD_PERCENT = 1.0

# Share of an export's single progress bar given to the frame-render phase,
# the rest going to the ffmpeg composite (see _do_export). A guess about
# relative wall time, not a measurement — its only hard requirement is that
# the two phases occupy disjoint bands so the bar never moves backwards.
_RENDER_PHASE_SHARE = 0.7

# Quota model's duration cap (services/projects.py has the matching project-count/file-size
# checks, and explains why this one specifically lives here rather than on the upload path:
# enforcing it there would need a synchronous probe, reopening arch §2.8's decision to move
# probing off of POST /projects). A video over the cap still uploads and holds a quota slot, but
# transcription refuses to run for it, landing the job in `failed` with a clear reason.
_MAX_VIDEO_DURATION_SECONDS = 60


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
            if probe.duration_seconds > _MAX_VIDEO_DURATION_SECONDS:
                raise ValueError(
                    f"video exceeds the {_MAX_VIDEO_DURATION_SECONDS}s duration "
                    f"limit ({probe.duration_seconds:.1f}s)"
                )
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
        # Quota model's counter (api-contract.md §15) - incremented here and only here: the
        # transcribe job actually reaching `done`, not the upload that started it. A job that
        # fails above (duration cap, no speech detected, any other error) already `return`ed
        # before this point, so it never reaches this line.
        await user_repo.increment_projects_uploaded(session, project.owner_id)


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
        # Harmless no-ops for _do_srt_export (never wrote any of these keys
        # to begin with) - cheap enough not to warrant a type check here,
        # and guarantees a crashed/cancelled export never leaves a stale
        # percent or pid behind.
        await redis_integration.clear_export_progress(str(job_id))
        await redis_integration.clear_export_pid(str(job_id))
        # P8/X7: a killed-by-cancel ffmpeg process raises the exact same
        # FfmpegError shape as one that genuinely crashed - the cancel flag
        # (set by the cancel endpoint before it signals the process, or by
        # _do_export's own early check if the job was still queued) is the
        # only thing that tells the two apart. Checked here regardless of
        # what `exc` actually is, not just for a specific exception type -
        # if a cancel was requested, that's the more honest status either
        # way, even in the unlikely race where ffmpeg also failed on its
        # own at the same moment.
        cancelled = await redis_integration.is_export_cancel_requested(str(job_id))
        await redis_integration.clear_export_cancel_requested(str(job_id))
        async with async_session_factory() as session:
            await job_repo.update_status(
                session,
                job_id,
                status=JobStatus.cancelled if cancelled else JobStatus.failed,
                progress=None,
                error=None if cancelled else str(exc),
            )
        return

    await redis_integration.clear_export_progress(str(job_id))
    await redis_integration.clear_export_pid(str(job_id))
    await redis_integration.clear_export_cancel_requested(str(job_id))
    async with async_session_factory() as session:
        await job_repo.update_status(
            session, job_id, status=JobStatus.done, progress=None, result=result
        )


@celery_app.task(queue="export")
def export_task(job_id: str) -> None:
    asyncio.run(_run_job(uuid.UUID(job_id), _do_export))


class ExportCancelled(Exception):
    """Raised by `_do_export` itself when it notices, before doing any real
    work, that a cancel was already requested (contract §5) - the job was
    still `queued` (no ffmpeg pid to signal yet) when `POST .../cancel`
    fired. A running export instead gets killed directly by pid and
    surfaces as a plain `FfmpegError` from the now-dead process -
    `_run_job`'s except block doesn't care which of the two this is, it
    just checks the same Redis flag either way."""


async def _do_export(project_id: uuid.UUID, job_id: uuid.UUID) -> dict[str, str]:
    """`app/services/export.py` has already validated and persisted the
    submitted ecs/style by the time this runs (X5) - renders the one output
    artifact, the burned-in video, from what's now on disk/DB. SRT
    generation is a separate job (`_do_srt_export`) that does not persist
    anything (X6); the internal JSON bundle this used to also produce has
    been removed entirely (Step 13)."""
    # Imported here, not at module level, same reasoning as whisperx.py's own lazy import: a
    # top-level `from app.integrations import browser_render` would pull Playwright into every
    # process that imports app.workers.tasks just to reference a task for .delay() - including
    # the API server itself (services/export.py does exactly that) - even though only this one
    # function ever actually touches a browser.
    from app.integrations import browser_render

    if await redis_integration.is_export_cancel_requested(str(job_id)):
        raise ExportCancelled()

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
    probe = await probe_video(video_path)

    last_reported_percent = -1.0

    async def _report_progress(percent: float) -> None:
        # Throttled (see _PROGRESS_WRITE_THRESHOLD_PERCENT) - closes over
        # last_reported_percent rather than a module-level/class variable
        # since this is scoped to one export's own progress, not shared
        # across concurrent exports in the same worker process.
        nonlocal last_reported_percent
        if (
            percent - last_reported_percent >= _PROGRESS_WRITE_THRESHOLD_PERCENT
            or percent >= 100.0
        ):
            last_reported_percent = percent
            await redis_integration.set_export_progress(str(job_id), percent)

    # One 0-100 bar over two phases of very different character (contract §5).
    # The split is a fixed guess, not a measurement: frame rendering dominates
    # wall time on every clip tried so far, but the real ratio moves with clip
    # length, resolution, and how much of the video actually has captions on
    # screen. A bar that advances unevenly is fine; one that goes backwards is
    # not, which is why each phase is mapped into its own disjoint band.
    async def _report_render_progress(percent: float) -> None:
        await _report_progress(percent * _RENDER_PHASE_SHARE)

    async def _report_mux_progress(percent: float) -> None:
        await _report_progress(
            _RENDER_PHASE_SHARE * 100 + percent * (1 - _RENDER_PHASE_SHARE)
        )

    async def _report_pid(pid: int) -> None:
        await redis_integration.set_export_pid(str(job_id), pid)

    async def _cancel_requested() -> bool:
        return await redis_integration.is_export_cancel_requested(str(job_id))

    try:
        with tempfile.TemporaryDirectory() as tmp_dir:
            frames_dir = Path(tmp_dir)
            # Phase 1: draw the captions with the frontend's own renderer (P9).
            # Unresolved preset/overrides go over as-is - the cascade runs in
            # the page, per active segment, exactly as the editor does it (R2).
            band = await browser_render.render_frames(
                frames_dir,
                segments=[s.model_dump(mode="json") for s in ecs.segments],
                preset=preset.model_dump(mode="json"),
                overrides=style.overrides.model_dump(mode="json"),
                per_phrase_style=style.perPhraseStyle,
                width=project.video_width,
                height=project.video_height,
                duration_seconds=probe.duration_seconds,
                fps=probe.fps,
                on_progress=_report_render_progress,
                should_cancel=_cancel_requested,
            )
            # Phase 2: composite those frames onto the source video. ffmpeg
            # renders no text here, it only overlays finished pixels.
            #
            # No band means no caption is visible anywhere (an ECS with no
            # words). Copying the source through is still the right answer -
            # the user asked for an export and gets a valid video - but there
            # is nothing to overlay, and pointing ffmpeg at an empty frame
            # directory would just fail.
            if band is None:
                await copy_video(
                    video_path,
                    video_dest,
                    on_progress=_report_mux_progress,
                    total_duration_seconds=probe.duration_seconds,
                    on_pid=_report_pid,
                )
            else:
                await burn_in_captions(
                    video_path,
                    frames_dir,
                    video_dest,
                    fps=probe.fps,
                    overlay_y=band.y,
                    on_progress=_report_mux_progress,
                    total_duration_seconds=probe.duration_seconds,
                    on_pid=_report_pid,
                )
    except Exception:
        # X7: a killed (cancelled) or genuinely-failed run can leave a
        # partial, invalid file at video_dest - never leave that on disk under
        # either outcome. missing_ok=True: it may have failed before the
        # output file was ever opened (including during phase 1, which never
        # touches it at all). The frame directory needs no such handling -
        # TemporaryDirectory removes it on every path out of the `with`.
        video_dest.unlink(missing_ok=True)
        raise

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
