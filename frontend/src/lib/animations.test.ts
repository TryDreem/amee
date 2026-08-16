import { describe, expect, it } from "vitest";

import { CAPTION_ANIMATIONS, findAnimationOption } from "./animations";

describe("CAPTION_ANIMATIONS", () => {
  it("has 6 multi-word cards and 6 single-word cards, no duplicates of either", () => {
    // No "phrase" cards: revealMode "phrase" paired with any captionAnimation plays the exact
    // same entrance "progressive" already offers under that captionAnimation value — relabeling
    // it "Phrase · X" is not a distinct option, so it doesn't get a gallery entry.
    expect(CAPTION_ANIMATIONS).toHaveLength(12);
    expect(CAPTION_ANIMATIONS.filter((a) => a.single)).toHaveLength(6);
    expect(CAPTION_ANIMATIONS.filter((a) => !a.single)).toHaveLength(6);
  });

  it("keeps every (single, captionAnimation) pair unique so a resolved style maps to one card", () => {
    const keys = CAPTION_ANIMATIONS.map((a) => `${a.single}:${a.captionAnimation}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("single-word cards write revealMode single-word; multi-word cards write progressive", () => {
    for (const a of CAPTION_ANIMATIONS) {
      expect(a.revealMode).toBe(a.single ? "single-word" : "progressive");
    }
  });
});

describe("findAnimationOption", () => {
  it("maps a multi-word pair to its multi-word card", () => {
    const a = findAnimationOption("progressive", "pop");
    expect(a?.id).toBe("pop");
    expect(a?.keyframe).toBe("capPop");
  });

  it("maps a single-word pair to the distinct capWord* card", () => {
    expect(findAnimationOption("single-word", "pop")?.id).toBe("single-pop");
    expect(findAnimationOption("single-word", "pop")?.keyframe).toBe("capWordPop");
    expect(findAnimationOption("single-word", "bounce")?.id).toBe("single-punch");
    expect(findAnimationOption("single-word", "snap")?.id).toBe("single-slide");
  });

  it("falls back to the progressive card for revealMode 'phrase' (no gallery card of its own)", () => {
    // "phrase" isn't a gallery selection, but a document can still carry it (e.g. a preset), and
    // its captionAnimation must still resolve to a playable entrance rather than nothing.
    expect(findAnimationOption("phrase", "fade")?.id).toBe("fade");
    expect(findAnimationOption("progressive", "fade")?.id).toBe("fade");
  });

  it("returns undefined for a pair no card produces (single-word + snap is taken; unknown stays unmatched only if the value itself is invalid)", () => {
    // Every real CaptionAnimation value now has both a single and multi card, so there is no
    // longer a reachable "undefined" case from valid wire values alone.
    for (const value of ["none", "fade", "pop", "bounce", "blur", "snap"] as const) {
      expect(findAnimationOption("single-word", value)).toBeDefined();
      expect(findAnimationOption("progressive", value)).toBeDefined();
    }
  });
});
