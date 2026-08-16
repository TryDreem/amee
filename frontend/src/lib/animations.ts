import type { CaptionAnimation, RevealMode } from "../api/client";

// The design's ANIMATIONS_D (`Video Subtitle Editor.dc.html`): one gallery that folds together
// the two real wire fields. Six multi-word cards set `captionAnimation` (the cosmetic entrance)
// while keeping `revealMode: "progressive"`; six "One Word · …" cards flip `revealMode` to
// "single-word" and pick their own entrance. Nothing here changes the wire contract — every card
// maps onto values that already exist in `CaptionAnimation`/`RevealMode`. The single-word cards
// deliberately reuse the pop/bounce/fade/blur/snap `captionAnimation` values but render distinct
// keyframes in single-word mode (capWord*), exactly as the design does.
//
// No "phrase" cards: `revealMode: "phrase"` combined with any `captionAnimation` here would just
// be the same entrance already offered under "progressive", relabeled — not a visually distinct
// option, so not a real gallery entry. It's still a valid wire value (a preset can use it), see
// `findAnimationOption` below for how that resolves.
export interface AnimationOption {
  // Stable id — favorites key and, for the overlay, which keyframe to play.
  id: string;
  // English label, as in the design (ANIMATIONS_D names are not localized there either).
  name: string;
  // True for the "One Word · …" cards (single-word reveal).
  single: boolean;
  // What a click on this card writes.
  revealMode: RevealMode;
  captionAnimation: CaptionAnimation;
  // CSS @keyframes name (index.css); undefined = no entrance animation.
  keyframe?: string;
  ease: string;
}

export const CAPTION_ANIMATIONS: AnimationOption[] = [
  { id: "none", name: "No animation", single: false, revealMode: "progressive", captionAnimation: "none", ease: "ease-out" },
  { id: "fade", name: "Fade Slide", single: false, revealMode: "progressive", captionAnimation: "fade", keyframe: "capFadeSlide", ease: "ease-out" },
  { id: "pop", name: "Pop", single: false, revealMode: "progressive", captionAnimation: "pop", keyframe: "capPop", ease: "cubic-bezier(.34,1.56,.64,1)" },
  { id: "bounce", name: "Bounce Scale-in", single: false, revealMode: "progressive", captionAnimation: "bounce", keyframe: "capBounce", ease: "cubic-bezier(.36,1.9,.5,1)" },
  { id: "blur", name: "Blur Focus-in", single: false, revealMode: "progressive", captionAnimation: "blur", keyframe: "capBlurIn", ease: "ease-out" },
  { id: "snap", name: "Slide-up Snap", single: false, revealMode: "progressive", captionAnimation: "snap", keyframe: "capSlideSnap", ease: "cubic-bezier(.2,.9,.3,1.2)" },
  { id: "single-pop", name: "One Word · Pop", single: true, revealMode: "single-word", captionAnimation: "pop", keyframe: "capWordPop", ease: "cubic-bezier(.34,1.56,.64,1)" },
  { id: "single-punch", name: "One Word · Punch", single: true, revealMode: "single-word", captionAnimation: "bounce", keyframe: "capWordPunch", ease: "cubic-bezier(.16,1,.3,1)" },
  { id: "single-slide", name: "One Word · Slide Up", single: true, revealMode: "single-word", captionAnimation: "snap", keyframe: "capWordSlideUp", ease: "cubic-bezier(.22,1,.36,1)" },

  // The single-word entrances the gallery was missing, for the same reason: every value here
  // already exists, they just had no card. `single-static` in particular had no way to be
  // selected at all — one word at a time with no entrance is a common, deliberate look.
  { id: "single-static", name: "One Word · Static", single: true, revealMode: "single-word", captionAnimation: "none", ease: "ease-out" },
  { id: "single-fade", name: "One Word · Fade", single: true, revealMode: "single-word", captionAnimation: "fade", keyframe: "capFadeSlide", ease: "ease-out" },
  { id: "single-blur", name: "One Word · Blur", single: true, revealMode: "single-word", captionAnimation: "blur", keyframe: "capBlurIn", ease: "ease-out" },
];

// Which gallery card a resolved (revealMode, captionAnimation) pair corresponds to. Matched on
// the `single` flag, not on `revealMode` itself: the gallery only ever writes "progressive" or
// "single-word", so the flag identifies a card on its own. "phrase" isn't reachable from this
// gallery (see the module comment), but a document that has it anyway — a preset, or one saved
// before this session — still needs its `captionAnimation` to resolve to *something* playable,
// so it falls back to the same cards "progressive" uses rather than resolving to undefined.
export function findAnimationOption(
  revealMode: RevealMode,
  captionAnimation: CaptionAnimation
): AnimationOption | undefined {
  const single = revealMode === "single-word";
  return CAPTION_ANIMATIONS.find(
    (a) => a.single === single && a.captionAnimation === captionAnimation
  );
}
