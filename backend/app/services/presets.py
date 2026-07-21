import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.preset import PresetModel
from app.repositories import preset as preset_repo
from app.schemas.preset import Preset


def _to_schema(model: PresetModel) -> Preset:
    # Pydantic coerces the JSONB dicts into PresetBase/PresetBounds itself —
    # no manual field-by-field mapping needed.
    return Preset(
        id=model.id,
        name=model.name,
        default=model.default,
        base=model.base,  # type: ignore[arg-type]
        bounds=model.bounds,  # type: ignore[arg-type]
    )


async def list_presets(session: AsyncSession) -> list[Preset]:
    models = await preset_repo.list_all(session)
    return [_to_schema(m) for m in models]


async def get_preset(session: AsyncSession, preset_id: uuid.UUID) -> Preset | None:
    model = await preset_repo.get(session, preset_id)
    return _to_schema(model) if model else None
