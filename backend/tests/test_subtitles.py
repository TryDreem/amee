import uuid

from app.integrations.subtitles import (
    _strip_punctuation,
    generate_ass,
    generate_srt,
    resolve_effective_style,
)
from app.schemas.ecs import ECS, Segment, Word
from app.schemas.preset import Preset, PresetBase, PresetBounds, SafeAreaBounds
from app.schemas.style import (
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
# generate_ass
# ---------------------------------------------------------------------------


def test_generate_ass_has_required_sections() -> None:
    ecs = _ecs([_segment([_word("hi", 0.0, 0.3), _word("there", 0.3, 0.6)])])
    ass = generate_ass(ecs, _style(), _preset(), video_width=1080, video_height=1920)
    assert "[Script Info]" in ass
    assert "[V4+ Styles]" in ass
    assert "[Events]" in ass
    assert "PlayResX: 1080" in ass
    assert "PlayResY: 1920" in ass
    assert "Dialogue:" in ass
    assert "Style: Segment0," in ass


def test_generate_ass_progressive_reveal_grows_visible_words() -> None:
    ecs = _ecs([_segment([_word("hi", 0.0, 0.3), _word("there", 0.3, 0.6)])])
    ass = generate_ass(ecs, _style(), _preset(), video_width=1080, video_height=1920)
    dialogue_lines = [line for line in ass.splitlines() if line.startswith("Dialogue:")]
    assert len(dialogue_lines) == 2
    # first word's event only shows "hi", the second shows both words
    assert "there" not in dialogue_lines[0]
    assert "hi" in dialogue_lines[1] and "there" in dialogue_lines[1]


def test_generate_ass_phrase_reveal_always_shows_full_segment() -> None:
    preset = _preset()
    style = _style(overrides=StyleOverrides(revealMode=RevealMode.phrase))
    ecs = _ecs([_segment([_word("hi", 0.0, 0.3), _word("there", 0.3, 0.6)])])
    ass = generate_ass(ecs, style, preset, video_width=1080, video_height=1920)
    dialogue_lines = [line for line in ass.splitlines() if line.startswith("Dialogue:")]
    assert len(dialogue_lines) == 2
    assert "hi" in dialogue_lines[0] and "there" in dialogue_lines[0]
    assert "hi" in dialogue_lines[1] and "there" in dialogue_lines[1]


def test_generate_ass_per_phrase_style_off_ignores_segment_overrides() -> None:
    preset = _preset()
    style = _style(per_phrase_style=False)
    segment = _segment([_word("hi", 0.0, 0.3)], overrides=StyleOverrides(fontSize=0.5))
    ecs = _ecs([segment])
    ass = generate_ass(ecs, style, preset, video_width=1080, video_height=1920)
    # 0.5 * 1920 = 960 - must not appear; the preset's own 0.08 * 1920 must
    style_line = [line for line in ass.splitlines() if line.startswith("Style:")][0]
    assert ",960," not in style_line
    assert f",{round(0.08 * 1920)}," in style_line


def test_generate_ass_per_phrase_style_on_applies_segment_overrides() -> None:
    preset = _preset()
    style = _style(per_phrase_style=True)
    segment = _segment([_word("hi", 0.0, 0.3)], overrides=StyleOverrides(fontSize=0.5))
    ecs = _ecs([segment])
    ass = generate_ass(ecs, style, preset, video_width=1080, video_height=1920)
    style_line = [line for line in ass.splitlines() if line.startswith("Style:")][0]
    assert f",{round(0.5 * 1920)}," in style_line


def test_generate_ass_highlight_colors_cycle_by_segment_index() -> None:
    preset = _preset()
    style = _style(overrides=StyleOverrides(highlightColors=["#111111", "#222222"]))
    ecs = _ecs(
        [
            _segment([_word("a", 0.0, 0.3)]),
            _segment([_word("b", 0.4, 0.7)]),
            _segment([_word("c", 0.8, 1.1)]),
        ]
    )
    ass = generate_ass(ecs, style, preset, video_width=1080, video_height=1920)
    dialogue_lines = [line for line in ass.splitlines() if line.startswith("Dialogue:")]
    # segment 0 -> color[0], segment 1 -> color[1], segment 2 -> color[0] again
    assert "&H00111111&" in dialogue_lines[0]
    assert "&H00222222&" in dialogue_lines[1]
    assert "&H00111111&" in dialogue_lines[2]


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


def test_generate_ass_default_hides_punctuation() -> None:
    ecs = _ecs([_segment([_word("hi,", 0.0, 0.3)])])
    ass = generate_ass(ecs, _style(), _preset(), video_width=1080, video_height=1920)
    dialogue_lines = [line for line in ass.splitlines() if line.startswith("Dialogue:")]
    assert "hi," not in dialogue_lines[0]
    assert "hi" in dialogue_lines[0]


def test_generate_ass_shows_punctuation_when_enabled() -> None:
    preset = _preset()
    style = _style(overrides=StyleOverrides(showPunctuation=True))
    ecs = _ecs([_segment([_word("hi,", 0.0, 0.3)])])
    ass = generate_ass(ecs, style, preset, video_width=1080, video_height=1920)
    dialogue_lines = [line for line in ass.splitlines() if line.startswith("Dialogue:")]
    assert "hi," in dialogue_lines[0]


def test_generate_ass_word_stripped_to_empty_is_dropped_but_keeps_timeline_slot() -> (
    None
):
    # A word that's pure punctuation still gets its own Dialogue event
    # (S7: keeps its timeline slot) even though it contributes no text.
    preset = _preset()
    style = _style(overrides=StyleOverrides(revealMode=RevealMode.phrase))
    ecs = _ecs(
        [
            _segment(
                [_word("hi", 0.0, 0.3), _word("--", 0.3, 0.5), _word("bye", 0.5, 0.8)]
            )
        ]
    )
    ass = generate_ass(ecs, style, preset, video_width=1080, video_height=1920)
    dialogue_lines = [line for line in ass.splitlines() if line.startswith("Dialogue:")]
    assert len(dialogue_lines) == 3  # one event per word, including the empty one
    assert "hi" in dialogue_lines[1] and "bye" in dialogue_lines[1]
