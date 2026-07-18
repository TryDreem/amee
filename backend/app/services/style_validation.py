from app.schemas.common import ErrorDetail
from app.schemas.preset import Bounds, PresetBounds
from app.schemas.style import OutlineOrShadow, StyleOverrides

# outline.alpha/shadow.alpha validate against a fixed range, not per-preset
# bounds (INVARIANTS S6) - unlike fontSize/verticalPosition/safeArea (L8).
_ALPHA_MIN = 0.0
_ALPHA_MAX = 100.0


def _check_bound(field: str, value: float | None, bound: Bounds) -> ErrorDetail | None:
    if value is None:
        return None
    if value < bound.min or value > bound.max:
        return ErrorDetail(
            field=field,
            issue=f"must be between {bound.min} and {bound.max}, got {value}",
        )
    return None


def _check_alpha(field: str, value: OutlineOrShadow | None) -> ErrorDetail | None:
    if value is None:
        return None
    if value.alpha < _ALPHA_MIN or value.alpha > _ALPHA_MAX:
        return ErrorDetail(
            field=f"{field}.alpha",
            issue=f"must be between {_ALPHA_MIN} and {_ALPHA_MAX}, got {value.alpha}",
        )
    return None


def validate_overrides(
    overrides: StyleOverrides, bounds: PresetBounds, *, prefix: str = "overrides"
) -> list[ErrorDetail]:
    """L8/V8/S6 (INVARIANTS): `fontSize`/`verticalPosition`/`safeArea` are
    validated against the *resolved* preset's bounds; `outline.alpha`/
    `shadow.alpha` against a fixed 0-100 range instead. `textTransform`,
    `italic`, `glow`, `outline.size`, `shadow.size` have no bounds check at
    all — any value from the type is valid.

    Shared by both `CaptionStyleSpec.overrides` (`PUT /style`) and
    `Segment.overrides` (`PUT /ecs`, D11/V8) via the `prefix` parameter, so
    there's one bounds-checking implementation, not two that can drift."""
    details = [
        d
        for d in (
            _check_bound(f"{prefix}.fontSize", overrides.fontSize, bounds.fontSize),
            _check_bound(
                f"{prefix}.verticalPosition",
                overrides.verticalPosition,
                bounds.verticalPosition,
            ),
            _check_alpha(f"{prefix}.outline", overrides.outline),
            _check_alpha(f"{prefix}.shadow", overrides.shadow),
        )
        if d is not None
    ]
    if overrides.safeArea is not None:
        details += [
            d
            for d in (
                _check_bound(
                    f"{prefix}.safeArea.top",
                    overrides.safeArea.top,
                    bounds.safeArea.top,
                ),
                _check_bound(
                    f"{prefix}.safeArea.bottom",
                    overrides.safeArea.bottom,
                    bounds.safeArea.bottom,
                ),
            )
            if d is not None
        ]
    return details
