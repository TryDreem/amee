import { describe, expect, it } from "vitest";

import {
  addWordAt,
  commitWordEnd,
  commitWordStart,
  commitWordText,
  deleteSegment,
  removeWord,
  splitSegmentAt,
  wordRangeFor,
  EDIT_MAX_CHARS_PER_SEGMENT,
  EDIT_MAX_WORDS_PER_SEGMENT,
} from "./ecsEdit";
import type { Segment } from "../api/client";

function seg(id: string, words: { id: string; text: string; start: number; end: number }[]): Segment {
  return { id, words };
}

describe("addWordAt", () => {
  it("fills the natural gap between two neighbors when it's already >= the minimum", () => {
    const segments = [
      seg("s1", [
        { id: "w1", text: "hello", start: 0, end: 0.4 },
        { id: "w2", text: "world", start: 0.7, end: 1.0 },
      ]),
    ];
    const result = addWordAt(segments, "s1", "w2", "left");
    if ("error" in result) throw new Error("expected success");

    const words = result.segments[0]?.words ?? [];
    expect(words).toHaveLength(3);
    expect(words[1]).toMatchObject({ id: result.newWordId, text: "", start: 0.4, end: 0.7 });
    // neighbors untouched -- the gap was already wide enough
    expect(words[0]).toMatchObject({ start: 0, end: 0.4 });
    expect(words[2]).toMatchObject({ start: 0.7, end: 1.0 });
  });

  it("borrows from the right neighbor first when the gap is too small", () => {
    const segments = [
      seg("s1", [
        { id: "w1", text: "hello", start: 0, end: 0.4 },
        { id: "w2", text: "world", start: 0.402, end: 1.0 }, // 0.002s gap, needs 0.01
      ]),
    ];
    const result = addWordAt(segments, "s1", "w2", "left");
    if ("error" in result) throw new Error("expected success");

    const words = result.segments[0]?.words ?? [];
    expect(words[1]?.start).toBe(0.4);
    expect(words[1]?.end).toBeCloseTo(0.41, 5);
    // w2 (right neighbor) gave up the 0.008s deficit, w1 untouched
    expect(words[0]).toMatchObject({ start: 0, end: 0.4 });
    expect(words[2]?.start).toBeCloseTo(0.41, 5);
  });

  it("borrows from the left neighbor once the right neighbor is at its own minimum", () => {
    const segments = [
      seg("s1", [
        { id: "w1", text: "hello", start: 0, end: 0.4 },
        // w2 is already exactly at MIN_WORD_DURATION -- no room to give on the right
        { id: "w2", text: "world", start: 0.4, end: 0.41 },
      ]),
    ];
    const result = addWordAt(segments, "s1", "w2", "left");
    if ("error" in result) throw new Error("expected success");

    const words = result.segments[0]?.words ?? [];
    expect(words[0]?.end).toBeCloseTo(0.39, 5); // w1 shrank by 0.01
    expect(words[1]).toMatchObject({ start: 0.39, end: 0.4 });
    expect(words[2]).toMatchObject({ start: 0.4, end: 0.41 }); // w2 untouched
  });

  it("borrows entirely from the one real neighbor when inserting at the start of a segment", () => {
    const segments = [seg("s1", [{ id: "w1", text: "hello", start: 1.0, end: 1.5 }])];
    const result = addWordAt(segments, "s1", "w1", "left");
    if ("error" in result) throw new Error("expected success");

    const words = result.segments[0]?.words ?? [];
    expect(words[0]).toMatchObject({ start: 1.0, end: 1.01 });
    expect(words[1]).toMatchObject({ start: 1.01, end: 1.5 }); // shrunk from the front
  });

  it("borrows entirely from the one real neighbor when inserting at the end of a segment", () => {
    const segments = [seg("s1", [{ id: "w1", text: "hello", start: 1.0, end: 1.5 }])];
    const result = addWordAt(segments, "s1", "w1", "right");
    if ("error" in result) throw new Error("expected success");

    const words = result.segments[0]?.words ?? [];
    expect(words[0]).toMatchObject({ start: 1.0, end: 1.49 }); // shrunk from the back
    expect(words[1]).toMatchObject({ start: 1.49, end: 1.5 });
  });

  it("fails with 'no_room' when neither neighbor can give up any duration", () => {
    const segments = [
      seg("s1", [
        { id: "w1", text: "hello", start: 0, end: 0.01 },
        { id: "w2", text: "world", start: 0.01, end: 0.02 },
      ]),
    ];
    const result = addWordAt(segments, "s1", "w2", "left");
    expect(result).toEqual({ error: "no_room" });
  });
});

