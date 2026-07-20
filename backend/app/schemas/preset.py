from uuid import UUID

from pydantic import BaseModel

from app.schemas.style import (
    CaptionAnimation,
    OutlineOrShadow,
    RevealMode,
    SafeArea,
    TextTransform,
)


class Bounds(BaseModel):
    min: float
    max: float


class SafeAreaBounds(BaseModel):
    top: Bounds
    bottom: Bounds


class PresetBounds(BaseModel):
    """No entry for outline/shadow/glow/textTransform — they have no
    per-preset bounds at all (INVARIANTS S6, arch §10)."""

    fontSize: Bounds
    verticalPosition: Bounds
    safeArea: SafeAreaBounds


class PresetBase(BaseModel):
    """Always fully populated, unlike StyleOverrides — a preset defines a
    complete style, not a sparse delta."""

    fontSize: float
    fontFamily: str
    fontWeight: int | str
    color: str
    highlightColors: list[str]
    textTransform: TextTransform
    italic: bool
    glow: bool
    outline: OutlineOrShadow | None
    shadow: OutlineOrShadow | None
    showPunctuation: bool
    revealMode: RevealMode
    captionAnimation: CaptionAnimation
    verticalPosition: float
    safeArea: SafeArea


class Preset(BaseModel):
    """No owner_id — presets are shared system templates, not user content
    (contract §1, §9)."""

    id: UUID
    name: str
    default: bool
    base: PresetBase
    bounds: PresetBounds
