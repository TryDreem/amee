// Full font gallery, ported from the design's PRESETS_D (`Video Subtitle Editor.dc.html`). Each
// entry is a named look: a bare `family` written into overrides.fontFamily, plus the bundled
// weight/transform/italic/glow the design applies when that font is picked. `outline` is
// card-preview-only in the design (the flag never reaches the overlay), so it's not part of the
// written bundle. Fonts load via the <link>/@font-face block in index.html.
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
}

// There is no per-font preview colour any more. Each entry used to carry one, and roughly a
// quarter of them were near-black slate values that were simply invisible on the dark theme's
// card — the gallery showed a blank card where a typeface should be. No single fixed palette
// fixes that, because the card background is near-black on one theme and white on the other, so
// any hex legible on one is at risk on the other. The name is drawn in the theme's own text
// colour instead, which is legible in both by construction; a font card exists to show the shape
// of the letters, and the colour was never carrying information.

export const FONT_OPTIONS: FontOption[] = [
  { name: "Bebas Bold", cat: "bold", lang: "both", family: "Oswald", fallback: "sans-serif", weight: 700, transform: "uppercase" },
  { name: "Montserrat", cat: "bold", lang: "both", family: "Montserrat", fallback: "sans-serif", weight: 800 },
  { name: "Clean", cat: "minimal", lang: "both", family: "Inter", fallback: "sans-serif", weight: 500 },
  { name: "Neon Glow", cat: "colorful", lang: "both", family: "Inter", fallback: "sans-serif", weight: 700, glow: true },
  { name: "Overdoze Sans", cat: "colorful", lang: "lat", family: "Overdoze Sans", fallback: "cursive", weight: 400 },
  { name: "Elegant Serif", cat: "minimal", lang: "both", family: "Playfair Display", fallback: "serif", weight: 600, italic: true },
  { name: "Signature", cat: "script", lang: "both", family: "Caveat", fallback: "cursive", weight: 700 },
  { name: "Outline", cat: "colorful", lang: "both", family: "Inter", fallback: "sans-serif", weight: 800, outline: true },
  { name: "Roboto", cat: "minimal", lang: "both", family: "Roboto", fallback: "sans-serif", weight: 700 },
  { name: "Golos Sans", cat: "minimal", lang: "both", family: "Golos Text", fallback: "sans-serif", weight: 700 },
  { name: "Manrope Bold", cat: "minimal", lang: "both", family: "Manrope", fallback: "sans-serif", weight: 800 },
  { name: "Spray Paint", cat: "colorful", lang: "lat", family: "Rubik Spray Paint", fallback: "cursive", weight: 400 },
  { name: "Wet Paint", cat: "colorful", lang: "lat", family: "Rubik Wet Paint", fallback: "cursive", weight: 400 },
  { name: "Marker Hatch", cat: "bold", lang: "lat", family: "Rubik Marker Hatch", fallback: "cursive", weight: 400 },
  { name: "Moonrocks", cat: "colorful", lang: "lat", family: "Rubik Moonrocks", fallback: "cursive", weight: 400 },
  { name: "Alex Brush", cat: "script", lang: "lat", family: "Alex Brush", fallback: "cursive", weight: 400 },
  { name: "Great Vibes", cat: "script", lang: "lat", family: "Great Vibes", fallback: "cursive", weight: 400 },
  { name: "Young Serif", cat: "minimal", lang: "lat", family: "Young Serif", fallback: "serif", weight: 400 },
  { name: "Pricedown", cat: "bold", lang: "lat", family: "Pricedown", fallback: "cursive", weight: 400 },
  { name: "Uni Sans Heavy", cat: "bold", lang: "lat", family: "Uni Sans Heavy", fallback: "sans-serif", weight: 400, transform: "uppercase" },
  { name: "Luckiest Guy", cat: "bold", lang: "lat", family: "Luckiest Guy", fallback: "cursive", weight: 400 },
  { name: "Aileron", cat: "minimal", lang: "lat", family: "Aileron", fallback: "sans-serif", weight: 400 },

  // --- The short-form caption canon -------------------------------------------------------
  // The look this genre is built on is a heavy display face in caps with a thick dark stroke.
  // MrBeast's own subtitle face is Komika Axis, which is not on Google Fonts; Bangers and Anton
  // are the two free stand-ins usually named in its place, so both are here.
  //
  // Cyrillic is the constraint that decides most of this list: Anton, Bebas Neue, Bangers and
  // Titan One are Latin-only, so for Russian captions they are a dead end no matter how popular
  // they are. `lang: "both"` entries below are the ones that actually work on Cyrillic text.
  { name: "Anton", cat: "bold", lang: "lat", family: "Anton", fallback: "sans-serif", weight: 400, transform: "uppercase" },
  { name: "Bebas Neue", cat: "bold", lang: "lat", family: "Bebas Neue", fallback: "sans-serif", weight: 400, transform: "uppercase" },
  { name: "Bangers", cat: "bold", lang: "lat", family: "Bangers", fallback: "cursive", weight: 400, transform: "uppercase" },
  { name: "Titan One", cat: "bold", lang: "lat", family: "Titan One", fallback: "cursive", weight: 400 },
  { name: "Archivo Black", cat: "bold", lang: "lat", family: "Archivo Black", fallback: "sans-serif", weight: 400, transform: "uppercase" },

  // Cyrillic-capable heavies — the closest equivalents of the look above for Russian captions.
  { name: "Russo One", cat: "bold", lang: "both", family: "Russo One", fallback: "sans-serif", weight: 400, transform: "uppercase" },
  { name: "Rubik Mono", cat: "bold", lang: "both", family: "Rubik Mono One", fallback: "sans-serif", weight: 400, transform: "uppercase" },
  { name: "Unbounded", cat: "bold", lang: "both", family: "Unbounded", fallback: "sans-serif", weight: 800, transform: "uppercase" },
  { name: "Alumni Condensed", cat: "bold", lang: "both", family: "Alumni Sans", fallback: "sans-serif", weight: 900, transform: "uppercase" },
  { name: "Pribambas", cat: "colorful", lang: "both", family: "Pribambas", fallback: "cursive", weight: 400 },
  { name: "Exo Tech", cat: "minimal", lang: "both", family: "Exo 2", fallback: "sans-serif", weight: 800 },
  { name: "Yeseva Display", cat: "minimal", lang: "both", family: "Yeseva One", fallback: "serif", weight: 400 },
  { name: "Pacifico", cat: "script", lang: "both", family: "Pacifico", fallback: "cursive", weight: 400 },

  // Requested as "Grobold" (dafont.com) — not added under that name: dafont's own license page
  // marks it "Free for personal use" only, not cleared for a product, and dafont doesn't serve a
  // stable direct file URL to @font-face against anyway (downloads are a zip behind a click).
  // Bagel Fat One is the closest same-genre stand-in actually available with a real license
  // (Google Fonts, OFL) — a chunky, rounded cartoon caps face in the same spirit.
  { name: "Bagel Fat One", cat: "bold", lang: "lat", family: "Bagel Fat One", fallback: "cursive", weight: 400 },
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
