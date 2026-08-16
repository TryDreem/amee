import { describe, expect, it } from "vitest";

import type { CaptionAnimation, RevealMode } from "../api/client";
import { CAPTION_ANIMATIONS, findAnimationOption } from "./animations";

// Every value the wire format allows. Kept written out rather than derived, so that widening
// either enum in api-contract §8 fails here until the gallery is widened to match.
const REVEAL_MODES: RevealMode[] = ["phrase", "progressive", "single-word"];
const ANIMATIONS: CaptionAnimation[] = [
  "none",
  "fade",
  "pop",
  "bounce",
  "blur",
  "snap",
];

describe("CAPTION_ANIMATIONS", () => {
  it("offers a card for every revealMode x captionAnimation pair the wire format allows", () => {
    // The gallery used to cover only two of the three reveal modes, which left "phrase" — a mode
    // the contract has always had — unreachable from the UI.
    expect(CAPTION_ANIMATIONS).toHaveLength(REVEAL_MODES.length * ANIMATIONS.length);
    for (const revealMode of REVEAL_MODES) {
      for (const captionAnimation of ANIMATIONS) {
        expect(findAnimationOption(revealMode, captionAnimation)).toBeDefined();
      }
    }
  });

  it("keeps every (revealMode, captionAnimation) pair unique so a resolved style maps to one card", () => {
    const keys = CAPTION_ANIMATIONS.map((a) => `${a.revealMode}:${a.captionAnimation}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("writes only values the wire format already has — no card invents an enum member", () => {
    for (const a of CAPTION_ANIMATIONS) {
      expect(REVEAL_MODES).toContain(a.revealMode);
      expect(ANIMATIONS).toContain(a.captionAnimation);
    }
  });

  it("flags exactly the single-word cards as `single`", () => {
    for (const a of CAPTION_ANIMATIONS) {
      expect(a.revealMode === "single-word").toBe(a.single);
    }
  });
});

describe("findAnimationOption", () => {
  it("maps a progressive pair to its own card", () => {
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

  it("distinguishes phrase from progressive rather than collapsing them", () => {
    // These two reveal modes paint differently — `phrase` keeps every word visible and moves only
    // the highlight — so they must not share a card, or picking one would silently apply the
    // other's reveal mode.
    expect(findAnimationOption("phrase", "fade")?.id).toBe("phrase-fade");
    expect(findAnimationOption("progressive", "fade")?.id).toBe("fade");
  });
});
