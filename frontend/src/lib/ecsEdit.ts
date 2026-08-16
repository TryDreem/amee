import type { Segment, Word } from "../api/client";

// Distinct, edit-time-only limits (architecture.md §7.1) -- numerically the same today as
// the Initial Splitter's own private constants (backend/app/services/splitter.py), but a
// logically separate pair that this file owns independently.
export const EDIT_MAX_WORDS_PER_SEGMENT = 8;
export const EDIT_MAX_CHARS_PER_SEGMENT = 32;

// Frontend-only timestamp-estimation heuristic (INVARIANTS V6, E2) -- never sent to the
// backend as a validation rule.
const MIN_WORD_DURATION = 0.01;

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export interface WordRange {
  min: number;
  max: number;
}

// The range one word's start/end may move within. Rules (no invented gaps, no invented minimum
// duration -- adjacent words/segments may touch exactly, they just may not overlap):
//   - min = the previous word's END. For the first word of a segment, that's the previous
//     segment's last word's END (so a segment start can sit exactly on the previous segment's
//     end -- touching -- but never before it, which would overlap). No previous word/segment at
//     all -> 0 (times are never negative).
//   - max = the next word's START. For the last word of a segment, that's the next segment's
//     first word's START (touching allowed, overlap forbidden). Nothing after -> +Infinity
//     (unbounded above; the video duration is the only real ceiling and lives at runtime).
// A word at the edge of its segment is therefore held inside its segment by construction,
// because the neighbouring segment's edge word IS the bound -- there is no separately stored
// segment bound to cross (D5: segment bounds are derived from words, never stored).
export function wordRangeFor(segments: Segment[], segmentId: string, wordId: string): WordRange {
  const segIdx = segments.findIndex((s) => s.id === segmentId);
  const segment = segments[segIdx];
  if (!segment) {
    return { min: 0, max: 0 };
  }
  const wordIdx = segment.words.findIndex((w) => w.id === wordId);
  if (wordIdx === -1) {
    return { min: 0, max: 0 };
  }
  const prevWordInSeg = segment.words[wordIdx - 1];
  const nextWordInSeg = segment.words[wordIdx + 1];
  const prevSegLastWord = segments[segIdx - 1]?.words.at(-1);
  const nextSegFirstWord = segments[segIdx + 1]?.words[0];

  const min = prevWordInSeg ? prevWordInSeg.end : prevSegLastWord ? prevSegLastWord.end : 0;
  const max = nextWordInSeg
    ? nextWordInSeg.start
    : nextSegFirstWord
      ? nextSegFirstWord.start
      : Number.POSITIVE_INFINITY;
  return { min, max };
}

// Commits a typed start value for one word. Reverts to the word's current start (rather than
// erroring) when the input is unusable: not a number, before `min` (would overlap the previous
// word/segment), or after the word's own end (a word can't start after it ends). `v === min`
// and `v === word.end` are both allowed -- touching is fine, only crossing is not.
export function commitWordStart(segments: Segment[], segmentId: string, wordId: string, raw: string): Segment[] {
  const segment = segments.find((s) => s.id === segmentId);
  const word = segment?.words.find((w) => w.id === wordId);
  if (!segment || !word) {
    return segments;
  }
  const range = wordRangeFor(segments, segmentId, wordId);
  let v = parseFloat(raw);
  if (Number.isNaN(v) || v < range.min || v > word.end) {
    v = word.start;
  }
  v = round3(v);
  return segments.map((s) =>
    s.id === segmentId ? { ...s, words: s.words.map((w) => (w.id === wordId ? { ...w, start: v } : w)) } : s
  );
}

// Mirror of commitWordStart for the end: reverts when not a number, after `max` (would overlap
// the next word/segment), or before the word's own start. `v === max`/`v === word.start` allowed.
export function commitWordEnd(segments: Segment[], segmentId: string, wordId: string, raw: string): Segment[] {
  const segment = segments.find((s) => s.id === segmentId);
  const word = segment?.words.find((w) => w.id === wordId);
  if (!segment || !word) {
    return segments;
  }
  const range = wordRangeFor(segments, segmentId, wordId);
  let v = parseFloat(raw);
  if (Number.isNaN(v) || v > range.max || v < word.start) {
    v = word.end;
  }
  v = round3(v);
  return segments.map((s) =>
    s.id === segmentId ? { ...s, words: s.words.map((w) => (w.id === wordId ? { ...w, end: v } : w)) } : s
  );
}

export type AddWordResult = { segments: Segment[]; newWordId: string } | { error: "no_room" };

