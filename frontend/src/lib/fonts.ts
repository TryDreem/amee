// Full font gallery, ported from the design's PRESETS_D (`Video Subtitle Editor.dc.html`). Each
// entry is a named look: a bare `family` written into overrides.fontFamily, plus the bundled
// weight/transform/italic/glow the design applies when that font is picked. `outline` is
// card-preview-only in the design (the flag never reaches the overlay), so it's not part of the
// written bundle. Fonts load via the <link>/@font-face block in index.html.
import type { Mode } from "../theme";

export type FontCategory = "bold" | "minimal" | "colorful" | "script";
export type FontLang = "both" | "lat";

export interface FontOption {
  // Friendly label shown on the card, rendered in the font itself.
  name: string;
  // A SINGLE font family name — this is the value written to overrides.fontFamily, and it must
  // stay free of CSS syntax (no quotes, no fallback list). The export path drops it into an
  // ASS `Style:` line, which is comma-separated: a CSS stack like "'Golos Text', sans-serif"
  // adds a field there and silently shifts every field after it, so libass discards the style
  // and burns the video with no captions at all. CSS callers build their own stack via
  // cssFontFamily().
  family: string;
  // CSS generic appended only when rendering (preview/cards), never sent to the backend.
  fallback: "sans-serif" | "serif" | "cursive";
  cat: FontCategory;
  lang: FontLang;
  weight: number;
  transform?: "uppercase";
  italic?: boolean;
  glow?: boolean;
  // Card-preview decoration only — the design's `outline` flag never touches the rendered overlay.
  outline?: boolean;
  // The card's preview colour, as a hue rather than a hex — see FONT_PREVIEW_COLORS below.
  hue: PreviewHue;
}

// A font card's colour is stored as a hue name, not a literal hex, because the card background is
// near-black on the dark theme and white on the light one: a single fixed hex is legible on one
// and at risk on the other. The original gallery did store literal hexes, and about a quarter of
// them were near-black slate values — on the dark theme those cards rendered as blank rectangles.
// Each hue therefore resolves to a light tone for dark backgrounds and a deep one for light
// backgrounds, so every card stays both colourful and clearly readable in both themes.
export type PreviewHue =
  | "blue"
  | "cyan"
  | "teal"
  | "green"
  | "lime"
  | "amber"
  | "orange"
  | "rust"
  | "red"
  | "rose"
  | "pink"
  | "violet"
  | "slate";

export const FONT_PREVIEW_COLORS: Record<Mode, Record<PreviewHue, string>> = {
  dark: {
    blue: "#6AA0FF",
    cyan: "#45D9F0",
    teal: "#3FD9C0",
    green: "#4ADE80",
    lime: "#A3E635",
    amber: "#FBBF24",
    orange: "#FB923C",
    rust: "#F08A6E",
    red: "#F87171",
    rose: "#FB7185",
    pink: "#F0A6C8",
    violet: "#A78BFA",
    slate: "#CBD5E1",
  },
  light: {
    blue: "#1D4ED8",
    cyan: "#0E7490",
    teal: "#0F766E",
    green: "#15803D",
    lime: "#4D7C0F",
    amber: "#B45309",
    orange: "#C2410C",
    rust: "#9A3412",
    red: "#B91C1C",
    rose: "#BE123C",
    pink: "#BE185D",
    violet: "#6D28D9",
    slate: "#334155",
  },
};

export function fontPreviewColor(hue: PreviewHue, mode: Mode): string {
  return FONT_PREVIEW_COLORS[mode][hue];
}

