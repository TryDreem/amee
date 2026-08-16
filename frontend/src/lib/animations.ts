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

  // --- "Whole phrase" cards ----------------------------------------------------------------
  // `revealMode: "phrase"` keeps every word of the segment in the caption's base colour and moves
  // only the highlight — the classic karaoke look, and the third of the three reveal modes the
  // wire format has always had. Until these cards existed there was no way to pick it: every
  // gallery card wrote either `progressive` or `single-word`, so a documented mode was
  // unreachable from the UI.
  //
  // Nothing new reaches the wire here either — these are existing `captionAnimation` values
  // paired with the existing `revealMode` the gallery simply never offered. Adding a genuinely
  // new entrance (a wipe, a typewriter) would mean a new `CaptionAnimation` value, and that enum
  // is fixed by api-contract §8, so it needs the contract changed first.
  { id: "phrase-none", name: "Phrase · Static", single: false, revealMode: "phrase", captionAnimation: "none", ease: "ease-out" },
  { id: "phrase-fade", name: "Phrase · Fade Slide", single: false, revealMode: "phrase", captionAnimation: "fade", keyframe: "capFadeSlide", ease: "ease-out" },
  { id: "phrase-pop", name: "Phrase · Pop", single: false, revealMode: "phrase", captionAnimation: "pop", keyframe: "capPop", ease: "cubic-bezier(.34,1.56,.64,1)" },
  { id: "phrase-bounce", name: "Phrase · Bounce", single: false, revealMode: "phrase", captionAnimation: "bounce", keyframe: "capBounce", ease: "cubic-bezier(.36,1.9,.5,1)" },
  { id: "phrase-blur", name: "Phrase · Blur In", single: false, revealMode: "phrase", captionAnimation: "blur", keyframe: "capBlurIn", ease: "ease-out" },
  { id: "phrase-snap", name: "Phrase · Slide Snap", single: false, revealMode: "phrase", captionAnimation: "snap", keyframe: "capSlideSnap", ease: "cubic-bezier(.2,.9,.3,1.2)" },

  // The single-word entrances the gallery was missing, for the same reason: every value here
  // already exists, they just had no card. `single-static` in particular had no way to be
  // selected at all — one word at a time with no entrance is a common, deliberate look.
  { id: "single-static", name: "One Word · Static", single: true, revealMode: "single-word", captionAnimation: "none", ease: "ease-out" },
  { id: "single-fade", name: "One Word · Fade", single: true, revealMode: "single-word", captionAnimation: "fade", keyframe: "capFadeSlide", ease: "ease-out" },
  { id: "single-blur", name: "One Word · Blur", single: true, revealMode: "single-word", captionAnimation: "blur", keyframe: "capBlurIn", ease: "ease-out" },
];

// Which gallery card a resolved (revealMode, captionAnimation) pair corresponds to. Matched on
// `revealMode` itself, not on the `single` flag: once "phrase" cards exist, `progressive` and
// `phrase` are both non-single and carry the same six `captionAnimation` values, so the flag no
// longer identifies a card on its own. There is exactly one card per (revealMode,
// captionAnimation) pair, which makes this unambiguous again.
//
// Returns undefined for a pair no card covers — nothing is highlighted, nothing plays.
export function findAnimationOption(
  revealMode: RevealMode,
  captionAnimation: CaptionAnimation
): AnimationOption | undefined {
  return CAPTION_ANIMATIONS.find(
    (a) => a.revealMode === revealMode && a.captionAnimation === captionAnimation
  );
}
