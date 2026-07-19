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
                style={{
                  fontSize: "12.5px",
                  fontWeight: 600,
                  padding: "8px 14px",
                  borderRadius: "8px",
                  cursor: "pointer",
                  background: active ? theme.accent : mode.iconBg,
                  color: active ? theme.text : mode.iconText,
                }}
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
    </div>
  );
}
