import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.exceptions import DomainValidationError
from app.models.style import CaptionStyleSpecModel
from app.repositories import preset as preset_repo
from app.repositories import style as style_repo
from app.schemas.common import ErrorDetail
from app.schemas.preset import Bounds, PresetBounds
from app.schemas.style import CaptionStyleSpec, CaptionStyleSpecPutBody, StyleOverrides


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


def _to_schema(model: CaptionStyleSpecModel) -> CaptionStyleSpec:
    return CaptionStyleSpec(
        project_id=model.project_id,
        owner_id=model.owner_id,
        presetId=model.preset_id,
        overrides=StyleOverrides.model_validate(model.overrides),
    )


def _check_bound(field: str, value: float | None, bound: Bounds) -> ErrorDetail | None:
    if value is None:
        return None
    if value < bound.min or value > bound.max:
        return ErrorDetail(
            field=field,
            issue=f"must be between {bound.min} and {bound.max}, got {value}",
        )
    return None


def _validate_overrides(
    overrides: StyleOverrides, bounds: PresetBounds
) -> list[ErrorDetail]:
    """L8 (INVARIANTS): bounds live per-preset, not globally — validated
    against the *resolved* preset's bounds, not a hardcoded range."""
    details = [
        d
        for d in (
            _check_bound("overrides.fontSize", overrides.fontSize, bounds.fontSize),
            _check_bound(
                "overrides.verticalPosition",
                overrides.verticalPosition,
                bounds.verticalPosition,
            ),
        )
        if d is not None
    ]
    if overrides.safeArea is not None:
        details += [
            d
            for d in (
                _check_bound(
                    "overrides.safeArea.top",
                    overrides.safeArea.top,
                    bounds.safeArea.top,
                ),
                _check_bound(
                    "overrides.safeArea.bottom",
                    overrides.safeArea.bottom,
                    bounds.safeArea.bottom,
                ),
            )
            if d is not None
        ]
    return details


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
    details = _validate_overrides(body.overrides, bounds)
    if details:
        raise DomainValidationError(details)

    updated = await style_repo.update(
        session,
        project_id,
        preset_id=body.presetId,
        overrides=body.overrides.model_dump(exclude_none=True),
    )
    return _to_schema(updated)
