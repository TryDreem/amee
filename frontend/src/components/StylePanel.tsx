import { useEffect, useState, type CSSProperties } from "react";

import type {
  OutlineOrShadow,
  Preset,
  PresetBase,
  RevealMode,
  StyleOverrides,
} from "../api/client";
import ColorPickerModal from "./ColorPickerModal";
import type { Strings } from "../i18n";
import { CAPTION_ANIMATIONS, findAnimationOption, type AnimationOption } from "../lib/animations";
import { outlineCssFor, textShadowFor } from "../lib/captionDecoration";
import { colorWithAlpha, DEFAULT_HIGHLIGHT_COLORS, parseColorString } from "../lib/color";
import {
  cssFontFamily,
  FONT_FILTERS,
  FONT_OPTIONS,
  fontMatchesFilter,
  fontName,
  type FontFilter,
  type FontOption,
} from "../lib/fonts";
import { resolveTheme, UI_MODES, type Prefs } from "../theme";

interface StylePanelProps {
  prefs: Prefs;
  strings: Strings;
  presets: Preset[];
  activePresetId: string;
  resolvedStyle: PresetBase;
  bounds: Preset["bounds"];
  // When true (editing one segment's per-phrase style), the highlight-color control collapses to
  // a single "Main" swatch that writes a length-1 `highlightColors` array; slots 2/3 are disabled
  // (arch §4.2 color model). Off = the normal 3-swatch document-level editor.
  singleColor?: boolean;
  onSelectPreset: (presetId: string) => void;
  onChangeOverrides: (patch: StyleOverrides) => void;
  // Drag-coalesced pair for the two range sliders (Caption position, Font size): `onLive` applies
  // every tick for a responsive preview WITHOUT pushing a history entry; `onCommit` (mouseup/
  // touchend/keyup/blur -- the drag/gesture ending) folds the whole gesture into exactly one
  // history entry. Using the instant `onChangeOverrides` for these would let Undo only step back
  // one tick of the drag instead of the whole gesture.
  onLiveChangeOverrides: (patch: StyleOverrides) => void;
  onCommitOverrides: () => void;
}

type SectionId = "presets" | "style" | "animation";

const FONT_WEIGHTS: { value: number; label: string }[] = [
  { value: 400, label: "Regular" },
  { value: 600, label: "Semibold" },
  { value: 700, label: "Bold" },
  { value: 900, label: "Black" },
];

const OUTLINE_SHADOW_SIZES: OutlineOrShadow["size"][] = ["none", "small", "medium", "large"];

// A preset card draws its own name in the look it applies — font, case, colour, outline, glow,
// shadow — and replays its entrance animation on a loop, so the whole thing can be chosen by eye
// instead of by reading a name and clicking to find out. The size is the card's, not the video's:
// outline/shadow/glow are fractions of font size (lib/captionDecoration), so the proportions
// survive the shrink even though the absolute pixels don't.
const PRESET_PREVIEW_FONT_PX = 17;
// Long enough that the loop reads as a periodic demo rather than a flicker, short enough that a
// glance at the section catches at least one.
const PRESET_PREVIEW_REPLAY_MS = 2600;
const PRESET_PREVIEW_ANIMATION_MS = 620;
const PRESET_PREVIEW_STAGGER_MS = 90;

// Favorites are pure UI (starred fonts/animations), not part of any wire shape — persisted to
// localStorage so they survive reloads and tab switches. Fonts keyed by name, animations by id.
const LS_FAV_FONTS = "amee_fav_fonts";
const LS_FAV_ANIMS = "amee_fav_anims";

