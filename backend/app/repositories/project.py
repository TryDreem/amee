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
    video_width: int,
    video_height: int,
    video_duration_seconds: float,
) -> ProjectModel:
    project = ProjectModel(
        owner_id=owner_id,
        name=name,
        video_url=video_url,
        video_width=video_width,
        video_height=video_height,
        video_duration_seconds=video_duration_seconds,
    )
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
