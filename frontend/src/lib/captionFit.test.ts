import { describe, expect, it } from "vitest";

import { wrapWords } from "./captionFit";

// A fake measurer: width = character count, so expected breakpoints are easy to reason about.
const measureChars = (text: string) => text.length;

describe("wrapWords", () => {
  it("keeps everything on one line when it fits", () => {
    const result = wrapWords([{ text: "hello" }, { text: "world" }], measureChars, 20);
    expect(result).toEqual({ lines: [["hello", "world"]], overflow: false });
  });

  it("wraps to a second line only between words, never mid-word", () => {
    // "hello world" is 11 chars, doesn't fit in 8; "hello" alone (5) does.
    const result = wrapWords([{ text: "hello" }, { text: "world" }], measureChars, 8);
    expect(result).toEqual({ lines: [["hello"], ["world"]], overflow: false });
  });

  it("flags overflow when a 3rd line would be required, capping at 2 lines", () => {
    const words = [{ text: "one" }, { text: "two" }, { text: "three" }, { text: "four" }];
    // Each word forces its own line at this width.
    const result = wrapWords(words, measureChars, 3);
    expect(result.lines).toHaveLength(2);
    expect(result.overflow).toBe(true);
  });

  it("never splits a single word across lines, but reports it as overflow", () => {
    // L2 forbids breaking inside a word, so the line stays whole — but it does not fit, and
    // saying `overflow: false` would leave the user with a caption running past the safe area
    // and no warning. A line break cannot fix this one; only a smaller font or an edit can, which
    // is precisely what the overflow state exists to tell them (L4).
    const result = wrapWords([{ text: "supercalifragilistic" }], measureChars, 5);
    expect(result.lines).toEqual([["supercalifragilistic"]]);
    expect(result.overflow).toBe(true);
  });

  it("does not flag overflow when every word fits on its own", () => {
    const result = wrapWords([{ text: "aaa" }, { text: "bbb" }], measureChars, 3);
    expect(result.lines).toEqual([["aaa"], ["bbb"]]);
    expect(result.overflow).toBe(false);
  });

  it("handles an empty word list", () => {
    const result = wrapWords([], measureChars, 100);
    expect(result).toEqual({ lines: [[]], overflow: false });
  });
});
