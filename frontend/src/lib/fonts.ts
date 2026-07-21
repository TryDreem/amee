// Full font gallery, ported from the design's PRESETS_D (`Video Subtitle Editor.dc.html`). Each
// entry is a named look: a CSS `family` written into overrides.fontFamily, plus the bundled
// weight/transform/italic/glow the design applies when that font is picked. `outline` is
// card-preview-only in the design (the flag never reaches the overlay), so it's not part of the
// written bundle. Fonts load via the <link>/@font-face block in index.html.
export type FontCategory = "bold" | "minimal" | "colorful" | "script";
export type FontLang = "both" | "lat";

export interface FontOption {
  // Friendly label shown on the card, rendered in the font itself.
  name: string;
  // CSS font-family value written into overrides.fontFamily (with fallback, e.g. "'Oswald', sans-serif").
  family: string;
  cat: FontCategory;
  lang: FontLang;
  weight: number;
  transform?: "uppercase";
  italic?: boolean;
  glow?: boolean;
  // Card-preview decoration only — the design's `outline` flag never touches the rendered overlay.
  outline?: boolean;
  previewColor: string;
}

export const FONT_OPTIONS: FontOption[] = [
  { name: "Bebas Bold", cat: "bold", lang: "both", family: "'Oswald', sans-serif", weight: 700, transform: "uppercase", previewColor: "#2F6FED" },
  { name: "Montserrat", cat: "bold", lang: "both", family: "'Montserrat', sans-serif", weight: 800, previewColor: "#EF4444" },
  { name: "Clean", cat: "minimal", lang: "both", family: "'Inter', sans-serif", weight: 500, previewColor: "#00B37E" },
  { name: "Neon Glow", cat: "colorful", lang: "both", family: "'Inter', sans-serif", weight: 700, glow: true, previewColor: "#22D3EE" },
  { name: "Overdoze Sans", cat: "colorful", lang: "lat", family: "'Overdoze Sans', cursive", weight: 400, previewColor: "#FF7A1A" },
  { name: "Elegant Serif", cat: "minimal", lang: "both", family: "'Playfair Display', serif", weight: 600, italic: true, previewColor: "#7C5CBF" },
  { name: "Signature", cat: "script", lang: "both", family: "'Caveat', cursive", weight: 700, previewColor: "#E8577A" },
  { name: "Outline", cat: "colorful", lang: "both", family: "'Inter', sans-serif", weight: 800, outline: true, previewColor: "#64748B" },
  { name: "Roboto", cat: "minimal", lang: "both", family: "'Roboto', sans-serif", weight: 700, previewColor: "#334155" },
  { name: "Golos Sans", cat: "minimal", lang: "both", family: "'Golos Text', sans-serif", weight: 700, previewColor: "#B4483C" },
  { name: "Manrope Bold", cat: "minimal", lang: "both", family: "'Manrope', sans-serif", weight: 800, previewColor: "#B4483C" },
  { name: "Spray Paint", cat: "colorful", lang: "lat", family: "'Rubik Spray Paint', cursive", weight: 400, previewColor: "#22C55E" },
  { name: "Wet Paint", cat: "colorful", lang: "lat", family: "'Rubik Wet Paint', cursive", weight: 400, previewColor: "#F43F5E" },
  { name: "Marker Hatch", cat: "bold", lang: "lat", family: "'Rubik Marker Hatch', cursive", weight: 400, previewColor: "#0F172A" },
  { name: "Moonrocks", cat: "colorful", lang: "lat", family: "'Rubik Moonrocks', cursive", weight: 400, previewColor: "#7C5CBF" },
  { name: "Alex Brush", cat: "script", lang: "lat", family: "'Alex Brush', cursive", weight: 400, previewColor: "#E8577A" },
  { name: "Great Vibes", cat: "script", lang: "lat", family: "'Great Vibes', cursive", weight: 400, previewColor: "#7C5CBF" },
  { name: "Young Serif", cat: "minimal", lang: "lat", family: "'Young Serif', serif", weight: 400, previewColor: "#B4483C" },
  { name: "Pricedown", cat: "bold", lang: "lat", family: "'Pricedown', cursive", weight: 400, previewColor: "#F59E0B" },
  { name: "Uni Sans Heavy", cat: "bold", lang: "lat", family: "'Uni Sans Heavy', sans-serif", weight: 400, transform: "uppercase", previewColor: "#2F6FED" },
  { name: "Luckiest Guy", cat: "bold", lang: "lat", family: "'Luckiest Guy', cursive", weight: 400, previewColor: "#0F172A" },
  { name: "Aileron", cat: "minimal", lang: "lat", family: "'Aileron', sans-serif", weight: 400, previewColor: "#334155" },
];

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
