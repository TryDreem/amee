from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.preset import PresetModel

# Read-only: presets have no create/update endpoint (contract §9). New
# presets land via an Alembic migration, not a repository write.


async def list_all(session: AsyncSession) -> list[PresetModel]:
    result = await session.execute(select(PresetModel).order_by(PresetModel.name))
    return list(result.scalars().all())


async def get_default(session: AsyncSession) -> PresetModel | None:
    """Used to initialize a new project's style (contract §4) — exactly one
    preset is expected to have `default: true` (contract §9)."""
    result = await session.execute(
        select(PresetModel).where(PresetModel.default.is_(True)).limit(1)
    )
    return result.scalars().first()
