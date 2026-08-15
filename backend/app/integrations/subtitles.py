r"""SRT generation and the style cascade (arch §2.5, contract §12).

Pure functions — no ffmpeg, disk, or DB access here (same testability shape
as `app/services/splitter.py`/`ecs_validation.py`).

**This module used to also generate ASS** for a libass burn-in pass. That is
gone (INVARIANTS P9/X3): burn-in now renders the frontend's own
`CaptionOverlay` headless and composites the resulting frames, so nothing in
the backend describes how a caption *looks* anymore. Every visual assumption
this module used to carry — the vertical anchor, the alpha convention, the
outline/shadow size-to-pixel mapping, glow-as-edge-blur, a made-up
horizontal margin, and the fact that `captionAnimation` had no ASS
equivalent at all — went with it. Those were exactly the places preview and
export could disagree.

What remains is text-level only, and stays here because SRT genuinely needs
it: SRT is a text format, unaffected by how captions are drawn.

`showPunctuation` (INVARIANTS S7) is applied *before* `textTransform` -
order is arbitrary (case doesn't interact with punctuation chars) but must
be fixed to one order, stated here rather than left to whichever function
happens to call them first. `Word.text` itself is never mutated (S1) -
stripping happens only in the strings this module builds for SRT output.
"""

import re
from dataclasses import dataclass

from app.schemas.ecs import ECS, Segment
from app.schemas.preset import Preset
from app.schemas.style import (
    CaptionAnimation,
    CaptionStyleSpec,
    OutlineOrShadow,
    RevealMode,
    StyleOverrides,
    TextTransform,
)

# ---------------------------------------------------------------------------
# SRT (X2: word-level timing is lost, known and accepted - one cue/segment)
# ---------------------------------------------------------------------------


