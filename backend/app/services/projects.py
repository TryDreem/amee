import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.constants import PLACEHOLDER_OWNER_ID
from app.integrations import storage
from app.models.project import ProjectModel
from app.repositories import job as job_repo
from app.repositories import project as project_repo
from app.schemas.job import JobType
from app.schemas.project import Project


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
        thumbnail_url=model.thumbnail_url,
        preview_video_url=model.preview_video_url,
        video_width=model.video_width,
        video_height=model.video_height,
        video_duration_seconds=model.video_duration_seconds,
        created_at=model.created_at,
        latest_transcribe_job_id=latest_transcribe_job.id
        if latest_transcribe_job
        else None,
        export_job_ids=[],
    )


async def create_project(
    session: AsyncSession, *, name: str | None, filename: str, content: bytes
) -> Project:
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
    )
    return await _to_schema(session, model)


async def get_project(session: AsyncSession, project_id: uuid.UUID) -> Project | None:
    model = await project_repo.get(session, project_id)
    return await _to_schema(session, model) if model else None


async def list_projects(session: AsyncSession) -> list[Project]:
    models = await project_repo.list_all(session)
    return [await _to_schema(session, m) for m in models]