function loadFavs(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

// Design layout: three scrollable accordion sections (Presets, Style — the font gallery,
// Animation — the entrance-animation gallery) up top, then a pinned (non-scrolling) bottom strip —
// Caption Position / Font size / colors always visible, with a "More options" toggle revealing the
// rest (`Video Subtitle Editor.dc.html` e_pinnedControlsStyle).
export default function StylePanel({
  prefs,
  strings: L,
  presets,
  activePresetId,
  resolvedStyle,
  bounds,
  singleColor = false,
  onSelectPreset,
  onChangeOverrides,
  onLiveChangeOverrides,
  onCommitOverrides,
}: StylePanelProps): JSX.Element {
  const mode = UI_MODES[prefs.mode];
  const theme = resolveTheme(prefs.theme, prefs.mode);

  // Mutually exclusive, matching the design's own `openSection` (single value, not
  // independent booleans) — opening one section closes whichever was open.
  const [openSection, setOpenSection] = useState<SectionId | null>("presets");
  const [moreOpen, setMoreOpen] = useState(false);
  const [fontFilter, setFontFilter] = useState<FontFilter>("All");
  const [animFilter, setAnimFilter] = useState<"All" | "Favorites">("All");
  const [favFonts, setFavFonts] = useState<string[]>(() => loadFavs(LS_FAV_FONTS));
  const [favAnims, setFavAnims] = useState<string[]>(() => loadFavs(LS_FAV_ANIMS));
  const [hoveredAnim, setHoveredAnim] = useState<string | null>(null);

  // Drives the preset previews' animation replay. Incrementing it re-keys each card's text span,
  // which remounts it and therefore restarts its CSS entrance — the same restart trick the
  // animation gallery uses on hover. Only ticks while the section is actually open.
  const [presetBeat, setPresetBeat] = useState(0);
  useEffect(() => {
    if (openSection !== "presets") {
      return;
    }
    const timer = setInterval(() => setPresetBeat((v) => v + 1), PRESET_PREVIEW_REPLAY_MS);
    return () => clearInterval(timer);
  }, [openSection]);

  // Which field a click on a color swatch is currently editing — a single modal instance
  // serves all of them (3 highlight swatches + shadow + outline).
  const [editingColor, setEditingColor] = useState<{
    key: string;
    hex: string;
    alpha: number;
    showAlpha: boolean;
    onChange: (hex: string, alpha: number) => void;
  } | null>(null);

  function toggleFav(
    key: string,
    list: string[],
    setList: (next: string[]) => void,
    storageKey: string
  ) {
    const next = list.includes(key) ? list.filter((k) => k !== key) : [...list, key];
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // Ignore storage failures (private mode / quota) — favorites just won't persist.
    }
    setList(next);
  }

  // Staggered card reveal on section open, ported from the design's _scheduleReveal/
  // _revealStyle: height animates via collapseWrapStyle below; independently, each card
  // inside fades/slides/scales in with a per-index delay once the section is open. The 20ms
  // deferred setState (instead of setting revealed synchronously) forces a render with the
  // "hidden" style first, so the transition to "revealed" actually has something to animate
  // from — same trick the design uses.
  const [revealSection, setRevealSection] = useState<SectionId | null>(null);
  // Once the stagger has finished playing, stop setting an inline transition at all — the
  // design's own "moreSettled" pattern: an inline `transition` value would otherwise permanently
  // override the `.amee-grid-card` stylesheet hover transition on the same property, killing
  // hover-scale after the reveal.
  const [staggerSettled, setStaggerSettled] = useState(false);
  useEffect(() => {
    setRevealSection(null);
    setStaggerSettled(false);
    if (!openSection) {
      return;
    }
    const revealTimer = setTimeout(() => setRevealSection(openSection), 20);
    const settleTimer = setTimeout(() => setStaggerSettled(true), 900);
    return () => {
      clearTimeout(revealTimer);
      clearTimeout(settleTimer);
    };
  }, [openSection]);

  function revealStyle(sectionId: SectionId, index: number): CSSProperties {
    const revealed = revealSection === sectionId;
    if (revealed && staggerSettled) {
      return {};
    }
    const delay = 120 + index * 40;
    return revealed
      ? {
          opacity: 1,
          transform: "translateY(0) scale(1)",
          transition: `opacity .4s ${delay}ms, transform .45s cubic-bezier(.2,.8,.2,1) ${delay}ms`,
        }
      : {
          opacity: 0,
          transform: "translateY(14px) scale(0.96)",
          transition: "opacity .4s, transform .45s cubic-bezier(.2,.8,.2,1)",
        };
  }

  const accordionHeaderStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "14px 2px",
    cursor: "pointer",
    fontSize: "13.5px",
    fontWeight: 600,
    color: mode.textMain,
  };

  // CSS-grid "animate to auto height" technique, same as the design's e_*WrapStyle: a
  // 0fr/1fr grid-template-rows transition on the outer element, with an overflow:hidden
  // inner element absorbing the animated row height.
  function collapseWrapStyle(open: boolean, durationS: number): CSSProperties {
    return {
      display: "grid",
      gridTemplateRows: open ? "1fr" : "0fr",
      transition: `grid-template-rows ${durationS}s cubic-bezier(.4,0,.2,1)`,
    };
  }
  const collapseInnerStyle: CSSProperties = { overflow: "hidden", minHeight: 0 };

  function pillStyle(active: boolean): CSSProperties {
    return {
      fontSize: "12.5px",
      fontWeight: 600,
      padding: "8px 14px",
      borderRadius: "8px",
      cursor: "pointer",
      background: active ? theme.accent : mode.iconBg,
      color: active ? theme.text : mode.iconText,
    };
  }

  function chipStyle(active: boolean): CSSProperties {
    return {
      padding: "7px 13px",
      borderRadius: "100px",
      cursor: "pointer",
      fontSize: "12px",
      fontWeight: 600,
      background: active ? theme.accent : mode.iconBg,
      color: active ? theme.text : mode.iconText,
    };
  }

  const gridStyle: CSSProperties = {
    display: "grid",
    gridTemplateColumns: "1fr 1fr 1fr",
    gap: "12px",
    padding: "4px 4px 16px",
  };

  function sectionHeader(id: SectionId, label: string, withTopBorder: boolean) {
    return (
      <div
        style={withTopBorder ? { ...accordionHeaderStyle, borderTop: "1px solid " + mode.panelBorder } : accordionHeaderStyle}
        onClick={() => setOpenSection((v) => (v === id ? null : id))}
      >
        <span>{label}</span>
        <span style={{ fontSize: "10px", color: mode.textFaint }}>{openSection === id ? "▲" : "▼"}</span>
      </div>
    );
  }

  function yesNoRow(label: string, active: boolean, onChange: (value: boolean) => void) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        <div style={{ fontSize: "11.5px", color: mode.textFaint3 }}>{label}</div>
        <div style={{ display: "flex", gap: "6px" }}>
          <div className="amee-cta-btn" style={pillStyle(active)} onClick={() => onChange(true)}>
            {L.yes}
          </div>
          <div className="amee-cta-btn" style={pillStyle(!active)} onClick={() => onChange(false)}>
            {L.no}
          </div>
        </div>
      </div>
    );
  }

  // Same shape as yesNoRow but for an N-way choice. Used by the reveal-mode control, which is a
  // three-way pick rather than a boolean.
  function choiceRow<T extends string>(
    label: string,
    options: { value: T; label: string }[],
    active: T,
    onChange: (value: T) => void
  ) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        <div style={{ fontSize: "11.5px", color: mode.textFaint3 }}>{label}</div>
        <div style={{ display: "flex", gap: "6px" }}>
          {options.map((option) => (
            <div
              key={option.value}
              className="amee-cta-btn"
              style={pillStyle(active === option.value)}
              onClick={() => onChange(option.value)}
            >
              {option.label}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Picking a font applies its whole bundled look (family + weight + transform + italic + glow),
  // matching the design where each named font is a preset of those fields — otherwise the distinct
  // gallery previews (Neon Glow, Bebas, Elegant Serif) would all collapse to the same plain family.
  // `outline` is card-preview-only in the design and stays out of the written bundle.
  function handlePickFont(font: FontOption) {
    onChangeOverrides({
      fontFamily: font.family,
      fontWeight: font.weight,
      textTransform: font.transform === "uppercase" ? "uppercase" : "none",
      italic: Boolean(font.italic),
      glow: Boolean(font.glow),
    });
  }

  function isFontSelected(font: FontOption): boolean {
    return (
      // fontName(), not a raw compare: a document saved before fontFamily was settled as a bare
      // name holds a whole CSS stack, which would match no card and leave the gallery looking
      // like nothing is selected.
      fontName(resolvedStyle.fontFamily) === font.family &&
      resolvedStyle.fontWeight === font.weight &&
      resolvedStyle.italic === Boolean(font.italic) &&
      resolvedStyle.glow === Boolean(font.glow) &&
      (resolvedStyle.textTransform === "uppercase") === (font.transform === "uppercase")
    );
  }

  // A card writes ONLY the animation. `revealMode` is its own control (below), because the two are
  // genuinely independent: which words are on screen is a different question from how they arrive.
  // Folding them into one gallery — as the original 9-card design did — meant most animations were
  // reachable in one reveal mode only, so picking a new animation for a single-word segment
  // silently dragged it back to whole-phrase.
  function handlePickAnimation(a: AnimationOption) {
    onChangeOverrides({ captionAnimation: a.captionAnimation });
  }

  const selectedAnimId = findAnimationOption(resolvedStyle.captionAnimation)?.id;

  // 3 fixed slots (StyleOverrides.highlightColors is a plain string[] — contract §8). No
  // dedicated alpha field, so alpha is folded straight into the stored color string via
  // colorWithAlpha (plain hex at 100%, rgba() below that) — same technique the design's own
  // buildStylePack uses to assemble this array, not a schema gap.
  function highlightColorAt(index: number): string {
    return resolvedStyle.highlightColors[index] ?? DEFAULT_HIGHLIGHT_COLORS[index] ?? "#ffffff";
  }
  function handleSwatchChange(index: number, color: string) {
    const next = singleColor ? [color] : [0, 1, 2].map((i) => (i === index ? color : highlightColorAt(i)));
    onChangeOverrides({ highlightColors: next });
  }

  // Plain colored button (not a native <input type="color">) — opens the custom
  // ColorPickerModal, matching the design's own swatch + modal pattern.
  function colorSwatchButton(
    key: string,
    hex: string,
    alpha: number,
    onChange: (hex: string, alpha: number) => void,
    options?: { size?: number; showAlpha?: boolean; disabled?: boolean }
  ) {
    const size = options?.size ?? 30;
    const showAlpha = options?.showAlpha ?? true;
    const disabled = options?.disabled ?? false;
    return (
      <div
        onClick={disabled ? undefined : () => setEditingColor({ key, hex, alpha, showAlpha, onChange })}
        style={{
          width: `${size}px`,
          height: `${size}px`,
          borderRadius: "10px",
          border: "1px solid " + mode.cardBorder,
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.4 : 1,
          background: disabled ? mode.cardBg : colorWithAlpha(hex, alpha),
          flex: "none",
        }}
      />
    );
  }

  function outlineOrShadowRow(
    label: string,
    colorLabel: string,
    current: OutlineOrShadow | null,
    onChange: (next: OutlineOrShadow | null) => void
  ) {
    const value: OutlineOrShadow = current ?? { size: "none", color: "#000000", alpha: 100 };
    return (
      <div style={{ display: "flex", gap: "26px", alignItems: "flex-end", flexWrap: "wrap", paddingTop: "16px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <div style={{ fontSize: "11.5px", color: mode.textFaint3 }}>{label}</div>
          <div style={{ display: "flex", gap: "6px" }}>
            {OUTLINE_SHADOW_SIZES.map((size) => (
              <div
                key={size}
                className="amee-cta-btn"
                style={pillStyle(value.size === size)}
                onClick={() => onChange(size === "none" ? null : { ...value, size })}
              >
                {SIZE_LABEL_KEY[size](L)}
              </div>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px" }}>
          <div style={{ fontSize: "11.5px", color: mode.textFaint3 }}>{colorLabel}</div>
          {colorSwatchButton(colorLabel, value.color, value.alpha, (hex, alpha) =>
            onChange({ ...value, color: hex, alpha })
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div style={{ flex: 1, overflow: "auto", minHeight: 0, padding: "0 22px" }}>
        {sectionHeader("presets", L.presetsLabel, false)}
        <div style={collapseWrapStyle(openSection === "presets", 0.5)}>
          <div style={collapseInnerStyle}>
            <div style={gridStyle}>
              {presets.map((preset, i) => {
                const selected = preset.id === activePresetId;
                const base = preset.base;
                // The colour a caption in this preset actually shows: highlightColors[0] is what
                // the active word wears, and every reveal mode always has an active word.
                const previewColor = base.highlightColors[0] ?? base.color;
                const outlineCss = outlineCssFor(base.outline, PRESET_PREVIEW_FONT_PX);
                const anim = findAnimationOption(base.captionAnimation);
                return (
                  <div
                    key={preset.id}
                    onClick={() => onSelectPreset(preset.id)}
                    className="amee-grid-card"
                    style={{
                      padding: "14px 8px",
                      borderRadius: "10px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      minHeight: "76px",
                      overflow: "hidden",
                      textAlign: "center",
                      // Same card surface as the font and animation galleries below. A darker
                      // "like footage" backdrop would show pale presets better, but three
                      // stacked galleries where one is visibly a different material read as a
                      // mistake, and the preview text carries the look on its own.
                      background: selected ? `${theme.accent}24` : mode.cardBg,
                      border: "1px solid " + (selected ? theme.accent : mode.cardBorder),
                      // The 3D entrances (tiltIn/flipX/flipY/perspectiveDrop) need this on an
                      // ancestor to read as a tilt rather than a flat squash, exactly as in
                      // CaptionOverlay. No seeded preset uses one yet; a future one might.
                      perspective: "500px",
                      ...revealStyle("presets", i),
                    }}
                  >
                    <span
                      key={`${preset.id}-${presetBeat}`}
                      style={{
                        display: "inline-block",
                        fontFamily: cssFontFamily(base.fontFamily),
                        fontWeight: base.fontWeight,
                        fontStyle: base.italic ? "italic" : "normal",
                        textTransform: base.textTransform === "uppercase" ? "uppercase" : "none",
                        fontSize: `${PRESET_PREVIEW_FONT_PX}px`,
                        lineHeight: 1.2,
                        color: previewColor,
                        WebkitTextStroke: outlineCss,
                        // Fill over stroke, so the stroke's inward half doesn't swallow the glyph
                        // — same reason CaptionOverlay sets it.
                        paintOrder: outlineCss ? "stroke fill" : undefined,
                        textShadow: textShadowFor(base, PRESET_PREVIEW_FONT_PX, previewColor),
                        animation: anim?.keyframe
                          ? `${anim.keyframe} ${PRESET_PREVIEW_ANIMATION_MS}ms ${anim.ease} ${i * PRESET_PREVIEW_STAGGER_MS}ms both`
                          : undefined,
                      }}
                    >
                      {preset.name}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {sectionHeader("style", L.styleSectionLabel, true)}
        <div style={collapseWrapStyle(openSection === "style", 0.5)}>
          <div style={collapseInnerStyle}>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", padding: "4px 4px 12px" }}>
              {FONT_FILTERS.map((filter) => (
                <div
                  key={filter}
                  className="amee-cta-btn"
                  style={chipStyle(fontFilter === filter)}
                  onClick={() => setFontFilter(filter)}
                >
                  {L.chips[filter]}
                </div>
              ))}
            </div>
            <div style={gridStyle}>
              {FONT_OPTIONS.filter((font) => fontMatchesFilter(font, fontFilter, favFonts)).map((font, i) => {
                const selected = isFontSelected(font);
                const isFav = favFonts.includes(font.name);
                return (
                  <div
                    key={font.name}
                    onClick={() => handlePickFont(font)}
                    className="amee-grid-card"
                    style={{
                      padding: "16px 10px",
                      borderRadius: "10px",
                      cursor: "pointer",
                      display: "flex",
                      flexDirection: "column",
                      gap: "8px",
                      alignItems: "center",
                      justifyContent: "center",
                      minHeight: "70px",
                      position: "relative",
                      background: selected ? `${theme.accent}24` : mode.cardBg,
                      border: "1px solid " + (selected ? theme.accent : mode.cardBorder),
                      ...revealStyle("style", i),
                    }}
                  >
                    <div
                      style={{
                        position: "absolute",
                        top: "6px",
                        left: "8px",
                        fontSize: "9.5px",
                        fontWeight: 700,
                        letterSpacing: ".03em",
                        color: mode.textFaint3,
                      }}
                    >
                      {font.lang === "both" ? "All" : "Lat"}
                    </div>
                    <div
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleFav(font.name, favFonts, setFavFonts, LS_FAV_FONTS);
                      }}
                      style={{
                        position: "absolute",
                        top: "6px",
                        right: "7px",
                        fontSize: "13px",
                        lineHeight: 1,
                        cursor: "pointer",
                        color: isFav ? theme.accent : mode.textFaint3,
                      }}
                    >
                      ★
                    </div>
                    <div
                      style={{
                        fontSize: "16px",
                        fontWeight: font.weight,
                        fontFamily: cssFontFamily(font.family),
                        fontStyle: font.italic ? "italic" : "normal",
                        color: font.outline ? "transparent" : font.previewColor,
                        textAlign: "center",
                        lineHeight: 1.25,
                        textTransform: font.transform === "uppercase" ? "uppercase" : "none",
                        WebkitTextStroke: font.outline ? "1px " + font.previewColor : undefined,
                        textShadow: font.glow ? "0 0 10px " + font.previewColor : undefined,
                      }}
                    >
                      {font.name}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {sectionHeader("animation", L.captionAnimationLabel, true)}
        <div style={collapseWrapStyle(openSection === "animation", 0.5)}>
          <div style={collapseInnerStyle}>
            {/* Which words are on screen — its own control, not folded into the gallery below.
                Any reveal mode combines with any animation; they are independent fields on the
                wire (contract §8) and are now independent here too.

                Only two of the wire's three values are offered. "phrase" is still valid on the
                wire and still rendered (CaptionOverlay/subtitles.py both handle it), but it has
                no button: it does not actually mean "the whole phrase appears at once" — every
                word still enters at its own `start`, so the only thing it changes versus
                "progressive" is that every word wears the highlight colour instead of just the
                active one. "Whole phrase, all at once" is what `captionAnimation: "none"`
                already gives, so the button was offering a look the user could reach anyway
                under a name that promised something else. A data migration moves the one preset
                and any saved document off "phrase" so nothing is left on a mode with no
                control. */}
            <div style={{ padding: "4px 4px 14px" }}>
              {choiceRow<RevealMode>(
                L.revealModeLabel,
                [
                  { value: "progressive", label: L.revealModeProgressive },
                  { value: "single-word", label: L.revealModeSingleWord },
                ],
                resolvedStyle.revealMode,
                (revealMode) => onChangeOverrides({ revealMode })
              )}
            </div>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", padding: "4px 4px 12px" }}>
              {(["All", "Favorites"] as const).map((filter) => (
                <div
                  key={filter}
                  className="amee-cta-btn"
                  style={chipStyle(animFilter === filter)}
                  onClick={() => setAnimFilter(filter)}
                >
                  {L.chips[filter]}
                </div>
              ))}
            </div>
            <div style={gridStyle}>
              {CAPTION_ANIMATIONS.filter((a) => animFilter === "All" || favAnims.includes(a.id)).map((a, i) => {
                const selected = a.id === selectedAnimId;
                const isFav = favAnims.includes(a.id);
                const hovering = a.id !== "none" && hoveredAnim === a.id;
                return (
                  <div
                    key={a.id}
                    onClick={() => handlePickAnimation(a)}
                    onMouseEnter={a.id === "none" ? undefined : () => setHoveredAnim(a.id)}
                    onMouseLeave={a.id === "none" ? undefined : () => setHoveredAnim(null)}
                    style={{
                      padding: "20px 10px",
                      borderRadius: "10px",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      minHeight: "56px",
                      textAlign: "center",
                      cursor: "pointer",
                      position: "relative",
                      fontSize: "12.5px",
                      fontWeight: 600,
                      color: selected ? theme.text : mode.textFaint2,
                      background: selected ? theme.accent : mode.cardBg,
                      border: "1px solid " + (selected ? theme.accent : mode.cardBorder),
                      ...revealStyle("animation", i),
                    }}
                  >
                    {a.id !== "none" && (
                      <div
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleFav(a.id, favAnims, setFavAnims, LS_FAV_ANIMS);
                        }}
                        style={{
                          position: "absolute",
                          top: "6px",
                          right: "7px",
                          fontSize: "13px",
                          lineHeight: 1,
                          cursor: "pointer",
                          color: isFav ? (selected ? theme.text : theme.accent) : mode.textFaint3,
                        }}
                      >
                        ★
                      </div>
                    )}
                    {hovering && a.keyframe ? (
                      <span key={`${a.id}-hover`} style={{ display: "flex", gap: "6px", justifyContent: "center" }}>
                        {a.name.split(" ").map((word, wi) => (
                          <span
                            key={wi}
                            style={{ display: "inline-block", animation: `${a.keyframe} 500ms ${a.ease} ${wi * 160}ms both` }}
                          >
                            {word}
                          </span>
                        ))}
                      </span>
                    ) : (
                      <span>{a.name}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div style={{ flex: "none", borderTop: "1px solid " + mode.panelBorder, padding: "16px 22px 20px" }}>
        <div style={{ display: "flex", gap: "26px", alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px", flex: 1, minWidth: "140px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11.5px", color: mode.textFaint3 }}>
              <span>{L.captionPositionLabel}</span>
              <span>{Math.round(resolvedStyle.verticalPosition * 100)}%</span>
            </div>
            <input
              type="range"
              min={bounds.verticalPosition.min}
              max={bounds.verticalPosition.max}
              step={0.005}
              value={resolvedStyle.verticalPosition}
              onChange={(e) => onLiveChangeOverrides({ verticalPosition: Number(e.target.value) })}
              onMouseUp={onCommitOverrides}
              onTouchEnd={onCommitOverrides}
              onKeyUp={onCommitOverrides}
              onBlur={onCommitOverrides}
              style={{ width: "100%", accentColor: theme.accent }}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px", flex: 1, minWidth: "140px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11.5px", color: mode.textFaint3 }}>
              <span>{L.fontSizeLabel}</span>
              <span>{Math.round(resolvedStyle.fontSize * 1000) / 10}%</span>
            </div>
            <input
              type="range"
              min={bounds.fontSize.min}
              max={bounds.fontSize.max}
              step={0.001}
              value={resolvedStyle.fontSize}
              onChange={(e) => onLiveChangeOverrides({ fontSize: Number(e.target.value) })}
              onMouseUp={onCommitOverrides}
              onTouchEnd={onCommitOverrides}
              onKeyUp={onCommitOverrides}
              onBlur={onCommitOverrides}
              style={{ width: "100%", accentColor: theme.accent }}
            />
          </div>
          <div style={{ display: "flex", gap: "14px" }}>
            {[
              [0, L.mainColorLabel],
              [1, L.secondColorLabel],
              [2, L.thirdColorLabel],
            ].map(([i, label]) => (
              <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px" }}>
                {(() => {
                  const parsed = parseColorString(highlightColorAt(i as number));
                  const disabled = singleColor && (i as number) > 0;
                  return colorSwatchButton(
                    label as string,
                    parsed.hex,
                    parsed.alpha,
                    (hex, alpha) => handleSwatchChange(i as number, colorWithAlpha(hex, alpha)),
                    { disabled }
                  );
                })()}
                <div style={{ fontSize: "10.5px", color: mode.textFaint3 }}>{label}</div>
              </div>
            ))}
          </div>
        </div>

        <div
          style={{ ...accordionHeaderStyle, borderTop: "none", padding: "14px 0 0" }}
          onClick={() => setMoreOpen((v) => !v)}
        >
          <span>{moreOpen ? L.lessOptions : L.moreOptions}</span>
          <span style={{ fontSize: "10px", color: mode.textFaint }}>{moreOpen ? "▲" : "▼"}</span>
        </div>

        <div style={collapseWrapStyle(moreOpen, 0.4)}>
          <div style={collapseInnerStyle}>
            <div style={{ display: "flex", gap: "26px", alignItems: "flex-end", flexWrap: "wrap", paddingTop: "12px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <div style={{ fontSize: "11.5px", color: mode.textFaint3 }}>{L.fontWeightLabel}</div>
                <div style={{ display: "flex", gap: "6px" }}>
                  {FONT_WEIGHTS.map(({ value, label }) => (
                    <div
                      key={value}
                      className="amee-cta-btn"
                      style={pillStyle(resolvedStyle.fontWeight === value)}
                      onClick={() => onChangeOverrides({ fontWeight: value })}
                    >
                      {label}
                    </div>
                  ))}
                </div>
              </div>
              {yesNoRow(L.uppercaseLabel, resolvedStyle.textTransform === "uppercase", (v) =>
                onChangeOverrides({ textTransform: v ? "uppercase" : "none" })
              )}
              {yesNoRow(L.showPunctuationLabel, resolvedStyle.showPunctuation, (v) =>
                onChangeOverrides({ showPunctuation: v })
              )}
              {yesNoRow(L.italicLabel, resolvedStyle.italic, (v) => onChangeOverrides({ italic: v }))}
              {yesNoRow(L.glowLabel, resolvedStyle.glow, (v) => onChangeOverrides({ glow: v }))}
            </div>

            {outlineOrShadowRow(L.shadowLabel, L.shadowColorLabel, resolvedStyle.shadow, (shadow) =>
              onChangeOverrides({ shadow })
            )}
            {outlineOrShadowRow(L.outlineLabel, L.outlineColorLabel, resolvedStyle.outline, (outline) =>
              onChangeOverrides({ outline })
            )}
          </div>
        </div>
      </div>

      {editingColor && (
        <ColorPickerModal
          key={editingColor.key}
          prefs={prefs}
          hex={editingColor.hex}
          alpha={editingColor.alpha}
          showAlpha={editingColor.showAlpha}
          onChange={editingColor.onChange}
          onClose={() => setEditingColor(null)}
        />
      )}
    </div>
  );
}

const SIZE_LABEL_KEY: Record<OutlineOrShadow["size"], (L: Strings) => string> = {
  none: (L) => L.sizeNone,
  small: (L) => L.sizeSmall,
  medium: (L) => L.sizeMedium,
  large: (L) => L.sizeLarge,
};
