import { useEffect, useState, type CSSProperties } from "react";

import type { OutlineOrShadow, Preset, PresetBase, StyleOverrides } from "../api/client";
import ColorPickerModal from "./ColorPickerModal";
import type { Strings } from "../i18n";
import { colorWithAlpha, DEFAULT_HIGHLIGHT_COLORS, parseColorString } from "../lib/color";
import { FONT_OPTIONS } from "../lib/fonts";
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
}

const FONT_WEIGHTS: { value: number; label: string }[] = [
  { value: 400, label: "Regular" },
  { value: 600, label: "Semibold" },
  { value: 700, label: "Bold" },
  { value: 900, label: "Black" },
];

const OUTLINE_SHADOW_SIZES: OutlineOrShadow["size"][] = ["none", "small", "medium", "large"];

// Design layout: scrollable accordion sections (Presets, Style — the font gallery) up top,
// then a pinned (non-scrolling) bottom strip — Caption Position / Font size / colors always
// visible, with a "More options" toggle revealing the rest (`Video Subtitle Editor.dc.html`
// e_pinnedControlsStyle).
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
}: StylePanelProps): JSX.Element {
  const mode = UI_MODES[prefs.mode];
  const theme = resolveTheme(prefs.theme, prefs.mode);

  // Mutually exclusive, matching the design's own `openSection` (single value, not
  // independent booleans) — opening one section closes whichever was open.
  const [openSection, setOpenSection] = useState<"presets" | "style" | null>("presets");
  const [moreOpen, setMoreOpen] = useState(false);

  // Which field a click on a color swatch is currently editing — a single modal instance
  // serves all of them (3 highlight swatches + shadow + outline).
  const [editingColor, setEditingColor] = useState<{
    key: string;
    hex: string;
    alpha: number;
    showAlpha: boolean;
    onChange: (hex: string, alpha: number) => void;
  } | null>(null);

  // Staggered card reveal on section open, ported from the design's _scheduleReveal/
  // _revealStyle: height animates via collapseWrapStyle below; independently, each card
  // inside fades/slides/scales in with a per-index delay once the section is open. The 20ms
  // deferred setState (instead of setting revealed synchronously) forces a render with the
  // "hidden" style first, so the transition to "revealed" actually has something to animate
  // from — same trick the design uses.
  const [revealSection, setRevealSection] = useState<"presets" | "style" | null>(null);
  // Once the stagger has finished playing, stop setting an inline transition at all — the
  // design's own "moreSettled" pattern (used there for overflow, here for the same reason):
  // an inline `transition` value would otherwise permanently override the `.amee-grid-card`
  // stylesheet hover transition on the same property, killing hover-scale after the reveal.
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

  function revealStyle(sectionId: "presets" | "style", index: number): CSSProperties {
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

  // 3 fixed slots (StyleOverrides.highlightColors is a plain string[] — contract §8). No
  // dedicated alpha field, so alpha is folded straight into the stored color string via
  // colorWithAlpha (plain hex at 100%, rgba() below that) — same technique the design's own
  // buildStylePack uses to assemble this array, not a schema gap.
  // CaptionOverlay already round-robins this array per segment and degrades to one fixed color
  // at length 1, so writing all 3 slots as soon as any one changes needs no special case.
  // Unset slots default to a colorful fixed palette (DEFAULT_HIGHLIGHT_COLORS), not a repeat
  // of slot 0 — matches the design's own distinct main/second/third defaults.
  function highlightColorAt(index: number): string {
    return resolvedStyle.highlightColors[index] ?? DEFAULT_HIGHLIGHT_COLORS[index] ?? "#ffffff";
  }
  function handleSwatchChange(index: number, color: string) {
    // Per-phrase (single-color) mode writes a length-1 array — one fixed color for this segment
    // (arch §4.2). Normal mode writes all 3 slots.
    const next = singleColor ? [color] : [0, 1, 2].map((i) => (i === index ? color : highlightColorAt(i)));
    onChangeOverrides({ highlightColors: next });
  }

  // Plain colored button (not a native <input type="color">) — opens the custom
  // ColorPickerModal, matching the design's own swatch + modal pattern instead of relying on
  // the browser's native, unstyleable color picker.
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
        <div
          style={accordionHeaderStyle}
          onClick={() => setOpenSection((v) => (v === "presets" ? null : "presets"))}
        >
          <span>{L.presetsLabel}</span>
          <span style={{ fontSize: "10px", color: mode.textFaint }}>{openSection === "presets" ? "▲" : "▼"}</span>
        </div>
        <div style={collapseWrapStyle(openSection === "presets", 0.5)}>
          <div style={collapseInnerStyle}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                gap: "12px",
                padding: "4px 4px 16px",
              }}
            >
              {presets.map((preset, i) => (
                <div
                  key={preset.id}
                  onClick={() => onSelectPreset(preset.id)}
                  className="amee-grid-card"
                  style={{
                    padding: "16px 10px",
                    borderRadius: "10px",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    minHeight: "70px",
                    textAlign: "center",
                    fontSize: "12.5px",
                    fontWeight: 600,
                    background: preset.id === activePresetId ? `${theme.accent}24` : mode.cardBg,
                    border: "1px solid " + (preset.id === activePresetId ? theme.accent : mode.cardBorder),
                    color: mode.textMain,
                    ...revealStyle("presets", i),
                  }}
                >
                  {preset.name}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div
          style={{ ...accordionHeaderStyle, borderTop: "1px solid " + mode.panelBorder }}
          onClick={() => setOpenSection((v) => (v === "style" ? null : "style"))}
        >
          <span>{L.styleSectionLabel}</span>
          <span style={{ fontSize: "10px", color: mode.textFaint }}>{openSection === "style" ? "▲" : "▼"}</span>
        </div>
        <div style={collapseWrapStyle(openSection === "style", 0.5)}>
          <div style={collapseInnerStyle}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                gap: "12px",
                padding: "4px 4px 16px",
              }}
            >
              {FONT_OPTIONS.map((font, i) => (
                <div
                  key={font.family}
                  onClick={() => onChangeOverrides({ fontFamily: font.family })}
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
                    background: resolvedStyle.fontFamily === font.family ? `${theme.accent}24` : mode.cardBg,
                    border:
                      "1px solid " +
                      (resolvedStyle.fontFamily === font.family ? theme.accent : mode.cardBorder),
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
                    All
                  </div>
                  <div
                    style={{ position: "absolute", top: "6px", right: "7px", fontSize: "13px", lineHeight: 1, color: mode.textFaint3 }}
                  >
                    ★
                  </div>
                  <div
                    style={{
                      fontSize: "16px",
                      fontWeight: font.weight,
                      fontFamily: font.family,
                      fontStyle: font.italic ? "italic" : "normal",
                      color: font.previewColor,
                      textAlign: "center",
                      lineHeight: 1.25,
                    }}
                  >
                    {font.family}
                  </div>
                </div>
              ))}
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
              onChange={(e) => onChangeOverrides({ verticalPosition: Number(e.target.value) })}
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
              onChange={(e) => onChangeOverrides({ fontSize: Number(e.target.value) })}
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
                  // In per-phrase single-color mode only "Main" (slot 0) is editable.
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