def _srt_timestamp(seconds: float) -> str:
    total_ms = round(seconds * 1000)
    hours, rem_ms = divmod(total_ms, 3_600_000)
    minutes, rem_ms = divmod(rem_ms, 60_000)
    secs, ms = divmod(rem_ms, 1_000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{ms:03d}"


def generate_srt(ecs: ECS, style: CaptionStyleSpec, preset: Preset) -> str:
    """One cue per segment, in `segments[]` array order (D7 - authored
    order, not re-sorted by time). Segment bounds are derived (D5):
    `words[0].start`/`words[-1].end`, never a stored field. Cue numbers
    are sequential over non-empty segments only - an empty segment (V5
    should already prevent one reaching here, this is just defensive)
    doesn't leave a gap in the numbering. `style`/`preset` are needed
    only to resolve `showPunctuation` (S7) per segment - SRT has no
    concept of the rest of the style cascade."""
    lines: list[str] = []
    index = 1
    for segment in ecs.segments:
        if not segment.words:
            continue
        effective = resolve_effective_style(preset, style, segment)
        start = segment.words[0].start
        end = segment.words[-1].end
        words_text = [_display_text(w.text, effective) for w in segment.words]
        text = " ".join(t for t in words_text if t)
        lines.append(str(index))
        lines.append(f"{_srt_timestamp(start)} --> {_srt_timestamp(end)}")
        lines.append(text)
        lines.append("")
        index += 1
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Effective style resolution (three-layer cascade)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class EffectiveStyle:
    """`PresetBase`'s fields, fully resolved for one segment - the sparse
    `StyleOverrides` cascade collapsed into concrete values. A dataclass
    rather than reusing `PresetBase` directly: `safeArea` is flattened to
    two fields so `_merge` can replace it as one unit without reaching into
    a nested model."""

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
    safeArea_top: float
    safeArea_bottom: float


def _merge(effective: EffectiveStyle, overrides: StyleOverrides) -> EffectiveStyle:
    """Each set field in `overrides` replaces the corresponding field in
    `effective` wholesale - `outline`/`shadow`/`safeArea` are whole-object
    replacements (matching how they're validated as a unit, not
    field-by-field), not deep-merged."""
    updates: dict[str, object] = {}
    if overrides.fontSize is not None:
        updates["fontSize"] = overrides.fontSize
    if overrides.fontFamily is not None:
        updates["fontFamily"] = overrides.fontFamily
    if overrides.fontWeight is not None:
        updates["fontWeight"] = overrides.fontWeight
    if overrides.color is not None:
        updates["color"] = overrides.color
    if overrides.highlightColors is not None:
        updates["highlightColors"] = overrides.highlightColors
    if overrides.textTransform is not None:
        updates["textTransform"] = overrides.textTransform
    if overrides.italic is not None:
        updates["italic"] = overrides.italic
    if overrides.glow is not None:
        updates["glow"] = overrides.glow
    if overrides.outline is not None:
        updates["outline"] = overrides.outline
    if overrides.shadow is not None:
        updates["shadow"] = overrides.shadow
    if overrides.showPunctuation is not None:
        updates["showPunctuation"] = overrides.showPunctuation
    if overrides.revealMode is not None:
        updates["revealMode"] = overrides.revealMode
    if overrides.captionAnimation is not None:
        updates["captionAnimation"] = overrides.captionAnimation
    if overrides.verticalPosition is not None:
        updates["verticalPosition"] = overrides.verticalPosition
    if overrides.safeArea is not None:
        updates["safeArea_top"] = overrides.safeArea.top
        updates["safeArea_bottom"] = overrides.safeArea.bottom
    if not updates:
        return effective
    return EffectiveStyle(**{**effective.__dict__, **updates})


def resolve_effective_style(
    preset: Preset, style: CaptionStyleSpec, segment: Segment
) -> EffectiveStyle:
    """`preset.base` -> `style.overrides` -> (only if `perPhraseStyle`)
    `segment.overrides` (arch §4.2's per-segment style override, D11)."""
    base = preset.base
    effective = EffectiveStyle(
        fontSize=base.fontSize,
        fontFamily=base.fontFamily,
        fontWeight=base.fontWeight,
        color=base.color,
        highlightColors=base.highlightColors,
        textTransform=base.textTransform,
        italic=base.italic,
        glow=base.glow,
        outline=base.outline,
        shadow=base.shadow,
        showPunctuation=base.showPunctuation,
        revealMode=base.revealMode,
        captionAnimation=base.captionAnimation,
        verticalPosition=base.verticalPosition,
        safeArea_top=base.safeArea.top,
        safeArea_bottom=base.safeArea.bottom,
    )
    effective = _merge(effective, style.overrides)
    if style.perPhraseStyle and segment.overrides is not None:
        effective = _merge(effective, segment.overrides)
    return effective


def _apply_text_transform(text: str, transform: TextTransform) -> str:
    return text.upper() if transform is TextTransform.uppercase else text


# INVARIANTS S7's exact strip rule. Ellipsis runs (`..`/`...`) collapse to
# nothing character-by-character here, same end result as removing them as
# a unit - not replaced with a pause. An ASCII hyphen is kept only between
# two word characters (compound words); an em/en dash is always sentence
# punctuation, never a word-joiner, so it's stripped unconditionally.
_STANDALONE_HYPHEN_RE = re.compile(r"(?<!\w)-|-(?!\w)")
_SENTENCE_PUNCTUATION_RE = re.compile(r"[.,!?;:—–]")


def _strip_punctuation(text: str) -> str:
    text = _STANDALONE_HYPHEN_RE.sub("", text)
    text = _SENTENCE_PUNCTUATION_RE.sub("", text)
    return text


def _display_text(text: str, effective: EffectiveStyle) -> str:
    """`showPunctuation` applied before `textTransform` (module docstring) -
    the one shared place both `generate_srt` and `generate_ass` route
    through, so the order can't drift between the two."""
    if not effective.showPunctuation:
        text = _strip_punctuation(text)
    return _apply_text_transform(text, effective.textTransform)
