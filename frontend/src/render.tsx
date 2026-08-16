// Headless render surface for export (INVARIANTS P9). Deliberately NOT a route inside App: no
// router, no ExportProvider, no API calls, no fonts/CSS beyond what a caption needs. The server
// drives this page - it injects the document to draw, then seeks it frame by frame and screenshots
// the result. Everything drawn here comes from the same `CaptionOverlay` the live editor uses, which
// is the whole point: parity is structural, not re-implemented (R1/R2).
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";

import CaptionOverlay from "./components/CaptionOverlay";
import { resolveStyleLayers, type Preset, type Segment, type StyleOverrides } from "./api/client";
import { findActiveSegmentIndex } from "./lib/activeSegment";
// Deliberately NOT "./index.css": that file paints the app chrome, including an opaque
// `body { background: #0b0b0d }`. Vite injects it after this document's own inline <style>, so it
// won on source order and every captured frame came out an opaque near-black rectangle that
// covered the whole video once composited. Only the caption keyframes are needed here.
import "./captionAnimations.css";

export interface RenderPayload {
  segments: Segment[];
  // Unresolved, exactly as stored: the cascade runs *here*, per frame, through the same
  // `resolveStyleLayers` the editor calls (R2 - one resolver, not two that can drift). Handing this
  // page a pre-resolved style would be wrong as well as duplicative: with per-phrase style on, the
  // effective style depends on which segment is on screen, so it is a function of time, not a
  // constant for the whole export (D11).
  preset: Preset;
  overrides: StyleOverrides;
  perPhraseStyle: boolean;
  // The video's own pixel dimensions. Layout is always computed against these — fontSize and
  // verticalPosition are fractions of them (L7) — regardless of how much of the frame is actually
  // captured.
  width: number;
  height: number;
  // Optional: capture only the horizontal strip starting at `bandY`. The surface still lays out at
  // full `height` and is then shifted up, so nothing about the caption's size or position changes;
  // only the browser window is smaller. That matters because screenshot cost is dominated by PNG
  // encoding, which scales with pixel count: at 1080x1920 a frame costs ~68ms, and the same
  // caption in a 1080x600 window costs ~19ms. Cropping the captured image instead does NOT help —
  // Chromium still rasterises and encodes the full frame before cutting it.
  bandY?: number;
}

declare global {
  interface Window {
    __AMEE_RENDER__?: RenderPayload;
    // Set once the first paint is on screen and fonts have settled. The driver polls for this
    // before requesting any frame.
    __ameeReady?: true;
    // Seeks to `time` (seconds) and resolves once that frame is actually painted.
    __ameeSeek?: (time: number) => Promise<void>;
    // Vertical extent the caption occupies across the sampled instants, in page pixels, plus the
    // largest font size seen. Lets the driver size its capture window to just that strip. Measured
    // here, never derived in Python: the band depends on the resolved style (verticalPosition,
    // fontSize, per-segment overrides), and the cascade lives on this side only (R2).
    __ameeCaptionBand?: (
      times: number[]
    ) => { top: number; bottom: number; fontSize: number } | null;
  }
}

// Resolves once the state committed by `flushSync` is ready to be captured. A single rAF is
// enough: `flushSync` has already run layout synchronously, and CDP's captureScreenshot commits
// the pending frame itself rather than sampling whatever the compositor last showed. A second rAF
// was here originally out of caution and cost ~8ms of the ~27ms frame budget — a third of export
// time spent waiting. Verified by exporting the same project both ways and comparing: identical.
function afterPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function RenderSurface({ payload }: { payload: RenderPayload }): JSX.Element {
  const [time, setTime] = useState(0);
  const surfaceRef = useRef<HTMLDivElement>(null);

  // Mirrors Editor.tsx's RENDERING resolution exactly (arch §4.2): the segment active at this
  // instant supplies the override layer, and only when the document-level per-phrase toggle is on.
  // CaptionOverlay re-derives the active segment from the same (segments, time) pair, so the two
  // always agree on which segment this style belongs to.
  const renderIndex = findActiveSegmentIndex(payload.segments, time);
  const renderSegment = renderIndex >= 0 ? payload.segments[renderIndex] : undefined;
  const style = resolveStyleLayers(
    payload.preset,
    payload.overrides,
    payload.perPhraseStyle ? renderSegment?.overrides : null
  );

  useEffect(() => {
    window.__ameeSeek = async (next: number) => {
      // flushSync, not a plain setState: the driver awaits this promise and screenshots the moment
      // it resolves, so the DOM must already reflect `next` before we start waiting on paint.
      // React would otherwise be free to batch the update past our rAF pair.
      flushSync(() => setTime(next));
      await afterPaint();
    };

    window.__ameeCaptionBand = (times: number[]) => {
      let top = Number.POSITIVE_INFINITY;
      let bottom = Number.NEGATIVE_INFINITY;
      let fontSize = 0;
      for (const t of times) {
        flushSync(() => setTime(t));
        // CaptionOverlay renders exactly one root element (or null when no segment is active), so
        // the surface's first child *is* the caption block.
        const block = surfaceRef.current?.firstElementChild;
        if (!(block instanceof HTMLElement)) {
          continue;
        }
        // getBoundingClientRect includes the entrance animation's transform, which is why the
        // caller samples mid-animation instants too — a slide-up entrance sits outside its settled
        // box, and a window sized to the settled box alone would clip it.
        const rect = block.getBoundingClientRect();
        top = Math.min(top, rect.top);
        bottom = Math.max(bottom, rect.bottom);
        fontSize = Math.max(fontSize, parseFloat(getComputedStyle(block).fontSize) || 0);
      }
      return bottom > top ? { top, bottom, fontSize } : null;
    };

    // document.fonts.ready is why the driver can't just screenshot immediately: web fonts load
    // asynchronously, and a frame taken before they settle renders in a fallback face - the exact
    // class of preview/export mismatch this whole change exists to remove (R3: same engine is not
    // automatically the same environment).
    void document.fonts.ready.then(afterPaint).then(() => {
      window.__ameeReady = true;
    });

    return () => {
      delete window.__ameeSeek;
      delete window.__ameeCaptionBand;
    };
  }, []);

  return (
    <div
      ref={surfaceRef}
      style={{
        position: "relative",
        width: `${payload.width}px`,
        height: `${payload.height}px`,
        overflow: "hidden",
        // Shifted up so the caption strip lands inside a window only as tall as the strip. Layout
        // above is untouched — the surface is still the full video size, so fontSize,
        // verticalPosition and wrapping resolve exactly as they do at full height; only which part
        // of it the browser has to rasterise changes.
        marginTop: payload.bandY ? `${-payload.bandY}px` : undefined,
        // Transparent, never a color: these frames are composited over the source video by ffmpeg,
        // so any background here would paint over the footage.
        background: "transparent",
      }}
    >
      <CaptionOverlay
        segments={payload.segments}
        currentTime={time}
        style={style}
        containerWidth={payload.width}
        containerHeight={payload.height}
      />
    </div>
  );
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("#root element not found");
}
const payload = window.__AMEE_RENDER__;
if (!payload) {
  throw new Error("window.__AMEE_RENDER__ was not injected before this bundle ran");
}

// No StrictMode: it double-invokes effects in development, which would register __ameeSeek, tear it
// down, and register it again. Harmless in the editor, but this page's entire contract with the
// driver is that global being present and stable.
createRoot(rootElement).render(<RenderSurface payload={payload} />);
