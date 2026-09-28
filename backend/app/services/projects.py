import os
import uuid
from collections.abc import AsyncIterable
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from app.exceptions import DomainValidationError
from app.integrations import storage
from app.models.project import ProjectModel
from app.repositories import ecs as ecs_repo
from app.repositories import job as job_repo
from app.repositories import project as project_repo
from app.repositories import raw_transcript as raw_transcript_repo
from app.repositories import style as style_repo
from app.repositories import user as user_repo
from app.schemas.common import ErrorDetail
from app.schemas.ecs import Segment, Word
from app.schemas.job import JobStatus, JobType
from app.schemas.project import Project, ProjectPage, ProjectSort
from app.services import ecs as ecs_service
from app.services import export as export_service
from app.services import style as style_service
from app.services.language import SUPPORTED_LANGUAGE_CODES

# Upload limits from arch §2.7 / contract §4. Only the two checks that need
# no ffmpeg probe are enforced here — §2.8 is explicit that upload "does
# exactly one thing: stores the file", so codec/resolution (which require
# probing) can't be checked on the request path; those failures surface in
# the transcribe job instead.
_ALLOWED_UPLOAD_EXTENSIONS = {".mp4", ".mov"}

# Quota model (resolved — contract §13/§15; only payment/pricing is still open, arch §14.12) — the
# human's chosen numbers. 100MB is a business-layer tightening under §2.7's stated 2GB ceiling,
# not a change to it. The matching duration cap (1 minute) is deliberately NOT enforced here:
# checking it would need a synchronous ffmpeg probe on this request path, which would reopen
# arch §2.8's own explicit decision to move probing off of it. It's enforced instead inside the
# transcribe job (app/workers/tasks.py), where the probe already runs.
_MAX_UPLOAD_BYTES = 100 * 1024**2  # 100MB

# Checked against User.projects_uploaded_count (app/models/user.py), not a live
# project_repo.count_by_owner - that count used to drop when a project was deleted, letting
# someone dodge the cap by upload-transcribe-delete-repeat. The counter only increments when a
# transcribe job actually reaches `done` (app/workers/tasks.py), so a failed or never-attempted
# transcription never counts against it, but a successful one counts forever, deletion or not.
_MAX_PROJECTS_PER_OWNER = 3

# Public (not `_`-prefixed): the route advertises the default in its own
# signature, and tests assert against the cap, so both are part of this
# module's interface rather than internal detail. 8 matches the frontend's
# fixed grid; 50 is the ceiling a client can't argue past (contract §4).
DEFAULT_PAGE_LIMIT = 8
MAX_PAGE_LIMIT = 50

_DEMO_PROJECT_NAME = "Demo project"


async def _to_schema(session: AsyncSession, model: ProjectModel) -> Project:
    latest_transcribe_job = await job_repo.get_latest_by_project(
        session, model.id, JobType.transcribe
    )
    # Both derived by querying jobs, never a stored column (arch §4.2) - the
    # same "no divergent second source of truth" reasoning already applied
    # to latest_transcribe_job_id. Always `type: "export"`, never
    # `"export_srt"` (contract §4) - an SRT-only export isn't "the export"
    # a project-list card means by "Exported".
    latest_export_job = await job_repo.get_latest_by_project(
        session, model.id, JobType.export
    )
    export_job_ids = await job_repo.list_ids_by_project(
        session, model.id, JobType.export
    )
    # latest_export_url is deliberately NOT just "latest_export_job's url once done": a failed
    # retry after a successful export must not hide the still-valid earlier download (contract
    # §4) - it's independently the most recent *successful* export's url, which may belong to an
    # older job than latest_export_job_id points at.
    latest_successful_export = await job_repo.get_latest_done_by_project(
        session, model.id, JobType.export
    )
    latest_export_url = None
    if (
        latest_successful_export is not None
        and latest_successful_export.result is not None
    ):
        latest_export_url = latest_successful_export.result.get("video_url")

    return Project(
        id=model.id,
        owner_id=model.owner_id,
        name=model.name,
        video_url=model.video_url,
        language=model.language,
        thumbnail_url=model.thumbnail_url,
        preview_video_url=model.preview_video_url,
        video_width=model.video_width,
        video_height=model.video_height,
        video_duration_seconds=model.video_duration_seconds,
        created_at=model.created_at,
        updated_at=model.updated_at,
        last_opened_at=model.last_opened_at,
        latest_transcribe_job_id=latest_transcribe_job.id
        if latest_transcribe_job
        else None,
        export_job_ids=export_job_ids,
        latest_export_job_id=latest_export_job.id if latest_export_job else None,
        latest_export_url=latest_export_url,
    )


