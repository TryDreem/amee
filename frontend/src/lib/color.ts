// Pure HSV/RGB/Hex conversions for the custom color picker (ColorPickerModal) — ported from
// the design's own implementation so hue/saturation/value math and rounding match exactly.
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Hsv {
  h: number;
  s: number;
  v: number;
}

export function hexToRgb(hex: string): Rgb {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return {
    r: parseInt(full.substr(0, 2), 16) || 0,
    g: parseInt(full.substr(2, 2), 16) || 0,
    b: parseInt(full.substr(4, 2), 16) || 0,
  };
}

export function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return "#" + [clamp(r), clamp(g), clamp(b)].map((v) => v.toString(16).padStart(2, "0")).join("");
}

export function rgbToHsv(r: number, g: number, b: number): Hsv {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  const v = max;
  return { h, s, v };
}

export function hsvToRgb(h: number, s: number, v: number): Rgb {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) {
    r = c;
    g = x;
    b = 0;
  } else if (h < 120) {
    r = x;
    g = c;
    b = 0;
  } else if (h < 180) {
    r = 0;
    g = c;
    b = x;
  } else if (h < 240) {
    r = 0;
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    g = 0;
    b = c;
  } else {
    r = c;
    g = 0;
    b = x;
  }
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

export function hexToRgbStr(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  return `${r},${g},${b}`;
}

export function colorWithAlpha(hex: string, alphaPct: number): string {
  if (alphaPct >= 100) {
    return hex;
  }
  return `rgba(${hexToRgbStr(hex)},${alphaPct / 100})`;
}

// Inverse of colorWithAlpha — needed to re-derive {hex, alpha} when reopening the picker for
// a field that has no dedicated alpha slot in the wire schema (highlightColors: string[],
// contract §8) and therefore stores alpha folded into the color string itself, same as the
// design's own buildStylePack does via colorWithAlpha before the array is ever assembled.
export function parseColorString(value: string): { hex: string; alpha: number } {
  const m = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(value.trim());
  if (m && m[1] && m[2] && m[3] && m[4]) {
    return {
      hex: rgbToHex(Number(m[1]), Number(m[2]), Number(m[3])),
      alpha: Math.round(Number(m[4]) * 100),
    };
  }
  return { hex: value, alpha: 100 };
}

// The 40-color curated grid shown at the top of the color picker modal — 8 hues x 5
// lightness bands, ported verbatim from the design's COLOR_SWATCH_GRID_D.
export const COLOR_SWATCH_GRID: string[] = [
  "#FFD1D1", "#FFDAB3", "#FFF3B0", "#D6F5B0", "#B0F5E6", "#B0D4F5", "#D6C4F5", "#FFC2E8",
  "#FF9E9E", "#FFB870", "#FFE270", "#A8E86E", "#6EE8C8", "#6EAEE8", "#B08CE8", "#FF8CD1",
  "#FF6161", "#FF8A3D", "#FFC93D", "#7CD93D", "#3DD9A8", "#3D8CD9", "#8A5CD9", "#FF5CB8",
  "#E63946", "#E67E22", "#F1C40F", "#2ECC71", "#00C2A8", "#2F6FED", "#6C3CE9", "#E9339B",
  "#B0201E", "#B85C00", "#B89400", "#1E8449", "#00806B", "#1E4FA8", "#4B1E9E", "#A81E70",
];

// Default highlight-swatch colors (Main/Second/Third), matching the design's own
// PALETTE_D-derived defaults (mainColor=PALETTE_D[0], secondColor=PALETTE_D[2],
// thirdColor=PALETTE_D[3]) — used only when highlightColors doesn't yet have that slot set.
export const DEFAULT_HIGHLIGHT_COLORS: string[] = ["#00E5A0", "#FFB84D", "#FF5C5C"];
