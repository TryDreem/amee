// Headless render surface for export (INVARIANTS P9). Deliberately NOT a route inside App: no
// router, no ExportProvider, no API calls, no fonts/CSS beyond what a caption needs. The server
// drives this page - it injects the document to draw, then seeks it frame by frame and screenshots
// the result. Everything drawn here comes from the same `CaptionOverlay` the live editor uses, which
// is the whole point: parity is structural, not re-implemented (R1/R2).
import { useEffect, useState } from "react";
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
  width: number;
  height: number;
}

declare global {
  interface Window {
    __AMEE_RENDER__?: RenderPayload;
    // Set once the first paint is on screen and fonts have settled. The driver polls for this
    // before requesting any frame.
    __ameeReady?: true;
    // Seeks to `time` (seconds) and resolves once that frame is actually painted.
    __ameeSeek?: (time: number) => Promise<void>;
  }
}

// Resolves after the browser has painted. One rAF fires *before* paint of the frame it is
// scheduled in, so the second one is what guarantees the pixels for the state we just committed
// are on screen - screenshotting after only one would race the compositor and can capture the
// previous frame.
function afterPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

function RenderSurface({ payload }: { payload: RenderPayload }): JSX.Element {
  const [time, setTime] = useState(0);

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

    // document.fonts.ready is why the driver can't just screenshot immediately: web fonts load
    // asynchronously, and a frame taken before they settle renders in a fallback face - the exact
    // class of preview/export mismatch this whole change exists to remove (R3: same engine is not
    // automatically the same environment).
    void document.fonts.ready.then(afterPaint).then(() => {
      window.__ameeReady = true;
    });

    return () => {
      delete window.__ameeSeek;
    };
  }, []);

  return (
    <div
      style={{
        position: "relative",
        width: `${payload.width}px`,
        height: `${payload.height}px`,
        overflow: "hidden",
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