async def seed_demo_project(session: AsyncSession, owner_id: uuid.UUID) -> None:
    """Gives a brand-new user (guest mint in app/api/v1/deps.py, or a fresh Google account in
    app/services/auth.py) one ready-to-explore project immediately, cloned from a human-prepared
    template - no WhisperX run, no ffmpeg, no file copy. The clone's video/thumbnail/preview URLs
    point straight at the template project's own files (read-only, shared) - storage.py's layout
    namespaces everything under the owning project_id, so the clone can never write into, and
    deleting it can never touch, the template's own files.

    No-op if AMEE_DEMO_PROJECT_ID isn't set (dev/CI have no template to point at) or doesn't
    resolve to a real, transcribed, styled project - a misconfigured template must never break
    real signups. Deliberately does not touch User.projects_uploaded_count: that counter is only
    bumped by a real transcribe job reaching `done` (app/workers/tasks.py), which this function
    never runs, so the clone naturally never counts against the 3-project quota (contract §13)."""
    template_id_raw = os.environ.get("AMEE_DEMO_PROJECT_ID")
    if not template_id_raw:
        return
    try:
        template_id = uuid.UUID(template_id_raw)
    except ValueError:
        return

    template = await project_repo.get(session, template_id)
    if template is None:
        return
    template_ecs = await ecs_service.get_ecs(session, template_id)
    template_style = await style_service.get_style(session, template_id)
    if template_ecs is None or template_style is None:
        return

    clone_id = uuid.uuid4()
    await project_repo.create(
        session,
        project_id=clone_id,
        owner_id=owner_id,
        name=_DEMO_PROJECT_NAME,
        video_url=template.video_url,
        language=template.language,
    )
    if (
        template.video_width is not None
        and template.video_height is not None
        and template.video_duration_seconds is not None
        and template.thumbnail_url is not None
    ):
        await project_repo.update_media(
            session,
            clone_id,
            width=template.video_width,
            height=template.video_height,
            duration_seconds=template.video_duration_seconds,
            thumbnail_url=template.thumbnail_url,
        )
    if template.preview_video_url is not None:
        await project_repo.update_preview(
            session, clone_id, preview_video_url=template.preview_video_url
        )

    # Fresh Segment/Word ids, not the template's own: INVARIANTS.md V9 only requires uniqueness
    # *within* a document, but segments.id/ecs_words.id are plain (non-composite) primary keys in
    # the real schema (app/models/ecs.py) - reusing the template's ids here would collide with the
    # template's own still-existing rows. Structure (word order/text/timing, segment overrides)
    # carries over unchanged; only the ids are regenerated.
    cloned_segments = [
        Segment(
            id=uuid.uuid4(),
            words=[
                Word(id=uuid.uuid4(), text=w.text, start=w.start, end=w.end)
                for w in segment.words
            ],
            overrides=segment.overrides,
        )
        for segment in template_ecs.segments
    ]
    await ecs_repo.replace(
        session, project_id=clone_id, owner_id=owner_id, segments=cloned_segments
    )
    await style_repo.create(
        session,
        project_id=clone_id,
        owner_id=owner_id,
        preset_id=template_style.presetId,
        per_phrase_style=template_style.perPhraseStyle,
        overrides=template_style.overrides.model_dump(exclude_none=True),
    )


async def create_project(
    session: AsyncSession,
    *,
    owner_id: uuid.UUID,
    name: str | None,
    filename: str,
    content: AsyncIterable[bytes],
    content_size: int | None = None,
    language: str | None = None,
) -> Project:
    details: list[ErrorDetail] = []
    ext = Path(filename).suffix.lower()
    if ext not in _ALLOWED_UPLOAD_EXTENSIONS:
        details.append(
            ErrorDetail(
                field="file",
                issue=f"unsupported format {ext or '(no extension)'}: "
                "expected .mp4 or .mov",
            )
        )
    if content_size is not None and content_size > _MAX_UPLOAD_BYTES:
        details.append(
            ErrorDetail(
                field="file",
                issue=f"file exceeds the {_MAX_UPLOAD_BYTES} byte limit",
            )
        )
    # `language` set once here, at upload, and never mutated afterward -
    # there's no PUT /projects/{id} (arch §2.9). None means auto-detect,
    # unchanged from today's behavior.
    if language is not None and language not in SUPPORTED_LANGUAGE_CODES:
        details.append(
            ErrorDetail(
                field="language", issue=f"unsupported language code: {language}"
            )
        )
    owner = await user_repo.get(session, owner_id)
    if owner is not None and owner.projects_uploaded_count >= _MAX_PROJECTS_PER_OWNER:
        details.append(
            ErrorDetail(
                field="quota",
                issue=f"project limit reached: at most {_MAX_PROJECTS_PER_OWNER} "
                "projects per user",
            )
        )
    if details:
        raise DomainValidationError(details)

    # Minted here, not by the DB default: storage needs the id up front to
    # namespace the file. Upload only saves the file (arch §2.8) — no
    # ffmpeg on the request path; width/height/duration/thumbnail_url/
    # preview_video_url all start null and are filled in later by the
    # transcribe job.
    project_id = uuid.uuid4()
    try:
        _, video_url = await storage.save_video(
            project_id, filename, content, max_bytes=_MAX_UPLOAD_BYTES
        )
    except storage.UploadTooLarge as exc:
        raise DomainValidationError(
            [
                ErrorDetail(
                    field="file",
                    issue=f"file exceeds the {exc.max_bytes} byte limit",
                )
            ]
        ) from exc
    model = await project_repo.create(
        session,
        project_id=project_id,
        owner_id=owner_id,
        name=name or filename,
        video_url=video_url,
        language=language,
    )
    # CaptionStyleSpec is initialized immediately, using the default preset
    # (contract §4) — style doesn't depend on transcription (arch §6).
    await style_service.create_default_style(
        session, project_id=project_id, owner_id=owner_id
    )
    return await _to_schema(session, model)


