// Small fixed list, not the design's full gallery (filter chips, favoriting) — deferred past
// this round. Font files loaded via the Google Fonts link in index.html. previewColor/weight/
// italic mirror how the design's own font gallery cards render each entry (PRESETS_D).
export interface FontOption {
  family: string;
  weight: number;
  italic?: boolean;
  previewColor: string;
}

export const FONT_OPTIONS: FontOption[] = [
  { family: "Inter", weight: 700, previewColor: "#00B37E" },
  { family: "Oswald", weight: 700, previewColor: "#2F6FED" },
  { family: "Montserrat", weight: 800, previewColor: "#EF4444" },
  { family: "Comfortaa", weight: 700, previewColor: "#F59E0B" },
  { family: "Playfair Display", weight: 600, italic: true, previewColor: "#7C5CBF" },
  { family: "Roboto", weight: 700, previewColor: "#334155" },
  { family: "Manrope", weight: 800, previewColor: "#B4483C" },
];
