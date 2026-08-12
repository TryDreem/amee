import { useState, type CSSProperties, type ReactNode } from "react";

import { THEME_ORDER, UI_MODES, resolveTheme, type Prefs } from "../theme";
import { STR } from "../i18n";

interface TopBarProps {
  prefs: Prefs;
  onUpdatePrefs: (patch: Partial<Prefs>) => void;
  // Step 11d: Home's export ring badge sits immediately left of the "⋯" menu (design:
  // h_exportBadgeShow, same flex row as h_onMenuToggle). Editor doesn't use TopBar at all, so
  // this stays optional rather than every caller having to pass `undefined`.
  beforeMenu?: ReactNode;
}

export default function TopBar({ prefs, onUpdatePrefs, beforeMenu }: TopBarProps): JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const [langMenuOpen, setLangMenuOpen] = useState(false);

  const mode = UI_MODES[prefs.mode];
  const isLight = prefs.mode === "light";
  const L = STR[prefs.lang];

  return (
    <div
      style={{
        height: "64px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 32px",
        borderBottom: "1px solid " + mode.panelBorder,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <div
          className="amee-logo-mark"
          style={{
            width: "30px",
            height: "30px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
          }}
        >
          <img src="/amee-logo.png" alt="Amee" width={30} height={30} style={{ borderRadius: "9px" }} />
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        {beforeMenu}
        <div style={{ position: "relative" }}>
          <div
            onClick={() => setMenuOpen((v) => !v)}
            className="amee-icon-btn"
            style={{
              width: "32px",
              height: "32px",
              borderRadius: "8px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              color: mode.textFaint2,
              background: menuOpen ? (isLight ? "rgba(0,0,0,.07)" : "rgba(255,255,255,.1)") : "transparent",
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="5" r="2" />
              <circle cx="12" cy="12" r="2" />
              <circle cx="12" cy="19" r="2" />
            </svg>
          </div>

          {menuOpen && (
            <>
              <div
                onClick={() => setMenuOpen(false)}
                style={{ position: "fixed", inset: 0, zIndex: 20 }}
              />
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  position: "absolute",
                  top: "42px",
                  right: "0",
                  zIndex: 21,
                  width: "220px",
                  padding: "14px",
                  borderRadius: "12px",
                  background: mode.frameBg,
                  border: "1px solid " + mode.panelBorder2,
                  boxShadow: "0 12px 32px rgba(0,0,0,.35)",
                  transformOrigin: "top right",
                  animation: "menuPanelIn .22s cubic-bezier(.2,.8,.2,1) both",
                }}
              >
                <div style={sectionLabelStyle(mode.textFaint3)}>{L.themeLabel}</div>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px" }}>
                  {THEME_ORDER.map((key) => {
                    const t = resolveTheme(key, prefs.mode);
                    const active = prefs.theme === key;
                    return (
                      <div
                        key={key}
                        onClick={() => onUpdatePrefs({ theme: key })}
                        title={t.label}
                        style={{
                          width: "18px",
                          height: "18px",
                          borderRadius: "50%",
                          cursor: "pointer",
                          background: t.accent,
                          border: active
                            ? "2px solid #fff"
                            : key === "mono"
                              ? "2px solid rgba(255,255,255,.35)"
                              : "2px solid transparent",
                          boxShadow: active ? "0 0 0 2px rgba(0,0,0,.5)" : "none",
                        }}
                      />
                    );
                  })}
                </div>

                <div style={sectionLabelStyle(mode.textFaint3)}>{L.languageLabel}</div>
                <div
                  onClick={() => setLangMenuOpen((v) => !v)}
                  style={menuRowStyle(mode, isLight)}
                >
                  <span>{prefs.lang === "ru" ? "Русский" : "English"}</span>
                  <span style={{ fontSize: "12px", fontWeight: 700, color: mode.textFaint3 }}>
                    {langMenuOpen ? "▲" : "▼"}
                  </span>
                </div>
                {langMenuOpen && (
                  <div style={{ padding: "0 0 14px" }}>
                    {(["ru", "en"] as const).map((id) => {
                      const active = prefs.lang === id;
                      return (
                        <div
                          key={id}
                          onClick={() => {
                            onUpdatePrefs({ lang: id });
                            setLangMenuOpen(false);
                          }}
                          style={{
                            padding: "9px 10px",
                            borderRadius: "8px",
                            cursor: "pointer",
                            marginBottom: "6px",
                            fontSize: "13px",
                            fontWeight: active ? 700 : 500,
                            color: active ? mode.textMain : mode.textFaint2,
                            background: active
                              ? isLight
                                ? "rgba(0,0,0,.06)"
                                : "rgba(255,255,255,.08)"
                              : "transparent",
                          }}
                        >
                          {id === "ru" ? "Русский" : "English"}
                        </div>
                      );
                    })}
                  </div>
                )}

                <div style={sectionLabelStyle(mode.textFaint3)}>{L.appearanceLabel}</div>
                <div
                  onClick={() => onUpdatePrefs({ mode: prefs.mode === "dark" ? "light" : "dark" })}
                  style={menuRowStyle(mode, isLight)}
                >
                  <span>{prefs.mode === "dark" ? L.dark : L.light}</span>
                  <span style={{ fontSize: "12px", fontWeight: 700, color: mode.textFaint3 }}>
                    {prefs.mode === "dark" ? L.dark : L.light}
                  </span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function sectionLabelStyle(color: string): CSSProperties {
  return {
    font: "600 10.5px system-ui,sans-serif",
    letterSpacing: ".04em",
    textTransform: "uppercase",
    color,
    marginBottom: "8px",
  };
}

function menuRowStyle(
  mode: { textMain: string },
  isLight: boolean
): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "10px",
    padding: "9px 10px",
    borderRadius: "8px",
    cursor: "pointer",
    marginBottom: "14px",
    fontSize: "13px",
    fontWeight: 600,
    color: mode.textMain,
    background: isLight ? "rgba(0,0,0,.04)" : "rgba(255,255,255,.05)",
  };
}
