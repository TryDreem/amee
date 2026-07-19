r"""SRT and ASS generation for export (arch §2.5, contract §12).

Pure functions — no ffmpeg, disk, or DB access here (same testability shape
as `app/services/splitter.py`/`ecs_validation.py`). ASS is the libass
intermediate only (INVARIANTS X3): it is never itself an export output,
just the input `ffmpeg.burn_in_captions` (Step 11) feeds to `-vf ass=...`.

**Parity caveat (arch §12, INVARIANTS R3):** preview/export pixel parity is
explicitly *not yet validated* anywhere in this project — no frame-diff
suite exists. This module implements the documented rules (2-line max,
word-only wrap, safe area, center-only horizontal, relative-unit sizing) as
best-effort against libass's own automatic line-breaking (`WrapStyle`), not
as a from-scratch text-measurement engine matching whatever the frontend's
CSS/Canvas preview does pixel-for-pixel. Flagged, not hidden.

A few rendering choices aren't pinned by any doc and are stated here as this
module's own assumptions, not something confirmed elsewhere:
- `verticalPosition` anchors the vertical *center* of the caption block
  (`\an5` + `\pos`), not its top or baseline.
- `alpha` on `outline`/`shadow` follows the common "0 = fully transparent,
  100 = fully opaque" convention (CSS `opacity`-like), inverted internally
  to ASS's `00`-opaque/`FF`-transparent alpha byte.
- `outline`/`shadow` `size` (`none`/`small`/`medium`/`large`) maps to a
  fixed small set of pixel widths — there's no numeric field for this in
  the wire schema to derive from.
- `glow` is approximated via edge blur (`\be1`) — ASS has no native glow.
- No horizontal safe-area *width* field exists in the wire schema (only
  vertical `safeArea.top`/`bottom`, §9.2) — a small fixed side margin is
  used for wrap width instead of a documented value.

`showPunctuation` (INVARIANTS S7) is applied *before* `textTransform` in
both `generate_srt` and `generate_ass` - order is arbitrary (case doesn't
interact with punctuation chars) but must be fixed to one order, stated
here rather than left to whichever function happens to call them first.
`Word.text` itself is never mutated (S1) - stripping happens only in the
strings this module builds for SRT/ASS output.
"""

import re
from dataclasses import dataclass

from app.schemas.ecs import ECS, Segment
from app.schemas.preset import Preset
from app.schemas.style import (
    CaptionStyleSpec,
    OutlineOrShadow,
    OutlineShadowSize,
    RevealMode,
    StyleOverrides,
    TextTransform,
)

_HORIZONTAL_MARGIN_FRACTION = (
    0.05  # see module docstring - no wire-schema field for this
)
_OUTLINE_SIZE_PX = {
    OutlineShadowSize.none: 0,
    OutlineShadowSize.small: 1,
    OutlineShadowSize.medium: 2,
    OutlineShadowSize.large: 4,
}
_BOLD_WEIGHT_THRESHOLD = 700
_ASS_STYLES_FORMAT = (
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, "
    "OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, "
    "ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, "
    "Alignment, MarginL, MarginR, MarginV, Encoding"
)
_ASS_EVENTS_FORMAT = (
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"
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
        verticalPosition=base.verticalPosition,
        safeArea_top=base.safeArea.top,
        safeArea_bottom=base.safeArea.bottom,
    )
    effective = _merge(effective, style.overrides)
    if style.perPhraseStyle and segment.overrides is not None:
        effective = _merge(effective, segment.overrides)
    return effective


# ---------------------------------------------------------------------------
# ASS generation
# ---------------------------------------------------------------------------


def _ass_timestamp(seconds: float) -> str:
    total_cs = round(seconds * 100)
    hours, rem_cs = divmod(total_cs, 360_000)
    minutes, rem_cs = divmod(rem_cs, 6_000)
    secs, cs = divmod(rem_cs, 100)
    return f"{hours:01d}:{minutes:02d}:{secs:02d}.{cs:02d}"


def _hex_to_ass_bgr(hex_color: str) -> str:
    h = hex_color.lstrip("#")
    r, g, b = h[0:2], h[2:4], h[4:6]
    return f"{b}{g}{r}".upper()


def _alpha_to_ass_hex(alpha_percent: float) -> str:
    # 0 = fully transparent, 100 = fully opaque (module docstring) - ASS's
    # alpha byte is inverted: 00 = opaque, FF = transparent.
    clamped = max(0.0, min(100.0, alpha_percent))
    byte = round((100.0 - clamped) / 100.0 * 255)
    return f"{byte:02X}"


def _ass_color(hex_color: str, alpha_percent: float = 100.0) -> str:
    """`&HAABBGGRR&` - the full tag, usable both in a Style line's color
    columns and inside a `\\c`/`\\1c` override tag."""
    return f"&H{_alpha_to_ass_hex(alpha_percent)}{_hex_to_ass_bgr(hex_color)}&"


