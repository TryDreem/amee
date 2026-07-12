import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.constants import PLACEHOLDER_OWNER_ID
from app.integrations import storage
from app.integrations.ffmpeg import probe_video
from app.models.project import ProjectModel
from app.repositories import project as project_repo
from app.schemas.project import Project


def _to_schema(model: ProjectModel) -> Project:
    return Project(
        id=model.id,
        owner_id=model.owner_id,
        name=model.name,
        video_url=model.video_url,
        video_width=model.video_width,
        video_height=model.video_height,
        video_duration_seconds=model.video_duration_seconds,
        created_at=model.created_at,
        # No Job table until M1 step 4 — a project fresh off upload has no
        # jobs yet either way, so this isn't a stand-in for a real query.
        latest_transcribe_job_id=None,
        export_job_ids=[],
    )


async def create_project(
    session: AsyncSession, *, name: str | None, filename: str, content: bytes
) -> Project:
    # Minted here, not by the DB default: storage needs the id up front to
    # namespace the file, and the row can't be created before the probe
    # gives us the not-null width/height/duration columns.
    project_id = uuid.uuid4()
    path, video_url = storage.save_video(project_id, filename, content)
    probe = await probe_video(path)
    model = await project_repo.create(
        session,
        project_id=project_id,
        owner_id=PLACEHOLDER_OWNER_ID,
        name=name or filename,
        video_url=video_url,
        video_width=probe.width,
        video_height=probe.height,
        video_duration_seconds=probe.duration_seconds,
    )
    return _to_schema(model)


async def get_project(session: AsyncSession, project_id: uuid.UUID) -> Project | None:
    model = await project_repo.get(session, project_id)
    return _to_schema(model) if model else None


async def list_projects(session: AsyncSession) -> list[Project]:
    models = await project_repo.list_all(session)
    return [_to_schema(m) for m in models]
