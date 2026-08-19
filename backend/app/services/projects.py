import uuid
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
from app.schemas.job import JobStatus, JobType
from app.schemas.project import Project, ProjectPage, ProjectSort
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
    latest_export_url = None
    if (
        latest_export_job is not None
        and latest_export_job.status == JobStatus.done
        and latest_export_job.result is not None
    ):
        latest_export_url = latest_export_job.result.get("video_url")

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


async def create_project(
    session: AsyncSession,
    *,
    owner_id: uuid.UUID,
    name: str | None,
    filename: str,
    content: bytes,
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
    if len(content) > _MAX_UPLOAD_BYTES:
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
    _, video_url = storage.save_video(project_id, filename, content)
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

    storage.delete_project_files(project_id)
    return True
