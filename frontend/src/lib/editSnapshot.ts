import type { CaptionStyleSpec, ECS, Segment, StyleOverrides } from "../api/client";
import { fontName } from "./fonts";

// Step 7: everything the undo/redo stack tracks as one edit -- content (segments) and the
// document-level style fields, snapshotted together so a single Undo button steps through
// whichever kind of edit the user made last (matches the Behavior Matrix's own framing: one
// linear undo/redo history, not separate content/style stacks).
export interface EditSnapshot {
  segments: Segment[];
  presetId: string;
  perPhraseStyle: boolean;
  overrides: StyleOverrides;
}

// `overrides.fontFamily` must be one bare family name: it ends up in the export's ASS `Style:`
// line, which is comma-separated, so a CSS stack ("'Golos Text', sans-serif") shifts every field
// after it and libass drops the style — the video burns with no captions. Documents written
// before that was settled hold exactly that, so collapse it to the family name on load; the next
// save/export then persists the repaired value. Applied before the save point is taken, so this
// repair never shows up as an unsaved change.
export function normalizeStyle(style: CaptionStyleSpec): CaptionStyleSpec {
  const family = style.overrides.fontFamily;
  if (typeof family !== "string" || fontName(family) === family) {
    return style;
  }
  return { ...style, overrides: { ...style.overrides, fontFamily: fontName(family) } };
}

export function snapshotOf(ecs: ECS, style: CaptionStyleSpec): EditSnapshot {
  return structuredClone({
    segments: ecs.segments,
    presetId: style.presetId,
    perPhraseStyle: style.perPhraseStyle,
    overrides: style.overrides,
  });
}
