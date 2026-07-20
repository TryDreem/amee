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

  const fontSizePx = style.fontSize * containerHeight;
  const fontString = `${style.fontWeight} ${fontSizePx}px ${style.fontFamily}`;

  // showPunctuation: false (default) strips displayed punctuation; Word.text itself is never
  // touched (S7) — a word that strips to empty still occupies its own timeline slot/wrap
  // position, it's just rendered blank, never removed from the array.
  const displayWords = useMemo(() => {
    if (!activeSegment) {
      return null;
    }
    return style.showPunctuation
      ? activeSegment.words
      : activeSegment.words.map((w) => ({ ...w, text: stripPunctuation(w.text) }));
  }, [activeSegment, style.showPunctuation]);

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

  const revealIdx =
    style.revealMode === "progressive" ? activeWordIndexInSegment(activeSegment, currentTime) : Infinity;

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

  return (
    <div
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
