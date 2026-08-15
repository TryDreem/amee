"""Real Chromium, real built frontend — no mocking. A mocked version of this would prove nothing:
the entire value of P9 is that export draws with the same engine and the same component as preview,
and only an actual browser loading the actual bundle can demonstrate that.

Skipped (not failed) when `frontend/dist` hasn't been built, so a backend-only checkout still runs
green. CI builds the frontend before the backend suite for exactly this reason.
"""

import uuid
from typing import Any

import pytest

from app.integrations import browser_render
from app.integrations.browser_render import (
    BrowserRenderError,
    caption_page,
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


async def test_missing_build_raises_a_clear_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(browser_render, "_DIST_DIR", browser_render._DIST_DIR / "nope")

    with pytest.raises(BrowserRenderError, match="no built render surface"):
        async with _open(segments=[]):
            pass