export const FONT_OPTIONS: FontOption[] = [
  { name: "Bebas Bold", cat: "bold", lang: "both", family: "Oswald", fallback: "sans-serif", weight: 700, transform: "uppercase", hue: "blue" },
  { name: "Montserrat", cat: "bold", lang: "both", family: "Montserrat", fallback: "sans-serif", weight: 800, hue: "red" },
  { name: "Clean", cat: "minimal", lang: "both", family: "Inter", fallback: "sans-serif", weight: 500, hue: "green" },
  { name: "Neon Glow", cat: "colorful", lang: "both", family: "Inter", fallback: "sans-serif", weight: 700, glow: true, hue: "cyan" },
  { name: "Overdoze Sans", cat: "colorful", lang: "lat", family: "Overdoze Sans", fallback: "cursive", weight: 400, hue: "orange" },
  { name: "Elegant Serif", cat: "minimal", lang: "both", family: "Playfair Display", fallback: "serif", weight: 600, italic: true, hue: "violet" },
  { name: "Signature", cat: "script", lang: "both", family: "Caveat", fallback: "cursive", weight: 700, hue: "pink" },
  { name: "Outline", cat: "colorful", lang: "both", family: "Inter", fallback: "sans-serif", weight: 800, outline: true, hue: "slate" },
  { name: "Roboto", cat: "minimal", lang: "both", family: "Roboto", fallback: "sans-serif", weight: 700, hue: "teal" },
  { name: "Golos Sans", cat: "minimal", lang: "both", family: "Golos Text", fallback: "sans-serif", weight: 700, hue: "rust" },
  { name: "Manrope Bold", cat: "minimal", lang: "both", family: "Manrope", fallback: "sans-serif", weight: 800, hue: "amber" },
  { name: "Spray Paint", cat: "colorful", lang: "lat", family: "Rubik Spray Paint", fallback: "cursive", weight: 400, hue: "lime" },
  { name: "Wet Paint", cat: "colorful", lang: "lat", family: "Rubik Wet Paint", fallback: "cursive", weight: 400, hue: "rose" },
  { name: "Marker Hatch", cat: "bold", lang: "lat", family: "Rubik Marker Hatch", fallback: "cursive", weight: 400, hue: "slate" },
  { name: "Moonrocks", cat: "colorful", lang: "lat", family: "Rubik Moonrocks", fallback: "cursive", weight: 400, hue: "violet" },
  { name: "Alex Brush", cat: "script", lang: "lat", family: "Alex Brush", fallback: "cursive", weight: 400, hue: "rose" },
  { name: "Great Vibes", cat: "script", lang: "lat", family: "Great Vibes", fallback: "cursive", weight: 400, hue: "pink" },
  { name: "Young Serif", cat: "minimal", lang: "lat", family: "Young Serif", fallback: "serif", weight: 400, hue: "rust" },
  { name: "Pricedown", cat: "bold", lang: "lat", family: "Pricedown", fallback: "cursive", weight: 400, hue: "amber" },
  { name: "Uni Sans Heavy", cat: "bold", lang: "lat", family: "Uni Sans Heavy", fallback: "sans-serif", weight: 400, transform: "uppercase", hue: "blue" },
  { name: "Luckiest Guy", cat: "bold", lang: "lat", family: "Luckiest Guy", fallback: "cursive", weight: 400, hue: "lime" },
  { name: "Aileron", cat: "minimal", lang: "lat", family: "Aileron", fallback: "sans-serif", weight: 400, hue: "teal" },

  // --- The short-form caption canon -------------------------------------------------------
  // The look this genre is built on is a heavy display face in caps with a thick dark stroke.
  // MrBeast's own subtitle face is Komika Axis, which is not on Google Fonts; Bangers and Anton
  // are the two free stand-ins usually named in its place, so both are here.
  //
  // Cyrillic is the constraint that decides most of this list: Anton, Bebas Neue, Bangers and
  // Titan One are Latin-only, so for Russian captions they are a dead end no matter how popular
  // they are. `lang: "both"` entries below are the ones that actually work on Cyrillic text.
  { name: "Anton", cat: "bold", lang: "lat", family: "Anton", fallback: "sans-serif", weight: 400, transform: "uppercase", hue: "red" },
  { name: "Bebas Neue", cat: "bold", lang: "lat", family: "Bebas Neue", fallback: "sans-serif", weight: 400, transform: "uppercase", hue: "blue" },
  { name: "Bangers", cat: "bold", lang: "lat", family: "Bangers", fallback: "cursive", weight: 400, transform: "uppercase", hue: "orange" },
  { name: "Titan One", cat: "bold", lang: "lat", family: "Titan One", fallback: "cursive", weight: 400, hue: "amber" },
  { name: "Archivo Black", cat: "bold", lang: "lat", family: "Archivo Black", fallback: "sans-serif", weight: 400, transform: "uppercase", hue: "cyan" },

  // Cyrillic-capable heavies — the closest equivalents of the look above for Russian captions.
  { name: "Russo One", cat: "bold", lang: "both", family: "Russo One", fallback: "sans-serif", weight: 400, transform: "uppercase", hue: "blue" },
  { name: "Rubik Mono", cat: "bold", lang: "both", family: "Rubik Mono One", fallback: "sans-serif", weight: 400, transform: "uppercase", hue: "violet" },
  { name: "Unbounded", cat: "bold", lang: "both", family: "Unbounded", fallback: "sans-serif", weight: 800, transform: "uppercase", hue: "cyan" },
  { name: "Alumni Condensed", cat: "bold", lang: "both", family: "Alumni Sans", fallback: "sans-serif", weight: 900, transform: "uppercase", hue: "green" },
  { name: "Pribambas", cat: "colorful", lang: "both", family: "Pribambas", fallback: "cursive", weight: 400, hue: "rose" },
  { name: "Exo Tech", cat: "minimal", lang: "both", family: "Exo 2", fallback: "sans-serif", weight: 800, hue: "teal" },
  { name: "Yeseva Display", cat: "minimal", lang: "both", family: "Yeseva One", fallback: "serif", weight: 400, hue: "rust" },
  { name: "Pacifico", cat: "script", lang: "both", family: "Pacifico", fallback: "cursive", weight: 400, hue: "pink" },

  // Requested as "Grobold" (dafont.com) — not added under that name: dafont's own license page
  // marks it "Free for personal use" only, not cleared for a product, and dafont doesn't serve a
  // stable direct file URL to @font-face against anyway (downloads are a zip behind a click).
  // Bagel Fat One is the closest same-genre stand-in actually available with a real license
  // (Google Fonts, OFL) — a chunky, rounded cartoon caps face in the same spirit.
  { name: "Bagel Fat One", cat: "bold", lang: "lat", family: "Bagel Fat One", fallback: "cursive", weight: 400, hue: "amber" },
];

