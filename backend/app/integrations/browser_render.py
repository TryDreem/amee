"""Renders caption frames by driving the frontend's own `CaptionOverlay` in headless Chromium
(INVARIANTS P9). This is what makes preview/export parity structural instead of re-implemented:
nothing here knows how a caption looks, it only tells the page which instant to show and captures
the result.

Same boundary shape as `ffmpeg.py` — one narrow public surface, one dedicated exception, no
knowledge of Celery, sessions, or repositories.

**Why the built frontend is served over a fake http origin rather than opened from disk:** the
render page is an ES module bundle, and Chromium blocks module scripts loaded from `file://`
(opaque origin, CORS-denied). Serving it via Playwright's request interception avoids that without
standing up a real HTTP server — which would otherwise need a port, and ports are exactly what
parallel worktrees/workers collide on (`scripts/wt-env.sh` exists because of that).
"""

import json
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from playwright.async_api import Page, Route, async_playwright

# The export worker renders the *built* frontend, not the dev server: a production worker has no
# Vite running, and pinning to `dist/` keeps export reproducible against whatever was deployed.
# `make -C frontend build` (or `pnpm -C frontend build`) must have run for export to work at all.
_DIST_DIR = Path(
    os.environ.get(
        "AMEE_FRONTEND_DIST",
        Path(__file__).resolve().parents[3] / "frontend" / "dist",
    )
)
_RENDER_ORIGIN = "http://amee.render"
_RENDER_URL = f"{_RENDER_ORIGIN}/render.html"

# Fonts are fetched from the network by the page itself (Google Fonts + the four @font-face URLs in
# render.html), so a cold page needs real time before `document.fonts.ready` settles. Generous
# because a timeout here silently means "exported in a fallback typeface", the exact failure this
# whole design removes (R3).
_READY_TIMEOUT_MS = 60_000

_CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
}


class BrowserRenderError(RuntimeError):
    """The render surface could not be loaded or driven — missing build output, a page that never
    signalled ready, or a navigation/JS failure."""


async def _serve_from_dist(route: Route) -> None:
    """Answers `_RENDER_ORIGIN` requests from the built frontend; everything else (fonts, and any
    other real host) is allowed through to the network untouched."""
    url = route.request.url
    if not url.startswith(_RENDER_ORIGIN):
        await route.continue_()
        return

    relative = url[len(_RENDER_ORIGIN) :].split("?", 1)[0].lstrip("/")
    candidate = (_DIST_DIR / relative).resolve()
    # Path-traversal guard: `relative` comes from the page, so a crafted "../.." must not be able
    # to read outside the build directory even though the page is our own code today.
    if not candidate.is_relative_to(_DIST_DIR.resolve()) or not candidate.is_file():
        await route.abort()
        return

    await route.fulfill(
        status=200,
        body=candidate.read_bytes(),
        content_type=_CONTENT_TYPES.get(candidate.suffix, "application/octet-stream"),
    )


@asynccontextmanager
async def caption_page(
    *,
    segments: list[dict[str, Any]],
    style: dict[str, Any],
    width: int,
    height: int,
) -> AsyncIterator[Page]:
    """Opens the render surface with one document loaded, ready to be seeked.

    `segments`/`style` are plain JSON-safe dicts, already fully resolved by the caller — this layer
    performs no style cascade of its own, so export cannot resolve a style differently than the
    editor did (R2). Yields a `Page`; use `screenshot_at` to capture instants from it.
    """
    if not (_DIST_DIR / "render.html").is_file():
        raise BrowserRenderError(
            f"no built render surface at {_DIST_DIR}/render.html — "
            "run `pnpm -C frontend build` (or set AMEE_FRONTEND_DIST)"
        )

    payload = {"segments": segments, "style": style, "width": width, "height": height}
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch()
        try:
            # device_scale_factor stays 1: the page is laid out in the video's own pixel
            # dimensions, so a scale factor would silently render at the wrong resolution.
            context = await browser.new_context(
                viewport={"width": width, "height": height},
                device_scale_factor=1,
            )
            page = await context.new_page()
            await page.route("**/*", _serve_from_dist)
            # Injected before any script of the page runs — render.tsx reads it at module scope
            # and throws if it is missing, so this cannot race the bundle. json.dumps, not repr:
            # word text is arbitrary user content (apostrophes, quotes, non-ASCII) and Python's
            # True/False/None are not JSON literals.
            await page.add_init_script(
                f"window.__AMEE_RENDER__ = {json.dumps(payload)};"
            )
            await page.goto(_RENDER_URL, wait_until="load")
            try:
                await page.wait_for_function(
                    "() => window.__ameeReady === true", timeout=_READY_TIMEOUT_MS
                )
            except Exception as exc:
                raise BrowserRenderError(
                    "render surface never became ready (fonts or bundle failed to load)"
                ) from exc
            yield page
        finally:
            await browser.close()


async def screenshot_at(page: Page, time_seconds: float) -> bytes:
    """One frame, as transparent PNG bytes, at `time_seconds` of the video's timeline.

    The page resolves its own seek promise only after the frame is actually painted, so this does
    not need to sleep or guess — see `afterPaint` in `frontend/src/render.tsx`.
    """
    await page.evaluate("(t) => window.__ameeSeek(t)", time_seconds)
    return await page.screenshot(omit_background=True, type="png")
