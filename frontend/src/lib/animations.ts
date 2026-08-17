import type { CaptionAnimation } from "../api/client";

// One card per `captionAnimation` value, and nothing else — `revealMode` is a separate control in
// the style panel.
//
// The design's original ANIMATIONS_D gallery folded both fields into one 9-card list: six cards
// wrote `revealMode: "progressive"` and three "One Word · …" cards wrote `"single-word"` plus
// their own entrance. That works at nine cards and breaks at thirty: only three animations had a
// single-word card, so a segment set to single-word could not change its animation without being
// dragged back to whole-phrase, and 27 of 30 animations were unreachable in that mode entirely.
//
// Splitting them makes every (revealMode x captionAnimation) combination reachable without adding
// a single wire value — the two fields were always independent in the contract (§8, INVARIANTS
// S8: "orthogonal to revealMode"); only this gallery pretended otherwise. The capWord* keyframes
// the three single-word cards used are gone with them: an entrance should look like itself
// regardless of how many words are on screen.
export interface AnimationOption {
  // Stable id — favorites key and, for the overlay, which keyframe to play.
  id: string;
  // English label, as in the design (ANIMATIONS_D names are not localized there either).
  name: string;
  // What a click on this card writes. `revealMode` is deliberately not here.
  captionAnimation: CaptionAnimation;
  // CSS @keyframes name (captionAnimations.css); undefined = no entrance animation.
  keyframe?: string;
  ease: string;
}

export const CAPTION_ANIMATIONS: AnimationOption[] = [
  { id: "none", name: "No animation", captionAnimation: "none", ease: "ease-out" },
  { id: "fade", name: "Fade Slide", captionAnimation: "fade", keyframe: "capFadeSlide", ease: "ease-out" },
  { id: "pop", name: "Pop", captionAnimation: "pop", keyframe: "capPop", ease: "cubic-bezier(.34,1.56,.64,1)" },
  { id: "bounce", name: "Bounce Scale-in", captionAnimation: "bounce", keyframe: "capBounce", ease: "cubic-bezier(.36,1.9,.5,1)" },
  { id: "blur", name: "Blur Focus-in", captionAnimation: "blur", keyframe: "capBlurIn", ease: "ease-out" },
  { id: "snap", name: "Slide-up Snap", captionAnimation: "snap", keyframe: "capSlideSnap", ease: "cubic-bezier(.2,.9,.3,1.2)" },

  // --- 22 additional entrances (design handoff, "Caption Animations - Phrases 30.dc.html") ---
  { id: "fadeSimple", name: "Fade Simple", captionAnimation: "fadeSimple", keyframe: "capFadeSimple", ease: "ease-out" },
  { id: "fadeScale", name: "Fade + Scale", captionAnimation: "fadeScale", keyframe: "capFadeScale", ease: "ease-out" },
  { id: "fadeBlur", name: "Fade + Blur", captionAnimation: "fadeBlur", keyframe: "capFadeBlur", ease: "ease-out" },
  { id: "slideUp", name: "Slide Up", captionAnimation: "slideUp", keyframe: "capSlideUp", ease: "ease-out" },
  { id: "slideDown", name: "Slide Down", captionAnimation: "slideDown", keyframe: "capSlideDown", ease: "ease-out" },
  { id: "slideLeft", name: "Slide Left", captionAnimation: "slideLeft", keyframe: "capSlideLeft", ease: "ease-out" },
  { id: "slideRight", name: "Slide Right", captionAnimation: "slideRight", keyframe: "capSlideRight", ease: "ease-out" },
  { id: "zoomOut", name: "Zoom Out In", captionAnimation: "zoomOut", keyframe: "capZoomOut", ease: "ease-out" },
  { id: "rotateIn", name: "Rotate In", captionAnimation: "rotateIn", keyframe: "capRotateIn", ease: "ease-out" },
  { id: "tiltIn", name: "Tilt In (3D)", captionAnimation: "tiltIn", keyframe: "capTiltIn", ease: "ease-out" },
  { id: "swingPendulum", name: "Swing Pendulum", captionAnimation: "swingPendulum", keyframe: "capSwingPendulum", ease: "ease-out" },
  { id: "springElastic", name: "Spring Elastic", captionAnimation: "springElastic", keyframe: "capSpringElastic", ease: "ease-out" },
  { id: "jellySquash", name: "Jelly Squash", captionAnimation: "jellySquash", keyframe: "capJellySquash", ease: "ease-out" },
  { id: "flipX", name: "Flip X", captionAnimation: "flipX", keyframe: "capFlipX", ease: "ease-out" },
  { id: "flipY", name: "Flip Y", captionAnimation: "flipY", keyframe: "capFlipY", ease: "ease-out" },
  { id: "perspectiveDrop", name: "Perspective Drop", captionAnimation: "perspectiveDrop", keyframe: "capPerspectiveDrop", ease: "ease-out" },
  { id: "wipeReveal", name: "Wipe Reveal", captionAnimation: "wipeReveal", keyframe: "capWipeReveal", ease: "ease-out" },
  { id: "circleReveal", name: "Circle Reveal", captionAnimation: "circleReveal", keyframe: "capCircleReveal", ease: "ease-out" },
  { id: "curtainReveal", name: "Curtain Reveal", captionAnimation: "curtainReveal", keyframe: "capCurtainReveal", ease: "ease-out" },
  { id: "punchIn", name: "Punch In", captionAnimation: "punchIn", keyframe: "capPunchIn", ease: "ease-out" },
  { id: "shakeSettle", name: "Shake Settle", captionAnimation: "shakeSettle", keyframe: "capShakeSettle", ease: "ease-out" },
  { id: "neonGlow", name: "Neon Glow In", captionAnimation: "neonGlow", keyframe: "capNeonGlow", ease: "ease-out" },

  // Glitch category — added in a follow-up diff after the first 22, same handoff (dropped by
  // mistake the first time, caught on review of the contract change).
  { id: "glitchSlice", name: "Glitch Slice", captionAnimation: "glitchSlice", keyframe: "capGlitchSlice", ease: "steps(6, end)" },
  { id: "rgbSplit", name: "RGB Split Converge", captionAnimation: "rgbSplit", keyframe: "capRgbSplit", ease: "ease-out" },
];

// The card for a `captionAnimation` value. Independent of `revealMode` by design, so every
// animation resolves in every reveal mode — the previous signature took both and returned
// undefined for 27 of the 30 animations whenever the mode was "single-word", which showed up as
// captions silently appearing with no entrance at all.
export function findAnimationOption(
  captionAnimation: CaptionAnimation
): AnimationOption | undefined {
  return CAPTION_ANIMATIONS.find((a) => a.captionAnimation === captionAnimation);
}
