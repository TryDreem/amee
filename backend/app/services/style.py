import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.exceptions import DomainValidationError
from app.models.style import CaptionStyleSpecModel
from app.repositories import preset as preset_repo
from app.repositories import project as project_repo
from app.repositories import style as style_repo
from app.schemas.common import ErrorDetail
from app.schemas.preset import PresetBounds
from app.schemas.style import CaptionStyleSpec, CaptionStyleSpecPutBody, StyleOverrides
from app.services.style_validation import validate_overrides


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
        per_phrase_style=False,
        overrides={},
    )


def _to_schema(model: CaptionStyleSpecModel) -> CaptionStyleSpec:
    return CaptionStyleSpec(
        project_id=model.project_id,
        owner_id=model.owner_id,
        presetId=model.preset_id,
        perPhraseStyle=model.per_phrase_style,
        overrides=StyleOverrides.model_validate(model.overrides),
    )


async def get_style(
    session: AsyncSession, project_id: uuid.UUID
) -> CaptionStyleSpec | None:
    model = await style_repo.get(session, project_id)
    return _to_schema(model) if model else None


async def put_style(
    session: AsyncSession, project_id: uuid.UUID, body: CaptionStyleSpecPutBody
) -> CaptionStyleSpec | None:
    existing = await style_repo.get(session, project_id)
    if existing is None:
        # Style is created eagerly at upload (contract §4) - a missing row
        # means the project itself doesn't exist, not a missing style.
        return None

    preset = await preset_repo.get(session, body.presetId)
    if preset is None:
        raise DomainValidationError(
            [ErrorDetail(field="presetId", issue="preset not found")]
        )

    bounds = PresetBounds.model_validate(preset.bounds)
    details = validate_overrides(body.overrides, bounds)
    if details:
        raise DomainValidationError(details)

    updated = await style_repo.update(
        session,
        project_id,
        preset_id=body.presetId,
        per_phrase_style=body.perPhraseStyle,
        overrides=body.overrides.model_dump(exclude_none=True),
    )
    # D12: only the real PUT /style counts as an edit for sort=updated -
    # export.py's side-effect persistence calls style_repo.update() directly.
    await project_repo.touch_updated_at(session, project_id)
    return _to_schema(updated)
