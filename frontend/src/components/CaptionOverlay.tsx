import { useMemo } from "react";

import type { PresetBase, Segment } from "../api/client";
import { wrapWords } from "../lib/captionFit";

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

function findActiveSegmentIndex(segments: Segment[], t: number): number {
  return segments.findIndex((seg) => {
    const first = seg.words[0];
    const last = seg.words.at(-1);
    if (!first || !last) {
      return false;
    }
    return t >= first.start && t <= last.end;
  });
}

// highlightColors cycles round-robin per segment (arch §6/§9, contract §8-9) — a length-1
// array naturally degrades to one fixed color for every segment.
function highlightColorFor(colors: string[], segmentIndex: number, fallback: string): string {
  if (colors.length === 0) {
    return fallback;
  }
  return colors[segmentIndex % colors.length] ?? fallback;
}

// Progressive reveal: last word whose start has passed. "phrase" mode ignores this and
// highlights the whole segment uniformly once active (§6/§9 revealMode).
function activeWordIndex(segment: Segment, t: number): number {
  let idx = -1;
  for (let i = 0; i < segment.words.length; i++) {
    const w = segment.words[i];
    if (w && w.start <= t) {
      idx = i;
    }
  }
  return idx;
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

  const wrapped = useMemo(() => {
    if (!activeSegment) {
      return null;
    }
    const measure = measureWidthFor(fontString);
    const maxWidth = containerWidth * HORIZONTAL_SAFE_WIDTH_FRACTION;
    return wrapWords(activeSegment.words, measure, maxWidth);
  }, [activeSegment, fontString, containerWidth]);

  if (!activeSegment || !wrapped) {
    return null;
  }

  const topPx = style.verticalPosition * containerHeight;
  const outOfSafeArea =
    style.verticalPosition < style.safeArea.top ||
    style.verticalPosition > 1 - style.safeArea.bottom;

  const revealIdx =
    style.revealMode === "progressive" ? activeWordIndex(activeSegment, currentTime) : Infinity;

  const highlightColor = highlightColorFor(style.highlightColors, activeIndex, style.color);
  let wordCursor = 0;

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
        fontSize: `${fontSizePx}px`,
        lineHeight: 1.25,
        outline: wrapped.overflow ? "2px solid #ef4444" : undefined,
        outlineOffset: "6px",
      }}
    >
      {wrapped.lines.map((line, lineIdx) => (
        <div key={lineIdx} style={{ whiteSpace: "nowrap" }}>
          {line.map((text) => {
            const isHighlighted = wordCursor <= revealIdx;
            wordCursor += 1;
            return (
              <span
                key={wordCursor}
                style={{ color: isHighlighted ? highlightColor : style.color }}
              >
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
