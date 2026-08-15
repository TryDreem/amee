import uuid

from app.integrations.subtitles import (
    _strip_punctuation,
    generate_srt,
    resolve_effective_style,
)
from app.schemas.ecs import ECS, Segment, Word
from app.schemas.preset import Preset, PresetBase, PresetBounds, SafeAreaBounds
from app.schemas.style import (
    CaptionAnimation,
    CaptionStyleSpec,
    OutlineOrShadow,
    OutlineShadowSize,
    RevealMode,
    SafeArea,
    StyleOverrides,
    TextTransform,
)


def _word(text: str, start: float, end: float) -> Word:
    return Word(id=uuid.uuid4(), text=text, start=start, end=end)


def _segment(words: list[Word], overrides: StyleOverrides | None = None) -> Segment:
    return Segment(id=uuid.uuid4(), words=words, overrides=overrides)


def _preset() -> Preset:
    return Preset(
        id=uuid.uuid4(),
        name="Test preset",
        default=True,
        base=PresetBase(
            fontSize=0.08,
            fontFamily="Inter",
            fontWeight=700,
            color="#ffffff",
            highlightColors=["#ffe600"],
            textTransform=TextTransform.none,
            italic=False,
            glow=False,
            outline=None,
            shadow=None,
            showPunctuation=False,
            revealMode=RevealMode.progressive,
            captionAnimation=CaptionAnimation.none,
            verticalPosition=0.75,
            safeArea=SafeArea(top=0.1, bottom=0.15),
        ),
        bounds=PresetBounds(
            fontSize={"min": 0.03, "max": 0.12},
            verticalPosition={"min": 0.1, "max": 0.85},
            safeArea=SafeAreaBounds(
                top={"min": 0.0, "max": 0.2}, bottom={"min": 0.0, "max": 0.25}
            ),
        ),
    )


def _style(
    per_phrase_style: bool = False, overrides: StyleOverrides | None = None
) -> CaptionStyleSpec:
    return CaptionStyleSpec(
        project_id=uuid.uuid4(),
        owner_id=uuid.uuid4(),
        presetId=uuid.uuid4(),
        perPhraseStyle=per_phrase_style,
        overrides=overrides or StyleOverrides(),
    )


def _ecs(segments: list[Segment]) -> ECS:
    return ECS(project_id=uuid.uuid4(), owner_id=uuid.uuid4(), segments=segments)


# ---------------------------------------------------------------------------
# generate_srt
# ---------------------------------------------------------------------------


def test_generate_srt_one_cue_per_segment() -> None:
    ecs = _ecs(
        [
            _segment([_word("hello", 0.0, 0.4), _word("world", 0.4, 0.9)]),
            _segment([_word("second", 1.2, 1.6)]),
        ]
    )
    srt = generate_srt(ecs, _style(), _preset())
    blocks = srt.strip().split("\n\n")
    assert len(blocks) == 2
    assert blocks[0] == "1\n00:00:00,000 --> 00:00:00,900\nhello world"
    assert blocks[1] == "2\n00:00:01,200 --> 00:00:01,600\nsecond"


def test_generate_srt_skips_empty_segments() -> None:
    ecs = _ecs([_segment([]), _segment([_word("hi", 0.0, 0.3)])])
    srt = generate_srt(ecs, _style(), _preset())
    assert srt.strip().startswith("1\n")


# ---------------------------------------------------------------------------
# resolve_effective_style
# ---------------------------------------------------------------------------


def test_resolve_effective_style_preset_only() -> None:
    preset = _preset()
    style = _style()
    segment = _segment([_word("hi", 0.0, 0.3)])
    effective = resolve_effective_style(preset, style, segment)
    assert effective.fontSize == 0.08
    assert effective.color == "#ffffff"
    assert effective.highlightColors == ["#ffe600"]


