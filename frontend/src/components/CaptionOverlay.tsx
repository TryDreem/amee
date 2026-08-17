import { Fragment, useEffect, useMemo, useState, type CSSProperties } from "react";

import type { PresetBase, Segment } from "../api/client";
import { activeWordIndexInSegment, findActiveSegmentIndex, highlightColorFor } from "../lib/activeSegment";
import { findAnimationOption } from "../lib/animations";
import { wrapWords } from "../lib/captionFit";
import { cssFontFamily } from "../lib/fonts";
import { stripPunctuation } from "../lib/stripPunctuation";

interface CaptionOverlayProps {
  segments: Segment[];
  currentTime: number;
  style: PresetBase;
  containerWidth: number;
  containerHeight: number;
}

// Not part of any documented wire shape — architecture.md §8.1's own worked example uses an
// "85% safe horizontal width" purely to illustrate the calculation shape, not as a hardcoded
// constant. safeArea (contract §8-9) only carries top/bottom (vertical). Picked 0.85 to match
// that worked example since nothing else defines a horizontal margin; flagged, not a spec value.
const HORIZONTAL_SAFE_WIDTH_FRACTION = 0.85;

let measureCanvas: HTMLCanvasElement | null = null;

function measureWidthFor(font: string): (text: string) => number {
  if (!measureCanvas) {
    measureCanvas = document.createElement("canvas");
  }
  const ctx = measureCanvas.getContext("2d");
  if (!ctx) {
    return (text: string) => text.length * 8;
  }
  ctx.font = font;
  return (text: string) => ctx.measureText(text).width;
}

// Pure rendering choices, not wire-contract values (outline.size/shadow.size themselves are
// the contract — contract §8; these mappings are how the frontend draws them).
//
// Expressed as a FRACTION OF FONT SIZE, never absolute px (same rule as `fontSize` itself, which
// is a fraction of video height — L7). Absolute values here silently broke preview/export parity:
// the identical component renders into a ~500px-tall preview box and a 1920px-tall export frame,
// so a hardcoded `20px` glow is 80% of the glyph height in preview and 10% of it at 4K. The text
// scaled with the video and its decorations did not, which read as "glow looks different in the
// export" even though both sides ran the same code. Ratios chosen to match how the old absolute
// values looked at the default 5% font size, so the preview is visually unchanged.
const OUTLINE_WIDTH_RATIO: Record<string, number> = {
  none: 0,
  small: 0.04,
  medium: 0.08,
  large: 0.12,
};
const SHADOW_BLUR_RATIO: Record<string, number> = {
  none: 0,
  small: 0.24,
  medium: 0.56,
  large: 0.96,
};
const GLOW_BLUR_RATIO = 0.8;

// Single-word entrance duration (design: fixed 320ms for the one rendered word). Multi-word
// durations are per-word (`max(220, textLength*60)ms`), staggered by each word's start time.
const SINGLE_WORD_ANIMATION_DURATION_MS = 320;

function hexToRgba(hex: string, alphaPct: number): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m || !m[1] || !m[2] || !m[3]) {
    return hex;
  }
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  return `rgba(${r}, ${g}, ${b}, ${alphaPct / 100})`;
}

