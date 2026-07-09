from uuid import UUID

from pydantic import BaseModel

from app.schemas.style import RevealMode, SafeArea


class Bounds(BaseModel):
    min: float
    max: float


class SafeAreaBounds(BaseModel):
    top: Bounds
    bottom: Bounds


class PresetBounds(BaseModel):
    fontSize: Bounds
    verticalPosition: Bounds
    safeArea: SafeAreaBounds


class PresetBase(BaseModel):
    fontSize: float
    fontFamily: str
    fontWeight: int | str
    color: str
    highlightColor: str
    revealMode: RevealMode
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
