from enum import Enum
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class RevealMode(str, Enum):
    phrase = "phrase"
    progressive = "progressive"


class TextTransform(str, Enum):
    none = "none"
    uppercase = "uppercase"


class OutlineShadowSize(str, Enum):
    none = "none"
    small = "small"
    medium = "medium"
    large = "large"


class SafeArea(BaseModel):
    top: float
    bottom: float


class OutlineOrShadow(BaseModel):
    """Shared shape for `outline`/`shadow` (contract §8). `size` and `color`
    have no bounds check (INVARIANTS S6) — any value from the type is
    valid. `alpha` validates against a fixed 0-100 range, not per-preset
    bounds, unlike fontSize/verticalPosition/safeArea (L8)."""

    size: OutlineShadowSize
    color: str
    alpha: float


class StyleOverrides(BaseModel):
    """Sparse by design — only fields that differ from the preset's base values
    need to be present (contract §8). No `horizontalAlign` (INVARIANTS L5)."""

    model_config = ConfigDict(extra="forbid")

    fontSize: float | None = None
    fontFamily: str | None = None
    fontWeight: int | str | None = None
    color: str | None = None
    highlightColors: list[str] | None = None
    textTransform: TextTransform | None = None
    italic: bool | None = None
    glow: bool | None = None
    outline: OutlineOrShadow | None = None
    shadow: OutlineOrShadow | None = None
    showPunctuation: bool | None = None
    revealMode: RevealMode | None = None
    verticalPosition: float | None = None
    safeArea: SafeArea | None = None


class CaptionStyleSpec(BaseModel):
    project_id: UUID
    owner_id: UUID
    presetId: UUID
    perPhraseStyle: bool = False
    overrides: StyleOverrides = StyleOverrides()


class CaptionStyleSpecPutBody(BaseModel):
    """Same shape as CaptionStyleSpec minus project_id/owner_id (contract §8)."""

    model_config = ConfigDict(extra="forbid")

    presetId: UUID
    perPhraseStyle: bool = False
    overrides: StyleOverrides = StyleOverrides()
