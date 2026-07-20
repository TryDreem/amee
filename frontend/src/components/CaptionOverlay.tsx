import { useMemo } from "react";

import type { PresetBase, Segment } from "../api/client";
import { activeWordIndexInSegment, findActiveSegmentIndex, highlightColorFor } from "../lib/activeSegment";
import { wrapWords } from "../lib/captionFit";
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
// the contract — contract §8; these px mappings are how the frontend draws them).
const OUTLINE_WIDTH_PX: Record<string, number> = { none: 0, small: 1, medium: 2, large: 3 };
const SHADOW_BLUR_PX: Record<string, number> = { none: 0, small: 6, medium: 14, large: 24 };

// captionAnimation -> {keyframe name, easing}, ported verbatim from the design's ANIMATIONS_D
// (contract §8: cosmetic entrance transition, orthogonal to revealMode). "none" plays nothing.
const CAPTION_ANIMATION: Record<string, { name: string; ease: string } | undefined> = {
  none: undefined,
  fade: { name: "capFadeSlide", ease: "ease-out" },
  pop: { name: "capPop", ease: "cubic-bezier(.34,1.56,.64,1)" },
  bounce: { name: "capBounce", ease: "cubic-bezier(.36,1.9,.5,1)" },
  blur: { name: "capBlurIn", ease: "ease-out" },
  snap: { name: "capSlideSnap", ease: "cubic-bezier(.2,.9,.3,1.2)" },
};
// The design applies its entrance keyframes per-word, staggered by each word's own start time —
// that's tied to its per-word ANIMATIONS_D variants, not applicable here. Ours is a single
// segment-level transition (contract §8's "played when a segment becomes the active one"), so
// one fixed duration for the whole block is the direct port of that wording.
const CAPTION_ANIMATION_DURATION_MS = 400;

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

  const fontSizePx = style.fontSize * containerHeight;
  const fontString = `${style.fontWeight} ${fontSizePx}px ${style.fontFamily}`;

  // showPunctuation: false (default) strips displayed punctuation; Word.text itself is never
  // touched (S7) — a word that strips to empty still occupies its own timeline slot/wrap
  // position, it's just rendered blank, never removed from the array.
  // revealMode "single-word" (contract §8, INVARIANTS S8): only the active word is even present
  // in this array — every other word is absent from the output, not merely styled invisible.
  // That's a content-visibility difference, not a CSS toggle over the same markup, so it has to
  // happen here, before wrapWords ever sees the rest of the segment.
  const displayWords = useMemo(() => {
    if (!activeSegment) {
      return null;
    }
    const words = style.showPunctuation
      ? activeSegment.words
      : activeSegment.words.map((w) => ({ ...w, text: stripPunctuation(w.text) }));
    if (style.revealMode === "single-word") {
      const active = activeWordIdx >= 0 ? words[activeWordIdx] : undefined;
      return active ? [active] : [];
    }
    return words;
  }, [activeSegment, style.showPunctuation, style.revealMode, activeWordIdx]);

  const wrapped = useMemo(() => {
    if (!displayWords) {
      return null;
    }
    const measure = measureWidthFor(fontString);
    const maxWidth = containerWidth * HORIZONTAL_SAFE_WIDTH_FRACTION;
    return wrapWords(displayWords, measure, maxWidth);
  }, [displayWords, fontString, containerWidth]);

  if (!activeSegment || !wrapped) {
    return null;
  }

  const topPx = style.verticalPosition * containerHeight;
  const outOfSafeArea =
    style.verticalPosition < style.safeArea.top ||
    style.verticalPosition > 1 - style.safeArea.bottom;

  // Progressive gates highlighting on the active word; single-word/phrase modes have only one
  // thing to highlight (the sole displayed word, or the whole phrase) — Infinity always passes.
  const revealIdx = style.revealMode === "progressive" ? activeWordIdx : Infinity;

  const highlightColor = highlightColorFor(style.highlightColors, activeIndex, style.color);
  let wordCursor = 0;

  const outlineWidth = style.outline ? OUTLINE_WIDTH_PX[style.outline.size] ?? 0 : 0;
  const outlineCss =
    style.outline && outlineWidth > 0
      ? `${outlineWidth}px ${hexToRgba(style.outline.color, style.outline.alpha)}`
      : undefined;
  const shadowBlur = style.shadow ? SHADOW_BLUR_PX[style.shadow.size] ?? 0 : 0;
  const shadowCss =
    style.shadow && shadowBlur > 0
      ? `0 0 ${shadowBlur}px ${hexToRgba(style.shadow.color, style.shadow.alpha)}`
      : undefined;

  const captionAnim = CAPTION_ANIMATION[style.captionAnimation];
  const captionAnimCss = captionAnim
    ? `${captionAnim.name} ${CAPTION_ANIMATION_DURATION_MS}ms ${captionAnim.ease} both`
    : undefined;

  return (
    <div
      // Remounts on every active-segment change, which is what makes the CSS `animation` below
      // actually replay each time (a re-render alone won't restart an already-applied keyframe).
      key={activeSegment.id}
      style={{
        position: "absolute",
        left: "50%",
        top: `${topPx}px`,
        transform: "translate(-50%, -50%)",
        maxWidth: `${containerWidth * HORIZONTAL_SAFE_WIDTH_FRACTION}px`,
        textAlign: "center",
        pointerEvents: "none",
        fontFamily: style.fontFamily,
        fontWeight: style.fontWeight,
        fontStyle: style.italic ? "italic" : "normal",
        textTransform: style.textTransform === "uppercase" ? "uppercase" : "none",
        fontSize: `${fontSizePx}px`,
        lineHeight: 1.25,
        animation: captionAnimCss,
        WebkitTextStroke: outlineCss,
        outline: wrapped.overflow ? "2px solid #ef4444" : undefined,
        outlineOffset: "6px",
      }}
    >
      {wrapped.lines.map((line, lineIdx) => (
        <div key={lineIdx} style={{ whiteSpace: "nowrap" }}>
          {line.map((text) => {
            const isHighlighted = wordCursor <= revealIdx;
            wordCursor += 1;
            const color = isHighlighted ? highlightColor : style.color;
            const glowCss = style.glow ? `0 0 20px ${color}` : undefined;
            const textShadow = [glowCss, shadowCss].filter(Boolean).join(", ") || undefined;
            return (
              <span key={wordCursor} style={{ color, textShadow }}>
                {text}{" "}
              </span>
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
