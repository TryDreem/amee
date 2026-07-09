from enum import Enum
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class RevealMode(str, Enum):
    phrase = "phrase"
    progressive = "progressive"


class SafeArea(BaseModel):
    top: float
    bottom: float


class StyleOverrides(BaseModel):
    """Sparse by design — only fields that differ from the preset's base values
    need to be present (contract §8). No `horizontalAlign` (INVARIANTS L5)."""

    model_config = ConfigDict(extra="forbid")

    fontSize: float | None = None
    fontFamily: str | None = None
    fontWeight: int | str | None = None
    color: str | None = None
    highlightColor: str | None = None
    revealMode: RevealMode | None = None
    verticalPosition: float | None = None
    safeArea: SafeArea | None = None


class CaptionStyleSpec(BaseModel):
    project_id: UUID
    owner_id: UUID
    presetId: UUID
    overrides: StyleOverrides = StyleOverrides()


class CaptionStyleSpecPutBody(BaseModel):
    """Same shape as CaptionStyleSpec minus project_id/owner_id (contract §8)."""

    model_config = ConfigDict(extra="forbid")

    presetId: UUID
    overrides: StyleOverrides = StyleOverrides()
