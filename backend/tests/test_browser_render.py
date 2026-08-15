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
_STYLE: dict[str, Any] = {
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
}


def _segments() -> list[dict[str, Any]]:
    return [
        {
            "id": str(uuid.uuid4()),
            "overrides": None,
            "words": [
                {"id": str(uuid.uuid4()), "text": "hello", "start": 0.0, "end": 0.5},
                {"id": str(uuid.uuid4()), "text": "world", "start": 0.5, "end": 1.0},
            ],
        }
    ]


async def test_renders_the_caption_at_a_time_inside_a_segment() -> None:
    async with caption_page(
        segments=_segments(), style=_STYLE, width=360, height=640
    ) as page:
        await page.evaluate("(t) => window.__ameeSeek(t)", 0.25)
        assert "hello" in (await page.inner_text("body"))


async def test_renders_nothing_outside_every_segment() -> None:
    """The overlay returns null when no segment is active — the exported frame at that instant must
    be fully transparent, not the last caption left on screen."""
    async with caption_page(
        segments=_segments(), style=_STYLE, width=360, height=640
    ) as page:
        await page.evaluate("(t) => window.__ameeSeek(t)", 5.0)
        assert (await page.inner_text("body")).strip() == ""


async def test_screenshot_at_returns_png_bytes() -> None:
    async with caption_page(
        segments=_segments(), style=_STYLE, width=360, height=640
    ) as page:
        frame = await screenshot_at(page, 0.25)

    assert frame.startswith(b"\x89PNG\r\n\x1a\n")
    assert len(frame) > 0


async def test_seeking_the_same_page_twice_yields_different_frames() -> None:
    """Proves the page is genuinely seekable rather than frozen at whatever it first painted — the
    property the whole frame loop depends on. `progressive` moves the highlight from word to word,
    so two instants inside one segment differ in pixels even though the text is identical."""
    async with caption_page(
        segments=_segments(), style=_STYLE, width=360, height=640
    ) as page:
        first_word_active = await screenshot_at(page, 0.25)
        second_word_active = await screenshot_at(page, 0.75)

    assert first_word_active != second_word_active


async def test_missing_build_raises_a_clear_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(browser_render, "_DIST_DIR", browser_render._DIST_DIR / "nope")

    with pytest.raises(BrowserRenderError, match="no built render surface"):
        async with caption_page(segments=[], style=_STYLE, width=10, height=10):
            pass
