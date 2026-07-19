import { describe, expect, it } from "vitest";

import { addWordAt, commitWordText, EDIT_MAX_CHARS_PER_SEGMENT, EDIT_MAX_WORDS_PER_SEGMENT } from "./ecsEdit";
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
