import { describe, expect, it } from "vitest";

import type { CaptionAnimation } from "../api/client";
import { CAPTION_ANIMATIONS, findAnimationOption } from "./animations";

describe("CAPTION_ANIMATIONS", () => {
  it("has one card per animation and no duplicates", () => {
    const values = CAPTION_ANIMATIONS.map((a) => a.captionAnimation);
    expect(new Set(values).size).toBe(values.length);
  });

  it("gives every card a real keyframe except 'No animation'", () => {
    for (const a of CAPTION_ANIMATIONS) {
      if (a.captionAnimation === "none") {
        expect(a.keyframe).toBeUndefined();
      } else {
        expect(a.keyframe).toBeTruthy();
      }
    }
  });

  it("carries no revealMode — the reveal control owns that field", () => {
    // The gallery used to write revealMode too, which made most animations reachable in exactly
    // one reveal mode and silently flipped a single-word segment back to whole-phrase whenever
    // its animation was changed.
    for (const a of CAPTION_ANIMATIONS) {
      expect(a).not.toHaveProperty("revealMode");
      expect(a).not.toHaveProperty("single");
    }
  });
});

describe("findAnimationOption", () => {
  it("resolves an animation to its card", () => {
    const a = findAnimationOption("pop");
    expect(a?.id).toBe("pop");
    expect(a?.keyframe).toBe("capPop");
  });

  it("resolves every animation that has a card, independently of reveal mode", () => {
    // The regression this guards: with the old two-argument lookup, "single-word" resolved only
    // pop/bounce/snap and returned undefined for the other 27 — captions in that mode then
    // rendered with no entrance at all.
    for (const a of CAPTION_ANIMATIONS) {
      expect(findAnimationOption(a.captionAnimation)?.id).toBe(a.id);
    }
  });

  it("returns undefined for an animation with no card yet", () => {
    // The four values that exist on the wire but have no renderer yet (contract §8).
    for (const pending of [
      "karaokeFill",
      "karaokeBox",
      "typewriter",
      "letterCascade",
    ] as CaptionAnimation[]) {
      expect(findAnimationOption(pending)).toBeUndefined();
    }
  });
});
