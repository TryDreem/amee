import type { Segment } from "../api/client";

// Shared between CaptionOverlay (the burned-in preview) and CaptionsPanel (the editing list)
// so "what's active right now" is computed identically in both places.
export function findActiveSegmentIndex(segments: Segment[], t: number): number {
  return segments.findIndex((seg) => {
    const first = seg.words[0];
    const last = seg.words.at(-1);
    if (!first || !last) {
      return false;
    }
    return t >= first.start && t <= last.end;
  });
}

// Last word whose start has passed — used by CaptionOverlay for "progressive" reveal, and by
// CaptionsPanel unconditionally (the list's own bold/underline cue is a playback-position aid,
// not a reveal-mode rendering, so it isn't gated by revealMode).
export function activeWordIndexInSegment(segment: Segment, t: number): number {
  let idx = -1;
  for (let i = 0; i < segment.words.length; i++) {
    const w = segment.words[i];
    if (w && w.start <= t) {
      idx = i;
    }
  }
  return idx;
}

// highlightColors cycles round-robin per segment (arch §6/§9, contract §8-9) — a length-1
// array naturally degrades to one fixed color for every segment.
export function highlightColorFor(colors: string[], segmentIndex: number, fallback: string): string {
  if (colors.length === 0) {
    return fallback;
  }
  return colors[segmentIndex % colors.length] ?? fallback;
}