async def get_project(session: AsyncSession, project_id: uuid.UUID) -> Project | None:
    model = await project_repo.get(session, project_id)
    return await _to_schema(session, model) if model else None


async def open_project(session: AsyncSession, project_id: uuid.UUID) -> bool:
    """Records that the project was opened (D13) — a separate call from
    `GET /projects/{id}`, deliberately: a `GET` must stay side-effect-free
    so it can be cached later without silently breaking this tracking."""
    return await project_repo.touch_last_opened_at(session, project_id)


async def list_projects(
    session: AsyncSession,
    *,
    owner_id: uuid.UUID,
    limit: int = DEFAULT_PAGE_LIMIT,
    offset: int = 0,
    q: str | None = None,
    sort: ProjectSort = ProjectSort.newest,
) -> ProjectPage:
    """`limit`/`offset` are clamped, not rejected (contract §4): an
    out-of-range page size is a client bug that shouldn't cost the user an
    error screen, and the cap is what stops `limit=999999` from turning a
    paginated endpoint back into "fetch everything". Clamping lives here
    rather than as a FastAPI `le=` constraint precisely because `le=` would
    422 instead.

    Scoped to `owner_id`: each user's "My projects" is genuinely theirs now
    that real per-user identity exists, not the single shared placeholder
    every project used to carry.
    """
    limit = max(1, min(limit, MAX_PAGE_LIMIT))
    offset = max(0, offset)
    models, total = await project_repo.list_page(
        session, owner_id=owner_id, limit=limit, offset=offset, q=q, sort=sort
    )
    return ProjectPage(
        items=[await _to_schema(session, m) for m in models], total=total
    )


class ProjectHasActiveTranscribeJob(Exception):
    """Raised when a transcribe job is still `queued`/`processing` (contract
    §4). Unlike export, transcribe has no OS process this codebase tracks a
    pid for to signal (WhisperX runs in-process, not as a killable
    subprocess) - confirmed with the human: `DELETE` simply refuses rather
    than inventing a new, weaker "soft cancel" concept for this one case.
    The caller (route) turns this into 409."""


async def delete_project(session: AsyncSession, project_id: uuid.UUID) -> bool:
    """`False` (→ 404) if the project doesn't exist. Hard delete, no trash,
    no soft-delete flag - by design, and this stays true even once auth
    exists (X8), not a placeholder pending it.

    Cascades: cancels an active export first (reusing the real `POST
    .../cancel` mechanism, P8/X7), then deletes every child row before the
    `Project` row itself (none of the foreign keys are `ON DELETE CASCADE`
    - see each repository's own `delete_by_project`), then the whole
    storage directory in one recursive delete.

    Known, accepted race: `cancel_export` only *signals* the still-running
    export task - it doesn't wait for that task to actually observe the
    signal and reach its own cleanup. If this function's own deletes win
    that race, the task's later `job_repo.update_status` call raises
    `ValueError` (job row gone), which Celery logs as a failed task. Never
    user-visible (nothing will ever query this project again) - not worth
    a synchronous wait/poll to close a window this narrow."""
    project = await project_repo.get(session, project_id)
    if project is None:
        return False

    latest_transcribe = await job_repo.get_latest_by_project(
        session, project_id, JobType.transcribe
    )
    if latest_transcribe is not None and latest_transcribe.status in (
        JobStatus.queued,
        JobStatus.processing,
    ):
        raise ProjectHasActiveTranscribeJob()

    latest_export = await job_repo.get_latest_by_project(
        session, project_id, JobType.export
    )
    if latest_export is not None and latest_export.status in (
        JobStatus.queued,
        JobStatus.processing,
    ):
        await export_service.cancel_export(session, project_id, latest_export.id)

    await job_repo.delete_by_project(session, project_id)
    await ecs_repo.delete_by_project(session, project_id)
    await style_repo.delete_by_project(session, project_id)
    await raw_transcript_repo.delete_by_project(session, project_id)
    await project_repo.delete(session, project_id)

    await storage.delete_project_files(project_id)
    return True