export default function CaptionOverlay({
  segments,
  currentTime,
  style,
  containerWidth,
  containerHeight,
}: CaptionOverlayProps): JSX.Element | null {
  const activeIndex = findActiveSegmentIndex(segments, currentTime);
  const activeSegment = activeIndex >= 0 ? segments[activeIndex] : undefined;
  const activeWordIdx = activeSegment ? activeWordIndexInSegment(activeSegment, currentTime) : -1;
  const isSingleWord = style.revealMode === "single-word";

  const fontSizePx = style.fontSize * containerHeight;
  // style.fontFamily is a bare family name (see lib/fonts.ts) — CSS and canvas both need a
  // quoted stack, built here rather than stored, so nothing CSS-shaped ever reaches the wire.
  const cssFamily = cssFontFamily(style.fontFamily);
  const fontString = `${style.fontWeight} ${fontSizePx}px ${cssFamily}`;

  // showPunctuation: false (default) strips displayed punctuation; Word.text itself is never
  // touched (S7) — a word that strips to empty still occupies its own timeline slot/wrap
  // position, it's just rendered blank, never removed from the array.
  // revealMode "single-word" (contract §8, INVARIANTS S8): only the active word is even present
  // in this array — every other word is absent from the output, not merely styled invisible.
  // That's a content-visibility difference, not a CSS toggle over the same markup, so it has to
  // happen here, before wrapWords ever sees the rest of the segment.
  // textTransform is applied to the string HERE, not left to CSS `text-transform` at paint time.
  // Both produce the same picture, but only this way does the wrap measurement below see the same
  // characters that will actually be drawn: uppercase Cyrillic is markedly wider than lowercase,
  // so measuring the original casing made `wrapWords` believe a line fitted when the rendered
  // uppercase version did not — the line then overflowed its box to the right and the caption read
  // as "not centered". Same order as the SRT path (S7: punctuation first, then case).
  const displayWords = useMemo(() => {
    if (!activeSegment) {
      return null;
    }
    const transform = (text: string): string => {
      const stripped = style.showPunctuation ? text : stripPunctuation(text);
      return style.textTransform === "uppercase" ? stripped.toUpperCase() : stripped;
    };
    const words = activeSegment.words.map((w) => ({ ...w, text: transform(w.text) }));
    if (style.revealMode === "single-word") {
      const active = activeWordIdx >= 0 ? words[activeWordIdx] : undefined;
      return active ? [active] : [];
    }
    return words;
  }, [
    activeSegment,
    style.showPunctuation,
    style.textTransform,
    style.revealMode,
    activeWordIdx,
  ]);

  // Web fonts load asynchronously, and canvas measurement silently falls back to a system face
  // until the real one is in. Without re-measuring afterwards the preview would keep line breaks
  // computed from the wrong metrics, while the export render (which waits on document.fonts.ready
  // before capturing anything) would use the right ones — the two drifting apart is exactly the
  // R1/R2 failure this component exists to prevent.
  const [loadedFont, setLoadedFont] = useState<string | null>(null);
  useEffect(() => {
    if (typeof document === "undefined" || !document.fonts) {
      return;
    }
    let cancelled = false;
    void document.fonts.load(fontString).then(() => {
      if (!cancelled) {
        setLoadedFont(fontString);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [fontString]);

  const wrapped = useMemo(() => {
    if (!displayWords) {
      return null;
    }
    const measure = measureWidthFor(fontString);
    const maxWidth = containerWidth * HORIZONTAL_SAFE_WIDTH_FRACTION;
    return wrapWords(displayWords, measure, maxWidth);
    // `loadedFont` is deliberately a dependency without being read: it signals that the canvas's
    // measurement metrics just changed (the real face finished loading), which is invisible to the
    // linter because the change happens inside `measureWidthFor`, not in any value here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayWords, fontString, containerWidth, loadedFont]);

  if (!activeSegment || !wrapped) {
    return null;
  }

  const topPx = style.verticalPosition * containerHeight;
  const outOfSafeArea =
    style.verticalPosition < style.safeArea.top ||
    style.verticalPosition > 1 - style.safeArea.bottom;

  // Single-word mode always uses the first colour, never the per-segment cycle: only one word is
  // ever on screen and it is always the highlighted one, so cycling by segment index would just
  // make the caption change colour from phrase to phrase. The style panel collapses to a single
  // swatch in this mode for the same reason — this keeps the render agreeing with that even when
  // the stored array still has three entries from before the mode was switched.
  const highlightColor = isSingleWord
    ? (style.highlightColors[0] ?? style.color)
    : highlightColorFor(style.highlightColors, activeIndex, style.color);
  let wordCursor = 0;

  const outlineWidth = style.outline
    ? (OUTLINE_WIDTH_RATIO[style.outline.size] ?? 0) * fontSizePx
    : 0;
  const outlineCss =
    style.outline && outlineWidth > 0
      ? `${outlineWidth}px ${hexToRgba(style.outline.color, style.outline.alpha)}`
      : undefined;
  const shadowBlur = style.shadow
    ? (SHADOW_BLUR_RATIO[style.shadow.size] ?? 0) * fontSizePx
    : 0;
  const shadowCss =
    style.shadow && shadowBlur > 0
      ? `0 0 ${shadowBlur}px ${hexToRgba(style.shadow.color, style.shadow.alpha)}`
      : undefined;

  // Entrance animation (design ANIMATIONS_D). Each word's entrance begins at its own `start`, so
  // a multi-word phrase builds up word by word; single-word mode animates the one shown word.
  //
  // Position is derived from `currentTime`, never from wall clock: the animation is emitted
  // `paused` with a negative `animation-delay` equal to how far into it this instant is. That
  // makes a frame fully determined by (segments, style, currentTime) with no dependency on when
  // the element mounted — which is what lets the headless export render seek to an arbitrary
  // frame and get exactly what preview shows at that time (INVARIANTS R1/P9). `both` fill covers
  // both ends: before the word's start it holds the from-state, after the end the to-state.
  const anim = findAnimationOption(style.revealMode, style.captionAnimation);
  const wordAnimationStyle = (wordStart: number, textLength: number): CSSProperties => {
    if (!anim?.keyframe) {
      return {};
    }
    const durationMs = isSingleWord
      ? SINGLE_WORD_ANIMATION_DURATION_MS
      : Math.max(220, textLength * 60);
    const elapsedMs = (currentTime - wordStart) * 1000;
    return {
      animationName: anim.keyframe,
      animationDuration: `${durationMs}ms`,
      animationTimingFunction: anim.ease,
      animationFillMode: "both",
      animationPlayState: "paused",
      animationDelay: `${-elapsedMs}ms`,
    };
  };

  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        top: `${topPx}px`,
        transform: "translate(-50%, -50%)",
        // Establishes the 3D rendering context every word span's rotateX/rotateY entrance
        // (tiltIn/flipX/flipY/perspectiveDrop) needs to read as a real tilt rather than a flat
        // squash — `perspective` has to live on an ancestor of the transformed element, not on
        // the element itself, and this block is that ancestor for every word.
        perspective: "800px",
        maxWidth: `${containerWidth * HORIZONTAL_SAFE_WIDTH_FRACTION}px`,
        // Column flex with centred items, not just `text-align: center`: each line is
        // `white-space: nowrap`, so a line the wrap budget couldn't satisfy (a single word wider
        // than the safe area) is wider than this box. As a block it would spill to the right only,
        // which looks like a broken centring; as a centred flex item it spills evenly both ways
        // and still reads as centred.
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        pointerEvents: "none",
        fontFamily: cssFamily,
        fontWeight: style.fontWeight,
        fontStyle: style.italic ? "italic" : "normal",
        // No `textTransform` here on purpose — displayWords already applied it, so the measured
        // string and the painted string are the same one.
        fontSize: `${fontSizePx}px`,
        lineHeight: 1.25,
        WebkitTextStroke: outlineCss,
        // -webkit-text-stroke paints centered ON the glyph outline, extending both inward and
        // outward from it -- by default the fill is painted first and the stroke on top, so the
        // stroke's inward half covers the fill entirely and the glyph reads as one solid blob of
        // the outline color instead of a bordered letter (the bug: "красит весь текст, а не
        // границы"). paint-order flips that: fill paints over the stroke, so only the outward
        // half -- the true edge -- stays visible, which is the actual "outline" look.
        paintOrder: outlineCss ? "stroke fill" : undefined,
        outline: wrapped.overflow ? "2px solid #ef4444" : undefined,
        outlineOffset: "6px",
      }}
    >
      {wrapped.lines.map((line, lineIdx) => (
        <div key={lineIdx} style={{ whiteSpace: "nowrap" }}>
          {line.map((text, wordInLine) => {
            const word = displayWords?.[wordCursor];
            // "progressive": a moving highlight -- only the single currently-active word gets the
            // highlight color; every other word (before or after it) is the base color, matching
            // CaptionsPanel's own `wordIdx === activeWordIdx` (exact match, not "every word up to
            // here") so the editing list and the preview never disagree (§12 parity). "phrase" and
            // "single-word" have only one thing to color at all (the whole segment, or the sole
            // displayed word) — always highlighted.
            const isHighlighted =
              style.revealMode === "progressive" ? wordCursor === activeWordIdx : true;
            const animation = word ? wordAnimationStyle(word.start, text.length) : {};
            wordCursor += 1;
            const color = isHighlighted ? highlightColor : style.color;
            const glowCss = style.glow
              ? `0 0 ${GLOW_BLUR_RATIO * fontSizePx}px ${color}`
              : undefined;
            const textShadow = [glowCss, shadowCss].filter(Boolean).join(", ") || undefined;
            // The inter-word space lives BETWEEN the spans, not inside them: each word span is
            // display:inline-block (required for the per-word transform keyframes to apply — CSS
            // transforms are ignored on plain inline elements), and an inline-block trims its own
            // trailing whitespace as end-of-line, so a space kept inside the span would vanish and
            // the words would run together.
            return (
              <Fragment key={wordCursor}>
                {wordInLine > 0 ? " " : null}
                <span style={{ color, textShadow, display: "inline-block", ...animation }}>
                  {text}
                </span>
              </Fragment>
            );
          })}
        </div>
      ))}
      {outOfSafeArea && (
        <div style={{ position: "absolute", inset: "-10px", border: "2px dashed #ef4444" }} />
      )}
    </div>
  );
}
