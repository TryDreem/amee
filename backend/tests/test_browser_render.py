"""Real Chromium, real built frontend — no mocking. A mocked version of this would prove nothing:
the entire value of P9 is that export draws with the same engine and the same component as preview,
and only an actual browser loading the actual bundle can demonstrate that.

Skipped (not failed) when `frontend/dist` hasn't been built, so a backend-only checkout still runs
green. CI builds the frontend before the backend suite for exactly this reason.
"""

import io
import uuid
from pathlib import Path
from typing import Any

import pytest
from PIL import Image

from app.integrations import browser_render
from app.integrations.browser_render import (
    BrowserRenderError,
    FrameRenderCancelled,
    caption_page,
    frame_count,
    render_frames,
    screenshot_at,
)

pytestmark = pytest.mark.skipif(
    not (browser_render._DIST_DIR / "render.html").is_file(),
    reason="frontend/dist not built — run `pnpm -C frontend build`",
)

# Matches the seeded default preset (alembic f1284aa843af) — a realistic style, not a synthetic
# one, so the test exercises the same field set production actually renders.
_PRESET: dict[str, Any] = {
    "id": str(uuid.uuid4()),
    "name": "Test",
    "default": True,
    "base": {
        "fontSize": 0.08,
        "fontFamily": "Inter",
        "fontWeight": 700,
        "color": "#ffffff",
        "highlightColors": ["#ffe600"],
        "textTransform": "none",
        "italic": False,
        "glow": False,
        "outline": None,
        "shadow": None,
        "showPunctuation": False,
        "revealMode": "progressive",
        "captionAnimation": "none",
        "verticalPosition": 0.75,
        "safeArea": {"top": 0.1, "bottom": 0.15},
    },
    "bounds": {
        "fontSize": {"min": 0.02, "max": 0.2},
        "verticalPosition": {"min": 0.0, "max": 1.0},
        "safeArea": {
            "top": {"min": 0.0, "max": 0.4},
            "bottom": {"min": 0.0, "max": 0.4},
        },
    },
}


def _open(**kwargs: Any) -> Any:
    """Defaults every caller shares; each test overrides only what it is about."""
    return caption_page(
        segments=kwargs.pop("segments", _segments()),
        preset=kwargs.pop("preset", _PRESET),
        overrides=kwargs.pop("overrides", {}),
        per_phrase_style=kwargs.pop("per_phrase_style", False),
        width=kwargs.pop("width", 360),
        height=kwargs.pop("height", 640),
        **kwargs,
    )