def _escape_ass_text(text: str) -> str:
    # `{`/`}` delimit override tags - not expected in real captions, but a
    # word literally containing one must not corrupt the event line.
    return text.replace("{", "｛").replace("}", "｝")


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


def _is_bold(font_weight: int | str) -> bool:
    if isinstance(font_weight, int):
        return font_weight >= _BOLD_WEIGHT_THRESHOLD
    return font_weight.lower() in ("bold", "700", "800", "900")


def _style_line(
    name: str, video_width: int, video_height: int, effective: EffectiveStyle
) -> str:
    font_size_px = round(effective.fontSize * video_height)
    outline_px = _OUTLINE_SIZE_PX[effective.outline.size] if effective.outline else 0
    shadow_px = _OUTLINE_SIZE_PX[effective.shadow.size] if effective.shadow else 0
    outline_color = (
        _ass_color(effective.outline.color, effective.outline.alpha)
        if effective.outline
        else _ass_color("#000000", 100.0)
    )
    shadow_color = (
        _ass_color(effective.shadow.color, effective.shadow.alpha)
        if effective.shadow
        else _ass_color("#000000", 100.0)
    )
    margin_h = round(video_width * _HORIZONTAL_MARGIN_FRACTION)
    primary = _ass_color(effective.color)

    return (
        f"Style: {name},"
        f"{effective.fontFamily},{font_size_px},"
        f"{primary},{primary},{outline_color},{shadow_color},"
        f"{1 if _is_bold(effective.fontWeight) else 0},"
        f"{1 if effective.italic else 0},0,0,"
        "100,100,0,0,"
        f"1,{outline_px},{shadow_px},5,"
        f"{margin_h},{margin_h},0,1"
    )


def _dialogue_line(
    *,
    style_name: str,
    start: float,
    end: float,
    text: str,
    video_width: int,
    video_height: int,
    effective: EffectiveStyle,
) -> str:
    pos_x = video_width // 2
    pos_y = round(effective.verticalPosition * video_height)
    tags = f"\\an5\\pos({pos_x},{pos_y})"
    if effective.glow:
        tags += "\\be1"
    return (
        f"Dialogue: 0,{_ass_timestamp(start)},{_ass_timestamp(end)},"
        f"{style_name},,0,0,0,,{{{tags}}}{text}"
    )


def generate_ass(
    ecs: ECS,
    style: CaptionStyleSpec,
    preset: Preset,
    video_width: int,
    video_height: int,
) -> str:
    """Reveal modes (arch §7, contract §8): both `phrase` and `progressive`
    highlight one word at a time via per-word `Dialogue` events timed to
    that word's own window (extended to the next word's start, so the
    highlight holds through the pause rather than flickering back to base
    color) - `phrase` always shows every word in the segment, `progressive`
    only shows words up to the currently active one. `highlightColors`
    cycles by **segment index** (S5), not word or id. Each segment gets its
    own `[V4+ Styles]` entry since `perPhraseStyle` (D11) can give it a
    different effective style than its neighbors."""
    header = [
        "[Script Info]",
        "ScriptType: v4.00+",
        f"PlayResX: {video_width}",
        f"PlayResY: {video_height}",
        "WrapStyle: 0",
        "",
        "[V4+ Styles]",
        _ASS_STYLES_FORMAT,
    ]
    style_lines: list[str] = []
    events = ["", "[Events]", _ASS_EVENTS_FORMAT]

    for seg_idx, segment in enumerate(ecs.segments):
        if not segment.words:
            continue
        effective = resolve_effective_style(preset, style, segment)
        style_name = f"Segment{seg_idx}"
        style_lines.append(
            _style_line(style_name, video_width, video_height, effective)
        )

        colors = effective.highlightColors or ["#FFFFFF"]
        highlight_tag = _ass_color(colors[seg_idx % len(colors)])
        base_tag = _ass_color(effective.color)

        words = segment.words
        for word_idx, word in enumerate(words):
            active_end = (
                words[word_idx + 1].start if word_idx + 1 < len(words) else word.end
            )
            visible = (
                words[: word_idx + 1]
                if effective.revealMode is RevealMode.progressive
                else words
            )
            rendered = []
            for w_idx, w in enumerate(visible):
                text = _escape_ass_text(_display_text(w.text, effective))
                if not text:
                    continue  # word stripped to nothing (S7) - keeps its
                    # timeline slot (this loop iteration), contributes no text
                color = highlight_tag if w_idx == word_idx else base_tag
                rendered.append(f"{{\\c{color}}}{text}")
            events.append(
                _dialogue_line(
                    style_name=style_name,
                    start=word.start,
                    end=active_end,
                    text=" ".join(rendered),
                    video_width=video_width,
                    video_height=video_height,
                    effective=effective,
                )
            )

    return "\n".join(header + style_lines + events) + "\n"
