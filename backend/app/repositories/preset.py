from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.preset import PresetModel

# Read-only: presets have no create/update endpoint (contract §9). New
# presets land via an Alembic migration, not a repository write.


async def list_all(session: AsyncSession) -> list[PresetModel]:
    result = await session.execute(select(PresetModel).order_by(PresetModel.name))
    return list(result.scalars().all())
