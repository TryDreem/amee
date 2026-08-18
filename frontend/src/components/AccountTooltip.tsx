import type { CSSProperties } from "react";

import type { Strings } from "../i18n";
import { resolveTheme, UI_MODES, type Prefs } from "../theme";

interface AccountTooltipProps {
  prefs: Prefs;
  strings: Strings;
  projectCount: number;
  projectCap: number;
  onSignIn: () => void;
  onContinueAsGuest: () => void;
}

// Logged-out popover content -- just the panel box, same visual language as TopBar's own "⋯"
// dropdown (mode.frameBg/panelBorder2/menuPanelIn). TopBar owns the backdrop + open/close state
// (plan §2: account UI is structurally the same kind of thing TopBar already owns for its "⋯"
// menu) -- this component only renders what's inside the panel once it's open.
export default function AccountTooltip({
  prefs,
  strings: L,
  projectCount,
  projectCap,
  onSignIn,
  onContinueAsGuest,
}: AccountTooltipProps): JSX.Element {
  const mode = UI_MODES[prefs.mode];
  const theme = resolveTheme(prefs.theme, prefs.mode);
  const atCap = projectCount >= projectCap;

  return (
    <div style={panelStyle(mode)}>
      <div style={{ fontSize: "13.5px", fontWeight: 700, color: mode.textMain, marginBottom: "12px" }}>
        {L.notRegisteredYet}
      </div>
      <div onClick={onSignIn} className="amee-cta-btn" style={primaryBtnStyle(theme)}>
        {L.signIn}
      </div>
      <div
        onClick={onContinueAsGuest}
        className="amee-menu-item"
        style={{
          marginTop: "10px",
          padding: "8px",
          borderRadius: "8px",
          fontSize: "12.5px",
          fontWeight: 600,
          color: mode.textFaint2,
          textAlign: "center",
          cursor: "pointer",
        }}
      >
        {L.continueAsGuest}
      </div>
      <div
        style={{
          marginTop: "12px",
          fontSize: "11px",
          fontWeight: 600,
          color: atCap ? "#ef4444" : mode.textFaint3,
          textAlign: "center",
        }}
      >
        {L.projectsUploadedLabel(projectCount, projectCap)}
      </div>
    </div>
  );
}

function panelStyle(mode: { frameBg: string; panelBorder2: string }): CSSProperties {
  return {
    position: "absolute",
    top: "42px",
    right: 0,
    zIndex: 21,
    width: "236px",
    padding: "16px",
    borderRadius: "12px",
    background: mode.frameBg,
    border: "1px solid " + mode.panelBorder2,
    boxShadow: "0 12px 32px rgba(0,0,0,.35)",
    transformOrigin: "top right",
    animation: "menuPanelIn .22s cubic-bezier(.2,.8,.2,1) both",
  };
}

function primaryBtnStyle(theme: { accent: string; text: string }): CSSProperties {
  return {
    padding: "10px 12px",
    borderRadius: "8px",
    fontSize: "12.5px",
    fontWeight: 700,
    cursor: "pointer",
    textAlign: "center",
    background: theme.accent,
    color: theme.text,
  };
}
