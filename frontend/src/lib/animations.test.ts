import { describe, expect, it } from "vitest";

import { CAPTION_ANIMATIONS, findAnimationOption } from "./animations";

describe("CAPTION_ANIMATIONS", () => {
  it("has the 9 design cards: 6 multi-word + 3 single-word", () => {
    expect(CAPTION_ANIMATIONS).toHaveLength(9);
    expect(CAPTION_ANIMATIONS.filter((a) => a.single)).toHaveLength(3);
    expect(CAPTION_ANIMATIONS.filter((a) => !a.single)).toHaveLength(6);
  });

  it("keeps every (single, captionAnimation) pair unique so a resolved style maps to one card", () => {
    const keys = CAPTION_ANIMATIONS.map((a) => `${a.single}:${a.captionAnimation}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("single-word cards write revealMode single-word; multi-word cards do not", () => {
    for (const a of CAPTION_ANIMATIONS) {
      expect(a.revealMode === "single-word").toBe(a.single);
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

  it("matches a multi-word animation regardless of phrase vs progressive revealMode", () => {
    expect(findAnimationOption("phrase", "fade")?.id).toBe("fade");
    expect(findAnimationOption("progressive", "fade")?.id).toBe("fade");
  });

  it("returns undefined for a pair no card produces (single-word + fade)", () => {
    expect(findAnimationOption("single-word", "fade")).toBeUndefined();
  });
});
