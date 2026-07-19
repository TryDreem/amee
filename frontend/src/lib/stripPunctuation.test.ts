import { describe, expect, it } from "vitest";

import { stripPunctuation } from "./stripPunctuation";

describe("stripPunctuation", () => {
  it("strips trailing sentence punctuation", () => {
    expect(stripPunctuation("Hello,")).toBe("Hello");
    expect(stripPunctuation("world.")).toBe("world");
    expect(stripPunctuation("really?!")).toBe("really");
  });

  it("removes ellipsis runs as a unit, not as a kept pause", () => {
    expect(stripPunctuation("wait...")).toBe("wait");
    expect(stripPunctuation("wait..")).toBe("wait");
  });

  it("strips em and en dashes", () => {
    expect(stripPunctuation("word—word")).toBe("wordword");
    expect(stripPunctuation("word–word")).toBe("wordword");
  });

  it("preserves apostrophes within a word", () => {
    expect(stripPunctuation("don't")).toBe("don't");
    expect(stripPunctuation("it's")).toBe("it's");
  });

  it("strips apostrophes not between two letters", () => {
    expect(stripPunctuation("'quote'")).toBe("quote");
  });

  it("preserves hyphens between two letters", () => {
    expect(stripPunctuation("well-known")).toBe("well-known");
  });

  it("strips hyphens not between two letters", () => {
    expect(stripPunctuation("-word")).toBe("word");
    expect(stripPunctuation("word-")).toBe("word");
  });

  it("drops a word to empty when it's pure punctuation", () => {
    expect(stripPunctuation("...")).toBe("");
    expect(stripPunctuation("!")).toBe("");
  });

  it("leaves words without punctuation unchanged", () => {
    expect(stripPunctuation("hello")).toBe("hello");
  });
});
