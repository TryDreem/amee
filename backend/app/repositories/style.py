import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.style import CaptionStyleSpecModel


async def create(
    session: AsyncSession,
    *,
    project_id: uuid.UUID,
    owner_id: uuid.UUID,
    preset_id: uuid.UUID,
    overrides: dict[str, object],
) -> CaptionStyleSpecModel:
    style = CaptionStyleSpecModel(
        project_id=project_id,
        owner_id=owner_id,
        preset_id=preset_id,
        overrides=overrides,
    )
    session.add(style)
    await session.commit()
    await session.refresh(style)
    return style


async def get(
    session: AsyncSession, project_id: uuid.UUID
) -> CaptionStyleSpecModel | None:
    return await session.get(CaptionStyleSpecModel, project_id)
