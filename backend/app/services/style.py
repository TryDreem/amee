import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories import preset as preset_repo
from app.repositories import style as style_repo


async def create_default_style(
    session: AsyncSession, *, project_id: uuid.UUID, owner_id: uuid.UUID
) -> None:
    """Initializes a new project's `CaptionStyleSpec` immediately, using the
    preset flagged `default: true` (contract §4, §9) — style doesn't depend
    on transcription (arch §6), so this runs at upload time, not inside the
    transcribe job."""
    default_preset = await preset_repo.get_default(session)
    if default_preset is None:
        raise ValueError("no default preset seeded")
    await style_repo.create(
        session,
        project_id=project_id,
        owner_id=owner_id,
        preset_id=default_preset.id,
        overrides={},
    )
