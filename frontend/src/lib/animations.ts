import type { CaptionAnimation, RevealMode } from "../api/client";

// The design's ANIMATIONS_D (`Video Subtitle Editor.dc.html`): one 9-card gallery that folds
// together the two real wire fields. Six multi-word cards set `captionAnimation` (the cosmetic
// entrance) while keeping a non-single `revealMode`; three "One Word · …" cards flip
// `revealMode` to "single-word" and pick their own entrance. Nothing here changes the wire
// contract — every card maps onto values that already exist in `CaptionAnimation`/`RevealMode`.
// The single-word cards deliberately reuse the pop/bounce/snap `captionAnimation` values but
// render distinct keyframes in single-word mode (capWord*), exactly as the design does.
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
];

// Which gallery card a resolved (revealMode, captionAnimation) pair corresponds to. Single vs
// multi is disjoint by revealMode, and each side has one card per captionAnimation, so this is
// unambiguous. Returns undefined for a pair no card produces (e.g. a preset base with
// revealMode "single-word" + captionAnimation "fade") — nothing is highlighted, nothing plays.
export function findAnimationOption(
  revealMode: RevealMode,
  captionAnimation: CaptionAnimation
): AnimationOption | undefined {
  const single = revealMode === "single-word";
  return CAPTION_ANIMATIONS.find((a) => a.single === single && a.captionAnimation === captionAnimation);
}