describe("splitSegmentAt", () => {
  it("keeps the clicked word as the last word of the left part, moves the rest to a new segment", () => {
    const segments = [
      seg("s1", [
        { id: "w1", text: "hello", start: 0, end: 0.4 },
        { id: "w2", text: "there", start: 0.4, end: 0.8 },
        { id: "w3", text: "world", start: 0.8, end: 1.2 },
      ]),
    ];
    const result = splitSegmentAt(segments, "s1", "w2");
    if ("noop" in result) throw new Error("expected a real split");

    expect(result.segments).toHaveLength(2);
    expect(result.segments[0]).toMatchObject({ id: "s1", words: [{ id: "w1" }, { id: "w2" }] });
    expect(result.segments[1]).toMatchObject({ id: result.newSegmentId, words: [{ id: "w3" }] });
    expect(result.newSegmentId).not.toBe("s1");
  });

  it("does nothing when the clicked word is already the last word of the segment", () => {
    const segments = [
      seg("s1", [
        { id: "w1", text: "hello", start: 0, end: 0.4 },
        { id: "w2", text: "world", start: 0.4, end: 0.9 },
      ]),
    ];
    const result = splitSegmentAt(segments, "s1", "w2");
    expect(result).toEqual({ noop: true });
  });

  it("both parts inherit the parent's overrides unchanged", () => {
    const overrides = { fontSize: 0.1 };
    const segments: Segment[] = [
      {
        id: "s1",
        overrides,
        words: [
          { id: "w1", text: "hello", start: 0, end: 0.4 },
          { id: "w2", text: "world", start: 0.4, end: 0.9 },
        ],
      },
    ];
    const result = splitSegmentAt(segments, "s1", "w1");
    if ("noop" in result) throw new Error("expected a real split");

    expect(result.segments[0]?.overrides).toEqual(overrides);
    expect(result.segments[1]?.overrides).toEqual(overrides);
  });

  it("leaves other segments in the array untouched and correctly positioned", () => {
    const segments = [
      seg("s0", [{ id: "a1", text: "a", start: 0, end: 0.1 }]),
      seg("s1", [
        { id: "w1", text: "hello", start: 1, end: 1.4 },
        { id: "w2", text: "world", start: 1.4, end: 1.9 },
      ]),
      seg("s2", [{ id: "c1", text: "c", start: 2, end: 2.1 }]),
    ];
    const result = splitSegmentAt(segments, "s1", "w1");
    if ("noop" in result) throw new Error("expected a real split");

    expect(result.segments.map((s) => s.id)).toEqual(["s0", "s1", result.newSegmentId, "s2"]);
  });

  it("no-ops on an unknown segment or word id", () => {
    const segments = [seg("s1", [{ id: "w1", text: "hello", start: 0, end: 0.4 }])];
    expect(splitSegmentAt(segments, "missing", "w1")).toEqual({ noop: true });
    expect(splitSegmentAt(segments, "s1", "missing")).toEqual({ noop: true });
  });
});

describe("deleteSegment", () => {
  it("removes the segment and all of its words entirely", () => {
    const segments = [
      seg("s0", [{ id: "a1", text: "a", start: 0, end: 0.1 }]),
      seg("s1", [{ id: "w1", text: "hello", start: 1, end: 1.4 }]),
      seg("s2", [{ id: "c1", text: "c", start: 2, end: 2.1 }]),
    ];
    const result = deleteSegment(segments, "s1");
    expect(result.map((s) => s.id)).toEqual(["s0", "s2"]);
  });

  it("is a no-op when the segment id doesn't exist", () => {
    const segments = [seg("s0", [{ id: "a1", text: "a", start: 0, end: 0.1 }])];
    expect(deleteSegment(segments, "missing")).toEqual(segments);
  });
});

describe("removeWord", () => {
  it("removes just the one word, leaving the rest of the segment intact", () => {
    const segments = [
      seg("s1", [
        { id: "w1", text: "hello", start: 0, end: 0.4 },
        { id: "w2", text: "world", start: 0.4, end: 0.9 },
      ]),
    ];
    const result = removeWord(segments, "s1", "w1");
    expect(result).toHaveLength(1);
    expect(result[0]?.words.map((w) => w.id)).toEqual(["w2"]);
  });

  it("drops the whole segment when removing its only word would leave it empty", () => {
    const segments = [
      seg("s0", [{ id: "a1", text: "a", start: 0, end: 0.1 }]),
      seg("s1", [{ id: "w1", text: "hello", start: 1, end: 1.4 }]),
    ];
    const result = removeWord(segments, "s1", "w1");
    expect(result.map((s) => s.id)).toEqual(["s0"]);
  });
});

