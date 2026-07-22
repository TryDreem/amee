import { describe, expect, it } from "vitest";

import { cssFontFamily, FONT_OPTIONS, fontName } from "./fonts";

describe("fontName", () => {
  it("passes a bare family name through unchanged", () => {
    expect(fontName("Golos Text")).toBe("Golos Text");
  });

  // The export path writes this value into a comma-separated ASS `Style:` line, so a stored CSS
  // stack adds a field there and libass drops the whole style — the burned video comes out with
  // no captions. Legacy documents hold exactly that, hence the collapse.
  it("collapses a legacy CSS stack to its first family, without quotes", () => {
    expect(fontName("'Golos Text', sans-serif")).toBe("Golos Text");
    expect(fontName('"Playfair Display", serif')).toBe("Playfair Display");
    expect(fontName("Inter, sans-serif")).toBe("Inter");
  });

  it("is idempotent", () => {
    expect(fontName(fontName("'Rubik Spray Paint', cursive"))).toBe("Rubik Spray Paint");
  });
});

describe("cssFontFamily", () => {
  it("quotes the family and appends that font's own generic fallback", () => {
    expect(cssFontFamily("Playfair Display")).toBe("'Playfair Display', serif");
    expect(cssFontFamily("Alex Brush")).toBe("'Alex Brush', cursive");
    expect(cssFontFamily("Inter")).toBe("'Inter', sans-serif");
  });

  it("rebuilds the same stack from a legacy value", () => {
    expect(cssFontFamily("'Golos Text', sans-serif")).toBe(cssFontFamily("Golos Text"));
  });

  it("falls back to sans-serif for a family that isn't in the gallery", () => {
    expect(cssFontFamily("Comic Sans MS")).toBe("'Comic Sans MS', sans-serif");
  });
});

describe("FONT_OPTIONS", () => {
  // A comma here is the exact bug that silently produced caption-less exports.
  it("stores every family as a single bare name — no commas, no quotes", () => {
    for (const font of FONT_OPTIONS) {
      expect(font.family).not.toMatch(/[,'"]/);
      expect(font.family.trim()).toBe(font.family);
    }
  });
});
