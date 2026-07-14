import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project import ProjectModel


async def create(
    session: AsyncSession,
    *,
    owner_id: uuid.UUID,
    name: str,
    video_url: str,
    project_id: uuid.UUID | None = None,
) -> ProjectModel:
    """`project_id` is optional: the column defaults to a fresh uuid4 if
    omitted (used by repository-level tests), but the service layer mints one
    up front — it needs the id before this call, to namespace the uploaded
    file on disk (app/services/projects.py). No video_width/height/duration
    here — POST /projects only saves the file (arch §2.8); those, plus
    thumbnail_url/preview_video_url, are written later by update_media/
    update_preview once the transcribe job's branches finish."""
    project = ProjectModel(owner_id=owner_id, name=name, video_url=video_url)
    if project_id is not None:
        project.id = project_id
    session.add(project)
    await session.commit()
    await session.refresh(project)
    return project


async def get(session: AsyncSession, project_id: uuid.UUID) -> ProjectModel | None:
    return await session.get(ProjectModel, project_id)


async def list_all(session: AsyncSession) -> list[ProjectModel]:
    result = await session.execute(
        select(ProjectModel).order_by(ProjectModel.created_at)
    )
    return list(result.scalars().all())


async def update_media(
    session: AsyncSession,
    project_id: uuid.UUID,
    *,
    width: int,
    height: int,
    duration_seconds: float,
    thumbnail_url: str,
) -> ProjectModel:
    """Written by the transcribe job's probe-and-thumbnail branch (arch
    §2.8b-c) once it finishes — not at upload time."""
    project = await session.get(ProjectModel, project_id)
    if project is None:
        raise ValueError(f"project {project_id} not found")
    project.video_width = width
    project.video_height = height
    project.video_duration_seconds = duration_seconds
    project.thumbnail_url = thumbnail_url
    await session.commit()
    await session.refresh(project)
    return project


async def update_preview(
    session: AsyncSession, project_id: uuid.UUID, *, preview_video_url: str
) -> ProjectModel:
    """Written by the transcribe job's conditional preview-proxy branch
    (arch §2.8d) — `preview_video_url` is either the proxy's own URL or, if
    no proxy was needed, the same value as `video_url`."""
    project = await session.get(ProjectModel, project_id)
    if project is None:
        raise ValueError(f"project {project_id} not found")
    project.preview_video_url = preview_video_url
    await session.commit()
    await session.refresh(project)
    return project