def test_resolve_effective_style_applies_document_overrides() -> None:
    preset = _preset()
    style = _style(overrides=StyleOverrides(fontSize=0.1, color="#ff0000"))
    segment = _segment([_word("hi", 0.0, 0.3)])
    effective = resolve_effective_style(preset, style, segment)
    assert effective.fontSize == 0.1
    assert effective.color == "#ff0000"
    # untouched fields still come from the preset
    assert effective.fontFamily == "Inter"


def test_resolve_effective_style_applies_segment_overrides_when_per_phrase_enabled() -> (
    None
):
    preset = _preset()
    style = _style(per_phrase_style=True, overrides=StyleOverrides(color="#ff0000"))
    segment = _segment(
        [_word("hi", 0.0, 0.3)], overrides=StyleOverrides(color="#00ff00")
    )
    effective = resolve_effective_style(preset, style, segment)
    assert effective.color == "#00ff00"  # segment layer wins


def test_resolve_effective_style_ignores_segment_overrides_when_per_phrase_disabled() -> (
    None
):
    preset = _preset()
    style = _style(per_phrase_style=False, overrides=StyleOverrides(color="#ff0000"))
    segment = _segment(
        [_word("hi", 0.0, 0.3)], overrides=StyleOverrides(color="#00ff00")
    )
    effective = resolve_effective_style(preset, style, segment)
    assert effective.color == "#ff0000"  # segment override present but ignored


def test_resolve_effective_style_outline_replaces_as_whole_object() -> None:
    preset = _preset()
    style = _style(
        overrides=StyleOverrides(
            outline=OutlineOrShadow(
                size=OutlineShadowSize.large, color="#000000", alpha=50
            )
        )
    )
    segment = _segment([_word("hi", 0.0, 0.3)])
    effective = resolve_effective_style(preset, style, segment)
    assert effective.outline is not None
    assert effective.outline.size == OutlineShadowSize.large
    assert effective.outline.alpha == 50


# ---------------------------------------------------------------------------
# showPunctuation (INVARIANTS S7)
# ---------------------------------------------------------------------------


def test_strip_punctuation_removes_sentence_marks() -> None:
    assert _strip_punctuation("hello, world!") == "hello world"
    assert _strip_punctuation("really?") == "really"
    assert _strip_punctuation("wait...") == "wait"
    assert _strip_punctuation("one, two; three: four.") == "one two three four"
    assert _strip_punctuation("em—dash and en–dash") == "emdash and endash"


def test_strip_punctuation_keeps_apostrophes_and_compound_hyphens() -> None:
    assert _strip_punctuation("don't") == "don't"
    assert _strip_punctuation("it's") == "it's"
    assert _strip_punctuation("well-known") == "well-known"


def test_strip_punctuation_removes_standalone_hyphen() -> None:
    assert _strip_punctuation("wait - really") == "wait  really"
    assert _strip_punctuation("- yes") == " yes"


def test_generate_srt_default_hides_punctuation() -> None:
    ecs = _ecs([_segment([_word("hello,", 0.0, 0.4), _word("world!", 0.4, 0.9)])])
    srt = generate_srt(ecs, _style(), _preset())
    text_line = srt.strip().splitlines()[-1]
    assert text_line == "hello world"


def test_generate_srt_shows_punctuation_when_enabled() -> None:
    preset = _preset()
    style = _style(overrides=StyleOverrides(showPunctuation=True))
    ecs = _ecs([_segment([_word("hello,", 0.0, 0.4), _word("world!", 0.4, 0.9)])])
    srt = generate_srt(ecs, style, preset)
    assert "hello, world!" in srt


def test_resolve_effective_style_carries_caption_animation() -> None:
    preset = _preset()
    style = _style(overrides=StyleOverrides(captionAnimation=CaptionAnimation.fade))
    segment = _segment([_word("hi", 0.0, 0.3)])
    effective = resolve_effective_style(preset, style, segment)
    assert effective.captionAnimation == CaptionAnimation.fade
