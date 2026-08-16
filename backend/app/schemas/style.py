from enum import Enum
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class RevealMode(str, Enum):
    phrase = "phrase"
    progressive = "progressive"
    single_word = "single-word"


class CaptionAnimation(str, Enum):
    """Cosmetic entrance transition, orthogonal to `RevealMode` - which
    word(s) exist vs. how the segment transitions on screen (INVARIANTS
    S8). No bounds check, same treatment as `textTransform`/`italic`/
    `glow`.

    The first six are the original set (design ANIMATIONS_D). The rest
    (contract §8) group into: finer fade/slide/zoom variants, rotation/3D,
    spring/impact, clip-path reveals, `neonGlow`, character/word-level
    reveals (`typewriter`/`letterCascade`), and word-highlight karaoke
    modes (`karaokeFill`/`karaokeBox` - the only two that change how a
    word's own highlight is drawn, not just how the block enters)."""

    none = "none"
    fade = "fade"
    pop = "pop"
    bounce = "bounce"
    blur = "blur"
    snap = "snap"
    fade_simple = "fadeSimple"
    fade_scale = "fadeScale"
    fade_blur = "fadeBlur"
    slide_up = "slideUp"
    slide_down = "slideDown"
    slide_left = "slideLeft"
    slide_right = "slideRight"
    zoom_out = "zoomOut"
    rotate_in = "rotateIn"
    tilt_in = "tiltIn"
    swing_pendulum = "swingPendulum"
    spring_elastic = "springElastic"
    jelly_squash = "jellySquash"
    flip_x = "flipX"
    flip_y = "flipY"
    perspective_drop = "perspectiveDrop"
    wipe_reveal = "wipeReveal"
    circle_reveal = "circleReveal"
    curtain_reveal = "curtainReveal"
    punch_in = "punchIn"
    shake_settle = "shakeSettle"
    neon_glow = "neonGlow"
    typewriter = "typewriter"
    letter_cascade = "letterCascade"
    karaoke_fill = "karaokeFill"
    karaoke_box = "karaokeBox"


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
    captionAnimation: CaptionAnimation | None = None
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
