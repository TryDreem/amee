import type { CSSProperties } from "react";

import type { Preset, PresetBase, StyleOverrides } from "../api/client";
import type { Strings } from "../i18n";
import { resolveTheme, UI_MODES, type Prefs } from "../theme";

interface StylePanelProps {
  prefs: Prefs;
  strings: Strings;
  presets: Preset[];
  activePresetId: string;
  resolvedStyle: PresetBase;
  bounds: Preset["bounds"];
  onSelectPreset: (presetId: string) => void;
  onChangeOverrides: (patch: StyleOverrides) => void;
}

export default function StylePanel({
  prefs,
  strings: L,
  presets,
  activePresetId,
  resolvedStyle,
  bounds,
  onSelectPreset,
  onChangeOverrides,
}: StylePanelProps): JSX.Element {
  const mode = UI_MODES[prefs.mode];
  const theme = resolveTheme(prefs.theme, prefs.mode);

  const sectionLabelStyle: CSSProperties = {
    fontSize: "11.5px",
    fontWeight: 700,
    color: mode.textFaint3,
    textTransform: "uppercase",
    letterSpacing: ".04em",
    marginBottom: "10px",
  };

  // 3 fixed slots, no alpha (StyleOverrides.highlightColors is a plain string[] — contract §8).
  // CaptionOverlay already round-robins this array per segment and degrades to one fixed color
  // at length 1, so writing all 3 slots as soon as any one changes needs no special case.
  function handleSwatchChange(index: number, color: string) {
    const current = resolvedStyle.highlightColors;
    const next = [0, 1, 2].map((i) => (i === index ? color : current[i] ?? current[0] ?? "#ffffff"));
    onChangeOverrides({ highlightColors: next });
  }

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
      <div>
        <div style={sectionLabelStyle}>{label}</div>
        <div style={{ display: "flex", gap: "8px" }}>
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "26px" }}>
      <div>
        <div style={sectionLabelStyle}>{L.presetsLabel}</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
          {presets.map((preset) => {
            const active = preset.id === activePresetId;
            return (
              <div
                key={preset.id}
                onClick={() => onSelectPreset(preset.id)}
                className="amee-cta-btn"
                style={pillStyle(active)}
              >
                {preset.name}
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <div style={{ display: "flex", justifyContent: "space-between", ...sectionLabelStyle }}>
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

      <div>
        <div style={{ display: "flex", justifyContent: "space-between", ...sectionLabelStyle }}>
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

      <div>
        <div style={sectionLabelStyle}>{L.highlightColorsLabel}</div>
        <div style={{ display: "flex", gap: "10px" }}>
          {[0, 1, 2].map((i) => (
            <input
              key={i}
              type="color"
              value={resolvedStyle.highlightColors[i] ?? resolvedStyle.highlightColors[0] ?? "#ffffff"}
              onChange={(e) => handleSwatchChange(i, e.target.value)}
              style={{
                width: "36px",
                height: "36px",
                borderRadius: "8px",
                border: "1px solid " + mode.cardBorder,
                padding: 0,
                cursor: "pointer",
                background: "none",
              }}
            />
          ))}
        </div>
      </div>

      <div>
        <div style={sectionLabelStyle}>{L.fontWeightLabel}</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
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

      {yesNoRow(L.uppercaseLabel, resolvedStyle.textTransform === "uppercase", (value) =>
        onChangeOverrides({ textTransform: value ? "uppercase" : "none" })
      )}
      {yesNoRow(L.italicLabel, resolvedStyle.italic, (value) => onChangeOverrides({ italic: value }))}
      {yesNoRow(L.glowLabel, resolvedStyle.glow, (value) => onChangeOverrides({ glow: value }))}
      {yesNoRow(L.showPunctuationLabel, resolvedStyle.showPunctuation, (value) =>
        onChangeOverrides({ showPunctuation: value })
      )}
    </div>
  );
}

const FONT_WEIGHTS: { value: number; label: string }[] = [
  { value: 400, label: "Regular" },
  { value: 600, label: "Semibold" },
  { value: 700, label: "Bold" },
  { value: 900, label: "Black" },
];
