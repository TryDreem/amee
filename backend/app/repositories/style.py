import uuid

from sqlalchemy import delete
from sqlalchemy import update as sa_update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.style import CaptionStyleSpecModel


async def create(
    session: AsyncSession,
    *,
    project_id: uuid.UUID,
    owner_id: uuid.UUID,
    preset_id: uuid.UUID,
    per_phrase_style: bool,
    overrides: dict[str, object],
) -> CaptionStyleSpecModel:
    style = CaptionStyleSpecModel(
        project_id=project_id,
        owner_id=owner_id,
        preset_id=preset_id,
        per_phrase_style=per_phrase_style,
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


async def update(
    session: AsyncSession,
    project_id: uuid.UUID,
    *,
    preset_id: uuid.UUID,
    per_phrase_style: bool,
    overrides: dict[str, object],
) -> CaptionStyleSpecModel:
    """Whole-document replace (D8) — `PUT /style` sends the full object,
    there's no partial-field update path."""
    style = await session.get(CaptionStyleSpecModel, project_id)
    if style is None:
        raise ValueError(f"style for project {project_id} not found")
    style.preset_id = preset_id
    style.per_phrase_style = per_phrase_style
    style.overrides = overrides
    await session.commit()
    await session.refresh(style)
    return style


async def delete_by_project(session: AsyncSession, project_id: uuid.UUID) -> None:
    """Used by `DELETE /projects/{id}` (contract §4, X8) - `project_id` is
    the primary key here (one-to-one with `Project`), but the FK still has
    no `ON DELETE CASCADE`, so this has to run before the `Project` row."""
    await session.execute(
        delete(CaptionStyleSpecModel).where(
            CaptionStyleSpecModel.project_id == project_id
        )
    )
    await session.commit()


async def reassign_owner(
    session: AsyncSession, *, from_owner_id: uuid.UUID, to_owner_id: uuid.UUID
) -> None:
    """Guest-to-Google merge; see `app/repositories/project.py::reassign_owner`."""
    await session.execute(
        sa_update(CaptionStyleSpecModel)
        .where(CaptionStyleSpecModel.owner_id == from_owner_id)
        .values(owner_id=to_owner_id)
    )
    await session.commit()