describe("wordRangeFor", () => {
  it("bounds a middle word by its immediate neighbors' edges (touching allowed, no gap)", () => {
    const segments = [
      seg("s1", [
        { id: "w1", text: "a", start: 0, end: 0.4 },
        { id: "w2", text: "b", start: 0.4, end: 0.9 },
        { id: "w3", text: "c", start: 0.9, end: 1.4 },
      ]),
    ];
    const range = wordRangeFor(segments, "s1", "w2");
    expect(range.min).toBeCloseTo(0.4, 5); // exactly the previous word's end, no gap
    expect(range.max).toBeCloseTo(0.9, 5); // exactly the next word's start, no gap
  });

  it("bounds the first word of a segment by the previous segment's last word's end (no gap)", () => {
    const segments = [
      seg("s0", [{ id: "a1", text: "a", start: 0, end: 0.4 }]),
      seg("s1", [{ id: "w1", text: "b", start: 1, end: 1.4 }]),
    ];
    expect(wordRangeFor(segments, "s1", "w1").min).toBeCloseTo(0.4, 5);
  });

  it("has no upper bound for the very last word of the very last segment", () => {
    const segments = [seg("s1", [{ id: "w1", text: "a", start: 0, end: 0.4 }])];
    expect(wordRangeFor(segments, "s1", "w1").max).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("commitWordStart / commitWordEnd", () => {
  const segments = [
    seg("s1", [
      { id: "w1", text: "a", start: 0, end: 0.4 },
      { id: "w2", text: "b", start: 0.4, end: 0.9 },
    ]),
  ];

  it("applies a valid new start within range", () => {
    const result = commitWordStart(segments, "s1", "w2", "0.5");
    expect(result[0]?.words[1]).toMatchObject({ start: 0.5 });
  });

  it("allows a start exactly equal to the previous word's end (touching, not overlapping)", () => {
    const result = commitWordStart(segments, "s1", "w2", "0.4");
    expect(result[0]?.words[1]).toMatchObject({ start: 0.4 });
  });

  it("reverts to the current start when the value would overlap the previous word", () => {
    const result = commitWordStart(segments, "s1", "w2", "0.1"); // 0.1 < w1.end (0.4)
    expect(result[0]?.words[1]).toMatchObject({ start: 0.4 });
  });

  it("reverts to the current start on unparseable input", () => {
    const result = commitWordStart(segments, "s1", "w2", "not-a-number");
    expect(result[0]?.words[1]).toMatchObject({ start: 0.4 });
  });

  it("applies a valid new end within range", () => {
    const result = commitWordEnd(segments, "s1", "w1", "0.35");
    expect(result[0]?.words[0]).toMatchObject({ end: 0.35 });
  });

  it("allows an end exactly equal to the next word's start (touching, not overlapping)", () => {
    const result = commitWordEnd(segments, "s1", "w1", "0.4");
    expect(result[0]?.words[0]).toMatchObject({ end: 0.4 });
  });

  it("reverts to the current end when the value would overlap the next word", () => {
    const result = commitWordEnd(segments, "s1", "w1", "0.85"); // 0.85 > w2.start (0.4)
    expect(result[0]?.words[0]).toMatchObject({ end: 0.4 });
  });
});

describe("commitWordText", () => {
  const base = [seg("s1", [{ id: "pending", text: "", start: 0, end: 0.1 }])];

  it("removes the word if the committed text is empty or whitespace-only", () => {
    const result = commitWordText(base, "s1", "pending", "   ");
    expect(result.kind).toBe("removed_empty");
    expect(result.segments[0]?.words).toHaveLength(0);
  });

  it("keeps the word with trimmed text when under both limits", () => {
    const result = commitWordText(base, "s1", "pending", "  hi  ");
    expect(result.kind).toBe("kept");
    expect(result.segments[0]?.words[0]).toMatchObject({ id: "pending", text: "hi" });
  });

  it("rejects and removes the word when it would exceed EDIT_MAX_WORDS_PER_SEGMENT", () => {
    const words = Array.from({ length: EDIT_MAX_WORDS_PER_SEGMENT }, (_, i) => ({
      id: `w${i}`,
      text: "x",
      start: i,
      end: i + 0.5,
    }));
    words.push({ id: "pending", text: "", start: 100, end: 100.1 });
    const segments = [seg("s1", words)];

    const result = commitWordText(segments, "s1", "pending", "one-too-many");
    expect(result.kind).toBe("removed_limit");
    if (result.kind === "removed_limit") expect(result.limit).toBe("words");
    expect(result.segments[0]?.words).toHaveLength(EDIT_MAX_WORDS_PER_SEGMENT);
  });

  it("rejects and removes the word when the joined text would exceed EDIT_MAX_CHARS_PER_SEGMENT", () => {
    const longText = "x".repeat(EDIT_MAX_CHARS_PER_SEGMENT + 1);
    const result = commitWordText(base, "s1", "pending", longText);
    expect(result.kind).toBe("removed_limit");
    if (result.kind === "removed_limit") expect(result.limit).toBe("chars");
    expect(result.segments[0]?.words).toHaveLength(0);
  });
});
