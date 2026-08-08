import uuid
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from app.constants import PLACEHOLDER_OWNER_ID
from app.exceptions import DomainValidationError
from app.integrations import storage
from app.models.project import ProjectModel
from app.repositories import job as job_repo
from app.repositories import project as project_repo
from app.schemas.common import ErrorDetail
from app.schemas.job import JobType
from app.schemas.project import Project
from app.services import style as style_service
from app.services.language import SUPPORTED_LANGUAGE_CODES

# Upload limits from arch §2.7 / contract §4. Only the two checks that need
# no ffmpeg probe are enforced here — §2.8 is explicit that upload "does
# exactly one thing: stores the file", so codec/resolution (which require
# probing) can't be checked on the request path; those failures surface in
# the transcribe job instead.
_ALLOWED_UPLOAD_EXTENSIONS = {".mp4", ".mov"}
_MAX_UPLOAD_BYTES = 2 * 1024**3  # 2GB


async def _to_schema(session: AsyncSession, model: ProjectModel) -> Project:
    # export_job_ids stays [] — export jobs are M2 scope, no repository query
    # for them exists yet.
    latest_transcribe_job = await job_repo.get_latest_by_project(
        session, model.id, JobType.transcribe
    )
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
        export_job_ids=[],
    )


async def create_project(
    session: AsyncSession,
    *,
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
        owner_id=PLACEHOLDER_OWNER_ID,
        name=name or filename,
        video_url=video_url,
        language=language,
    )
    # CaptionStyleSpec is initialized immediately, using the default preset
    # (contract §4) — style doesn't depend on transcription (arch §6).
    await style_service.create_default_style(
        session, project_id=project_id, owner_id=PLACEHOLDER_OWNER_ID
    )
    return await _to_schema(session, model)


async def get_project(session: AsyncSession, project_id: uuid.UUID) -> Project | None:
    model = await project_repo.get(session, project_id)
    return await _to_schema(session, model) if model else None


async def list_projects(session: AsyncSession) -> list[Project]:
    models = await project_repo.list_all(session)
    return [await _to_schema(session, m) for m in models]
