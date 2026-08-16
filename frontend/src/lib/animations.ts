import type { CaptionAnimation, RevealMode } from "../api/client";

// The design's ANIMATIONS_D (`Video Subtitle Editor.dc.html`): one 9-card gallery that folds
// together the two real wire fields. Six multi-word cards set `captionAnimation` (the cosmetic
// entrance) while keeping `revealMode: "progressive"`; three "One Word · …" cards flip
// `revealMode` to "single-word" and pick their own entrance. Nothing here changes the wire
// contract — every card maps onto values that already exist in `CaptionAnimation`/`RevealMode`.
// The single-word cards deliberately reuse the pop/bounce/snap `captionAnimation` values but
// render distinct keyframes in single-word mode (capWord*), exactly as the design does.
//
// No "phrase" cards, and no "single-word + none/fade/blur" cards: both would just replay an
// entrance the gallery already offers under "progressive" or another single-word card, relabeled
// — not a visually distinct option, so not a real gallery entry.
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

  // --- 22 additional progressive-mode entrances (design handoff, "Caption Animations - Phrases
  // 30.dc.html") -----------------------------------------------------------------------------
  // No single-word counterparts: the handoff's own "Word Based 8" catalog only adds karaoke and
  // typewriter beyond the original five (see below), not extra single-word variants of these —
  // inventing 22 more cards nobody asked for is exactly the kind of unrequested padding removed
  // from this file already once.
  { id: "fadeSimple", name: "Fade Simple", single: false, revealMode: "progressive", captionAnimation: "fadeSimple", keyframe: "capFadeSimple", ease: "ease-out" },
  { id: "fadeScale", name: "Fade + Scale", single: false, revealMode: "progressive", captionAnimation: "fadeScale", keyframe: "capFadeScale", ease: "ease-out" },
  { id: "fadeBlur", name: "Fade + Blur", single: false, revealMode: "progressive", captionAnimation: "fadeBlur", keyframe: "capFadeBlur", ease: "ease-out" },
  { id: "slideUp", name: "Slide Up", single: false, revealMode: "progressive", captionAnimation: "slideUp", keyframe: "capSlideUp", ease: "ease-out" },
  { id: "slideDown", name: "Slide Down", single: false, revealMode: "progressive", captionAnimation: "slideDown", keyframe: "capSlideDown", ease: "ease-out" },
  { id: "slideLeft", name: "Slide Left", single: false, revealMode: "progressive", captionAnimation: "slideLeft", keyframe: "capSlideLeft", ease: "ease-out" },
  { id: "slideRight", name: "Slide Right", single: false, revealMode: "progressive", captionAnimation: "slideRight", keyframe: "capSlideRight", ease: "ease-out" },
  { id: "zoomOut", name: "Zoom Out In", single: false, revealMode: "progressive", captionAnimation: "zoomOut", keyframe: "capZoomOut", ease: "ease-out" },
  { id: "rotateIn", name: "Rotate In", single: false, revealMode: "progressive", captionAnimation: "rotateIn", keyframe: "capRotateIn", ease: "ease-out" },
  { id: "tiltIn", name: "Tilt In (3D)", single: false, revealMode: "progressive", captionAnimation: "tiltIn", keyframe: "capTiltIn", ease: "ease-out" },
  { id: "swingPendulum", name: "Swing Pendulum", single: false, revealMode: "progressive", captionAnimation: "swingPendulum", keyframe: "capSwingPendulum", ease: "ease-out" },
  { id: "springElastic", name: "Spring Elastic", single: false, revealMode: "progressive", captionAnimation: "springElastic", keyframe: "capSpringElastic", ease: "ease-out" },
  { id: "jellySquash", name: "Jelly Squash", single: false, revealMode: "progressive", captionAnimation: "jellySquash", keyframe: "capJellySquash", ease: "ease-out" },
  { id: "flipX", name: "Flip X", single: false, revealMode: "progressive", captionAnimation: "flipX", keyframe: "capFlipX", ease: "ease-out" },
  { id: "flipY", name: "Flip Y", single: false, revealMode: "progressive", captionAnimation: "flipY", keyframe: "capFlipY", ease: "ease-out" },
  { id: "perspectiveDrop", name: "Perspective Drop", single: false, revealMode: "progressive", captionAnimation: "perspectiveDrop", keyframe: "capPerspectiveDrop", ease: "ease-out" },
  { id: "wipeReveal", name: "Wipe Reveal", single: false, revealMode: "progressive", captionAnimation: "wipeReveal", keyframe: "capWipeReveal", ease: "ease-out" },
  { id: "circleReveal", name: "Circle Reveal", single: false, revealMode: "progressive", captionAnimation: "circleReveal", keyframe: "capCircleReveal", ease: "ease-out" },
  { id: "curtainReveal", name: "Curtain Reveal", single: false, revealMode: "progressive", captionAnimation: "curtainReveal", keyframe: "capCurtainReveal", ease: "ease-out" },
  { id: "punchIn", name: "Punch In", single: false, revealMode: "progressive", captionAnimation: "punchIn", keyframe: "capPunchIn", ease: "ease-out" },
  { id: "shakeSettle", name: "Shake Settle", single: false, revealMode: "progressive", captionAnimation: "shakeSettle", keyframe: "capShakeSettle", ease: "ease-out" },
  { id: "neonGlow", name: "Neon Glow In", single: false, revealMode: "progressive", captionAnimation: "neonGlow", keyframe: "capNeonGlow", ease: "ease-out" },
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
