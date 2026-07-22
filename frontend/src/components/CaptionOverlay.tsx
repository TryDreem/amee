import { Fragment, useMemo } from "react";

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
  // Entrance animations only play during playback — on a paused/seeked frame words are shown
  // static, matching the design (which gates its per-word animation on `isPlaying`). Optional so
  // the read-only/test render path can omit it.
  isPlaying?: boolean;
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
  isPlaying = false,
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

  // Entrance animation (design ANIMATIONS_D). Multi-word: each word plays the keyframe staggered
  // by its own start time, so the phrase builds up word by word during playback. Single-word: the
  // one rendered word plays its capWord* keyframe. Both gate on isPlaying — a paused/seeked frame
  // shows the words static (no re-triggering the build on every scrub).
  const anim = findAnimationOption(style.revealMode, style.captionAnimation);
  const segmentStart = activeSegment.words[0]?.start ?? 0;
  const wordAnimationCss = (wordStart: number, textLength: number): string | undefined => {
    if (!isPlaying || !anim || !anim.keyframe) {
      return undefined;
    }
    if (isSingleWord) {
      return `${anim.keyframe} ${SINGLE_WORD_ANIMATION_DURATION_MS}ms ${anim.ease} both`;
    }
    const durationMs = Math.max(220, textLength * 60);
    const delayMs = Math.max(0, (wordStart - segmentStart) * 1000);
    return `${anim.keyframe} ${durationMs}ms ${anim.ease} ${delayMs}ms both`;
  };

  return (
    <div
      // Single-word mode remounts per active word (so the entrance replays for each new word);
      // multi-word remounts per segment (so the staggered per-word build replays on entry). A
      // re-render alone won't restart an already-applied CSS keyframe — only a fresh mount does.
      key={isSingleWord ? `${activeSegment.id}:${activeWordIdx}` : activeSegment.id}
      style={{
        position: "absolute",
        left: "50%",
        top: `${topPx}px`,
        transform: "translate(-50%, -50%)",
        maxWidth: `${containerWidth * HORIZONTAL_SAFE_WIDTH_FRACTION}px`,
        textAlign: "center",
        pointerEvents: "none",
        fontFamily: cssFamily,
        fontWeight: style.fontWeight,
        fontStyle: style.italic ? "italic" : "normal",
        textTransform: style.textTransform === "uppercase" ? "uppercase" : "none",
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
            const animation = word ? wordAnimationCss(word.start, text.length) : undefined;
            wordCursor += 1;
            const color = isHighlighted ? highlightColor : style.color;
            const glowCss = style.glow ? `0 0 20px ${color}` : undefined;
            const textShadow = [glowCss, shadowCss].filter(Boolean).join(", ") || undefined;
            // The inter-word space lives BETWEEN the spans, not inside them: each word span is
            // display:inline-block (required for the per-word transform keyframes to apply — CSS
            // transforms are ignored on plain inline elements), and an inline-block trims its own
            // trailing whitespace as end-of-line, so a space kept inside the span would vanish and
            // the words would run together.
            return (
              <Fragment key={wordCursor}>
                {wordInLine > 0 ? " " : null}
                <span style={{ color, textShadow, display: "inline-block", animation }}>{text}</span>
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