def _segments(*, overrides: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    return [
        {
            "id": str(uuid.uuid4()),
            "overrides": overrides,
            "words": [
                {"id": str(uuid.uuid4()), "text": "hello", "start": 0.0, "end": 0.5},
                {"id": str(uuid.uuid4()), "text": "world", "start": 0.5, "end": 1.0},
            ],
        }
    ]


async def test_renders_the_caption_at_a_time_inside_a_segment() -> None:
    async with _open() as page:
        await page.evaluate("(t) => window.__ameeSeek(t)", 0.25)
        assert "hello" in (await page.inner_text("body"))


async def test_renders_nothing_outside_every_segment() -> None:
    """The overlay returns null when no segment is active — the exported frame at that instant must
    be fully transparent, not the last caption left on screen."""
    async with _open() as page:
        await page.evaluate("(t) => window.__ameeSeek(t)", 5.0)
        assert (await page.inner_text("body")).strip() == ""


async def test_screenshot_at_returns_png_bytes() -> None:
    async with _open() as page:
        frame = await screenshot_at(page, 0.25)

    assert frame.startswith(b"\x89PNG\r\n\x1a\n")
    assert len(frame) > 0


def _alpha_at(frame: bytes, x: int, y: int) -> int:
    with Image.open(io.BytesIO(frame)) as image:
        return image.convert("RGBA").getpixel((x, y))[3]  # type: ignore[index]


async def test_rendered_frame_is_transparent_where_there_is_no_caption() -> None:
    """The frame is composited *over* the video, so anything not caption must have alpha 0.

    This is the one property no structural assertion catches: a frame can be a valid PNG of the
    right size showing the right text and still be an opaque rectangle that hides the entire
    video. That exact regression shipped once - `render.tsx` imported `index.css`, whose
    `body { background: #0b0b0d }` Vite injected after the document's own transparent-background
    rule - and every existing test passed while export produced a black screen with subtitles."""
    async with _open() as page:
        with_caption = await screenshot_at(page, 0.25)
        without_caption = await screenshot_at(page, 5.0)

    # Corners, far from the centered caption block, on a frame that *does* have a caption.
    assert _alpha_at(with_caption, 0, 0) == 0
    assert _alpha_at(with_caption, 359, 639) == 0
    # And an instant with no active segment must be empty everywhere, including mid-frame.
    assert _alpha_at(without_caption, 180, 320) == 0


async def test_rendered_frame_is_opaque_where_the_caption_is() -> None:
    """The other half of the check above: proving transparency alone would be satisfied by a
    completely blank frame, which would export video with no captions at all."""
    async with _open() as page:
        frame = await screenshot_at(page, 0.25)

    with Image.open(io.BytesIO(frame)) as image:
        alpha_extremes = image.convert("RGBA").getchannel("A").getextrema()
    assert alpha_extremes[1] > 0  # at least one pixel actually painted


async def test_seeking_the_same_page_twice_yields_different_frames() -> None:
    """Proves the page is genuinely seekable rather than frozen at whatever it first painted — the
    property the whole frame loop depends on. `progressive` moves the highlight from word to word,
    so two instants inside one segment differ in pixels even though the text is identical."""
    async with _open() as page:
        first_word_active = await screenshot_at(page, 0.25)
        second_word_active = await screenshot_at(page, 0.75)

    assert first_word_active != second_word_active


async def test_document_overrides_reach_the_rendered_frame() -> None:
    """The cascade runs inside the page, so an override that changes nothing about the text must
    still change the pixels — otherwise `overrides` would be silently ignored by export."""
    async with _open() as page:
        plain = await screenshot_at(page, 0.25)
    async with _open(
        overrides={"color": "#ff0000", "highlightColors": ["#00ff00"]}
    ) as page:
        recolored = await screenshot_at(page, 0.25)

    assert plain != recolored


async def test_per_segment_override_applies_only_when_per_phrase_is_on() -> None:
    """D11: `Segment.overrides` is gated by the document-level `perPhraseStyle` toggle. With it off
    the override lies dormant and the frame must be identical to having no override at all; with it
    on the same document must render differently."""
    segments = _segments(overrides={"color": "#ff0000"})

    async with _open(segments=_segments()) as page:
        no_override = await screenshot_at(page, 0.25)
    async with _open(segments=segments, per_phrase_style=False) as page:
        dormant = await screenshot_at(page, 0.25)
    async with _open(segments=segments, per_phrase_style=True) as page:
        applied = await screenshot_at(page, 0.25)

    assert dormant == no_override
    assert applied != no_override


@pytest.mark.parametrize(
    "duration,fps,expected",
    [
        (1.0, 30.0, 30),
        # Partial trailing frame still gets rendered — ceil, not floor, or the overlay would end
        # early and the last fraction of a second would show no caption at all.
        (1.01, 30.0, 31),
        (0.0, 30.0, 1),
        (-5.0, 30.0, 1),
    ],
)
def test_frame_count(duration: float, fps: float, expected: int) -> None:
    assert frame_count(duration, fps) == expected


async def _render(tmp_path: Path, **kwargs: Any) -> int:
    return await render_frames(
        tmp_path,
        segments=kwargs.pop("segments", _segments()),
        preset=_PRESET,
        overrides={},
        per_phrase_style=False,
        width=180,
        height=320,
        duration_seconds=kwargs.pop("duration_seconds", 0.2),
        fps=kwargs.pop("fps", 10.0),
        **kwargs,
    )


async def test_render_frames_writes_one_png_per_frame(tmp_path: Path) -> None:
    written = await _render(tmp_path)

    frames = sorted(tmp_path.glob("*.png"))
    assert written == len(frames) == 2
    # 1-based, zero-padded to 6 — the naming ffmpeg's `%06d` pattern reads back.
    assert [f.name for f in frames] == ["frame_000001.png", "frame_000002.png"]
    assert all(f.read_bytes().startswith(b"\x89PNG\r\n\x1a\n") for f in frames)


async def test_render_frames_captures_each_frame_at_its_own_time(
    tmp_path: Path,
) -> None:
    """Frame i must be the picture at i/fps, not the same instant repeated. Uses `progressive`,
    where the highlight moves between the two words, so frames spanning that boundary differ."""
    await _render(tmp_path, duration_seconds=1.0, fps=2.0)

    frames = sorted(tmp_path.glob("*.png"))
    assert len({f.read_bytes() for f in frames}) > 1


async def test_render_frames_reports_progress_ending_at_100(tmp_path: Path) -> None:
    percents: list[float] = []

    async def _record(percent: float) -> None:
        percents.append(percent)

    await _render(tmp_path, on_progress=_record)

    assert percents == [50.0, 100.0]


async def test_render_frames_stops_when_cancelled(tmp_path: Path) -> None:
    """Cancellation is checked between frames, so the loop must abort partway rather than run to
    completion and discard the result (P8/X7)."""
    calls = 0

    async def _cancel_after_first() -> bool:
        nonlocal calls
        calls += 1
        return calls > 1

    with pytest.raises(FrameRenderCancelled):
        await _render(
            tmp_path, duration_seconds=1.0, fps=10.0, should_cancel=_cancel_after_first
        )

    # One frame got written before the second check fired — proof it stopped early rather than
    # never starting or running all ten.
    assert len(list(tmp_path.glob("*.png"))) == 1


async def test_missing_build_raises_a_clear_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(browser_render, "_DIST_DIR", browser_render._DIST_DIR / "nope")

    with pytest.raises(BrowserRenderError, match="no built render surface"):
        async with _open(segments=[]):
            pass