// Ported from the Claude Design source's addWordAt, adapted for this schema's D5 invariant:
// a Segment has no stored start/end, only words -- so there's no independent "scene bound"
// to draw extra room from at the very start/end of a segment (the design leaned on a
// separate `sceneBounds` field for that, which contradicts D5 and doesn't exist here). At an
// edge, the only room to borrow is the one real neighbor's own span -- modeled below by
// treating the missing bound as equal to the present one (a zero-width natural gap).
export function addWordAt(
  segments: Segment[],
  segmentId: string,
  wordId: string,
  side: "left" | "right"
): AddWordResult {
  const segment = segments.find((s) => s.id === segmentId);
  if (!segment) {
    return { error: "no_room" };
  }
  const idx = segment.words.findIndex((w) => w.id === wordId);
  if (idx === -1) {
    return { error: "no_room" };
  }

  const words = segment.words;
  const insertIdx = side === "left" ? idx : idx + 1;
  const prevItem = insertIdx > 0 ? words[insertIdx - 1] : undefined;
  const nextItem = insertIdx < words.length ? words[insertIdx] : undefined;

  let min = prevItem ? prevItem.end : nextItem ? nextItem.start : 0;
  let max = nextItem ? nextItem.start : prevItem ? prevItem.end : 0;

  const words2 = words.slice();
  let deficit = MIN_WORD_DURATION - (max - min);

  // Borrow from the right neighbor first, then the left -- matches the design's priority.
  if (deficit > 0 && nextItem) {
    const room = nextItem.end - nextItem.start - MIN_WORD_DURATION;
    const take = Math.max(0, Math.min(deficit, room));
    if (take > 0) {
      words2[insertIdx] = { ...nextItem, start: round3(nextItem.start + take) };
      max += take;
      deficit -= take;
    }
  }
  if (deficit > 0 && prevItem) {
    const room = prevItem.end - prevItem.start - MIN_WORD_DURATION;
    const take = Math.max(0, Math.min(deficit, room));
    if (take > 0) {
      words2[insertIdx - 1] = { ...prevItem, end: round3(prevItem.end - take) };
      min -= take;
      deficit -= take;
    }
  }

  if (deficit > 0.001) {
    return { error: "no_room" };
  }

  const newWord: Word = { id: crypto.randomUUID(), text: "", start: round3(min), end: round3(max) };
  words2.splice(insertIdx, 0, newWord);

  return {
    segments: segments.map((s) => (s.id === segmentId ? { ...s, words: words2 } : s)),
    newWordId: newWord.id,
  };
}

export type SplitSegmentResult = { segments: Segment[]; newSegmentId: string } | { noop: true };

// The clicked word stays the last word of the left (original-id) part; everything after it
// moves into a new segment with a fresh id. Both parts inherit the parent's `overrides`
// unchanged (architecture.md §7 Behavior Matrix) -- unlike the design source, there's no
// separate scene-bounds bookkeeping to update: Segment bounds are always derived from
// words[0].start/words.at(-1).end (D5), so nothing about timing needs adjusting here.
export function splitSegmentAt(segments: Segment[], segmentId: string, wordId: string): SplitSegmentResult {
  const segIdx = segments.findIndex((s) => s.id === segmentId);
  if (segIdx === -1) {
    return { noop: true };
  }
  const segment = segments[segIdx];
  if (!segment) {
    return { noop: true };
  }
  const wordIdx = segment.words.findIndex((w) => w.id === wordId);
  if (wordIdx === -1 || wordIdx === segment.words.length - 1) {
    return { noop: true }; // last word: nothing to split off
  }

  const leftWords = segment.words.slice(0, wordIdx + 1);
  const rightWords = segment.words.slice(wordIdx + 1);
  const newSegmentId = crypto.randomUUID();

  const leftSegment: Segment = { ...segment, words: leftWords };
  const rightSegment: Segment = { id: newSegmentId, words: rightWords, overrides: segment.overrides };

  const newSegments = segments.slice();
  newSegments.splice(segIdx, 1, leftSegment, rightSegment);

  return { segments: newSegments, newSegmentId };
}

// The segment and all of its words are removed entirely, not just cleared to empty
// (architecture.md §7 Behavior Matrix). Gated by an inline confirm in the UI, not here --
// this function itself has no confirmation step, matching addWordAt/splitSegmentAt's shape.
export function deleteSegment(segments: Segment[], segmentId: string): Segment[] {
  return segments.filter((s) => s.id !== segmentId);
}

// Removes a single word from its segment (the word popup's "Remove word" — distinct from
// deleting the whole segment). If that empties the segment, the segment is dropped too: a
// 0-word segment is never a valid state (same empty-segment rejection contract §7 already
// applies to whole-document PUT, so the frontend doesn't produce one either).
export function removeWord(segments: Segment[], segmentId: string, wordId: string): Segment[] {
  return segments.flatMap((s) => {
    if (s.id !== segmentId) {
      return [s];
    }
    const words = s.words.filter((w) => w.id !== wordId);
    return words.length > 0 ? [{ ...s, words }] : [];
  });
}

export type CommitWordResult =
  | { segments: Segment[]; kind: "kept" }
  | { segments: Segment[]; kind: "removed_empty" }
  | { segments: Segment[]; kind: "removed_limit"; limit: "words" | "chars" };

// On blur/Enter after "Add word": empty (or whitespace-only) text removes the word again;
// text that would push the segment over the edit-time limits (§7.1) also removes it, with
// `kind`/`limit` telling the caller which notice to show.
export function commitWordText(
  segments: Segment[],
  segmentId: string,
  wordId: string,
  rawText: string
): CommitWordResult {
  const trimmed = rawText.trim();
  const segment = segments.find((s) => s.id === segmentId);
  if (!segment) {
    return { segments, kind: "kept" };
  }

  const withoutPending = (s: Segment) => ({ ...s, words: s.words.filter((w) => w.id !== wordId) });

  if (!trimmed) {
    return {
      segments: segments.map((s) => (s.id === segmentId ? withoutPending(s) : s)),
      kind: "removed_empty",
    };
  }

  const nextWords = segment.words.map((w) => (w.id === wordId ? { ...w, text: trimmed } : w));
  if (nextWords.length > EDIT_MAX_WORDS_PER_SEGMENT) {
    return {
      segments: segments.map((s) => (s.id === segmentId ? withoutPending(s) : s)),
      kind: "removed_limit",
      limit: "words",
    };
  }
  const joined = nextWords.map((w) => w.text).join(" ");
  if (joined.length > EDIT_MAX_CHARS_PER_SEGMENT) {
    return {
      segments: segments.map((s) => (s.id === segmentId ? withoutPending(s) : s)),
      kind: "removed_limit",
      limit: "chars",
    };
  }

  return {
    segments: segments.map((s) => (s.id === segmentId ? { ...s, words: nextWords } : s)),
    kind: "kept",
  };
}