// `overrides.fontFamily` holds one bare family name. Documents written before that was settled
// hold a whole CSS stack instead ("'Golos Text', sans-serif"), which breaks the comma-separated
// ASS `Style:` line on export — take the first family and strip quotes so old and new documents
// resolve to the same name, and so re-saving one repairs it.
export function fontName(fontFamily: string): string {
  const first = fontFamily.split(",")[0] ?? fontFamily;
  return first.trim().replace(/^['"]|['"]$/g, "");
}

// The CSS value for preview/cards: the stored name plus the generic fallback for that font.
// Only the browser ever sees this — never the wire, never ASS.
export function cssFontFamily(fontFamily: string): string {
  const name = fontName(fontFamily);
  const known = FONT_OPTIONS.find((f) => f.family === name);
  return `'${name}', ${known?.fallback ?? "sans-serif"}`;
}

// Chips the Style-section font gallery filters by (design FILTER_CHIPS_D). "All"/"Favorites" are
// stateful (favorites live in the panel, not the wire schema); the rest map to cat/lang.
export type FontFilter = "All" | "Favorites" | "Cyrillic" | "Latin" | "Bold" | "Minimal" | "Colorful" | "Script";

export const FONT_FILTERS: FontFilter[] = [
  "All",
  "Favorites",
  "Cyrillic",
  "Latin",
  "Bold",
  "Minimal",
  "Colorful",
  "Script",
];

// Mirrors the design's PRESETS_D.filter: All = everything, Favorites = starred (by name),
// Cyrillic/Latin = by `lang`, and the four category chips by `cat`.
export function fontMatchesFilter(font: FontOption, filter: FontFilter, favorites: string[]): boolean {
  switch (filter) {
    case "All":
      return true;
    case "Favorites":
      return favorites.includes(font.name);
    case "Cyrillic":
      return font.lang === "both";
    case "Latin":
      return font.lang === "lat" || font.lang === "both";
    case "Bold":
      return font.cat === "bold";
    case "Minimal":
      return font.cat === "minimal";
    case "Colorful":
      return font.cat === "colorful";
    case "Script":
      return font.cat === "script";
  }
}
