import type { OutlineOrShadow } from "../api/client";

// How outline / shadow / glow are drawn from the wire's `size` labels. The labels themselves are
// the contract (contract §8); these ratios are this frontend's rendering of them.
//
// Expressed as a FRACTION OF FONT SIZE, never absolute px — the same rule `fontSize` itself
// follows (a fraction of video height, L7). CaptionOverlay draws into a ~500px-tall editor preview
// and into a full-resolution export frame with the same code (P9/R1), so a hardcoded `20px` glow
// would be 80% of the glyph height in one and 10% of it in the other. That is what "glow looks
// different in the export" actually was.
//
// Shared with the preset gallery's card previews for a narrower but related reason: a card that
// advertises a preset has to draw its outline and glow at the same proportions the caption will,
// or picking by eye stops working.
export const OUTLINE_WIDTH_RATIO: Record<string, number> = {
  none: 0,
  small: 0.04,
  medium: 0.08,
  large: 0.12,
};
export const SHADOW_BLUR_RATIO: Record<string, number> = {
  none: 0,
  small: 0.24,
  medium: 0.56,
  large: 0.96,
};
export const GLOW_BLUR_RATIO = 0.8;

// `alpha` is a 0-100 percentage on the wire (contract §8). A value that isn't a plain 6-digit hex
// is passed through untouched: highlightColors already stores alpha folded into an rgba() string
// (see lib/color.ts), and re-parsing that here would only lose it.
export function hexToRgba(hex: string, alphaPct: number): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m || !m[1] || !m[2] || !m[3]) {
    return hex;
  }
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  return `rgba(${r}, ${g}, ${b}, ${alphaPct / 100})`;
}

// For `-webkit-text-stroke`. Undefined (rather than a 0px stroke) when there's nothing to draw, so
// callers can leave the property off entirely.
export function outlineCssFor(outline: OutlineOrShadow | null, fontSizePx: number): string | undefined {
  if (!outline) {
    return undefined;
  }
  const width = (OUTLINE_WIDTH_RATIO[outline.size] ?? 0) * fontSizePx;
  return width > 0 ? `${width}px ${hexToRgba(outline.color, outline.alpha)}` : undefined;
}

// Glow and drop shadow share one `text-shadow`, glow first — it's the tighter, brighter one and
// has to sit on top. `color` is the colour the text is actually being painted in, because the glow
// tints itself to the glyph rather than to a fixed accent.
export function textShadowFor(
  style: { shadow: OutlineOrShadow | null; glow: boolean },
  fontSizePx: number,
  color: string
): string | undefined {
  const blur = style.shadow ? (SHADOW_BLUR_RATIO[style.shadow.size] ?? 0) * fontSizePx : 0;
  const shadowCss =
    style.shadow && blur > 0 ? `0 0 ${blur}px ${hexToRgba(style.shadow.color, style.shadow.alpha)}` : undefined;
  const glowCss = style.glow ? `0 0 ${GLOW_BLUR_RATIO * fontSizePx}px ${color}` : undefined;
  return [glowCss, shadowCss].filter(Boolean).join(", ") || undefined;
}
