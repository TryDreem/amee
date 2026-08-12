import type { CSSProperties } from "react";

import type { Job } from "../api/client";
import type { Strings } from "../i18n";
import { resolveTheme, UI_MODES, type Prefs } from "../theme";

interface ExportModalProps {
  prefs: Prefs;
  strings: Strings;
  projectName: string;
  status: Job["status"];
  // Job.progress_percent (contract §5): real, computed from ffmpeg's own -progress output --
  // meaningful only while the export's ffmpeg step is actually running. `null` whenever it isn't
  // known yet (queued, not started ffmpeg yet, or Redis evicted it) -- never fabricated; the
  // progress phase falls back to an honest indeterminate bar in that case, same as before this
  // field existed.
  progressPercent?: number | null;
  errorMessage?: string | null;
  onCancel: () => void;
  onReturnToMenu: () => void;
  onContinueEditing: () => void;
  onReturnToEditor: () => void;
  // Step 11c: hides the modal without stopping the export (design's ✕ in the progress phase's
  // corner) -- only shown while still running, matching the design exactly.
  onMinimize: () => void;
}

// Ported from the design's buildExportModalVals/e_exportCardStyle. One real divergence from the
// design: the design's own fake timer always knows exactly how far along it is, so it always
// shows a percentage; Job.progress_percent can genuinely be null (not just "not implemented yet"
// -- see the prop doc above), so the percentage/fill/puck only appear once a real number exists.
// Never fabricate one -- that's the exact mistake this project already reverted once (the
// processing screen's fake ETA timer, Step 2b).
export default function ExportModal({
  prefs,
  strings: L,
  projectName,
  status,
  progressPercent,
  errorMessage,
  onCancel,
  onReturnToMenu,
  onContinueEditing,
  onReturnToEditor,
  onMinimize,
}: ExportModalProps): JSX.Element {
  const mode = UI_MODES[prefs.mode];
  const theme = resolveTheme(prefs.theme, prefs.mode);

  const cardStyle: CSSProperties = {
    position: "relative",
    width: "300px",
    boxSizing: "border-box",
    background: mode.frameBg,
    borderRadius: "16px",
    padding: "32px 26px",
    boxShadow: "0 24px 60px rgba(0,0,0,.45)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "16px",
    border: "1px solid " + mode.cardBorder,
    textAlign: "center",
    animation: "loftIn .35s cubic-bezier(.2,.8,.2,1) both",
  };
  const titleStyle: CSSProperties = { fontSize: "14.5px", fontWeight: 700, color: mode.textMain };
  const nameStyle: CSSProperties = { fontSize: "11.5px", fontWeight: 600, color: mode.textFaint3 };
  const primaryBtnStyle: CSSProperties = {
    flex: 1,
    fontSize: "12px",
    fontWeight: 700,
    color: theme.text,
    padding: "10px 12px",
    borderRadius: "8px",
    cursor: "pointer",
    background: theme.accent,
    textAlign: "center",
  };
  const secondaryBtnStyle: CSSProperties = {
    flex: 1,
    fontSize: "12px",
    fontWeight: 600,
    color: mode.textFaint2,
    padding: "10px 12px",
    borderRadius: "8px",
    cursor: "pointer",
    background: mode.iconBg,
    textAlign: "center",
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.45)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div style={cardStyle}>
        {(status === "queued" || status === "processing") && (
          <>
            <div
              onClick={onMinimize}
              aria-label="Minimize"
              title="Minimize"
              style={{
                position: "absolute",
                top: "12px",
                right: "12px",
                width: "24px",
                height: "24px",
                borderRadius: "50%",
                background: mode.iconBg,
                color: mode.textFaint2,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "14px",
                cursor: "pointer",
              }}
            >
              ✕
            </div>
            <div style={nameStyle}>{projectName}</div>
            <div style={titleStyle}>{L.exporting}</div>
            {progressPercent != null && (
              <div
                style={{
                  fontSize: "38px",
                  fontWeight: 800,
                  color: theme.accent,
                  letterSpacing: "-.5px",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {Math.round(progressPercent)}%
              </div>
            )}
            <div
              style={{
                position: "relative",
                width: "100%",
                height: "10px",
                borderRadius: "999px",
                background: mode.iconBg,
                overflow: progressPercent != null ? "visible" : "hidden",
                marginTop: "2px",
              }}
            >
              {progressPercent != null ? (
                <>
                  <div
                    style={{
                      position: "absolute",
                      left: 0,
                      top: 0,
                      height: "100%",
                      width: `${progressPercent}%`,
                      borderRadius: "999px",
                      background: theme.accent,
                      boxShadow: "0 0 14px " + theme.accent + "aa",
                      // Springy, not a slow linear creep -- same "back" curve used everywhere
                      // else in this app for a snap-into-place feel (index.css's hover pops).
                      // Short enough that it settles well before the next ~2s poll tick, so each
                      // new percentage reads as a distinct little jump forward, not a stall.
                      transition: "width .6s cubic-bezier(.34,1.56,.64,1)",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        position: "absolute",
                        top: 0,
                        bottom: 0,
                        left: 0,
                        width: "50%",
                        background: "linear-gradient(90deg, transparent, rgba(255,255,255,.65), transparent)",
                        animation: "exportShimmer 1.1s linear infinite",
                      }}
                    />
                  </div>
                  <div
                    style={{
                      position: "absolute",
                      top: "50%",
                      left: `${progressPercent}%`,
                      width: "16px",
                      height: "16px",
                      marginLeft: "-8px",
                      marginTop: "-8px",
                      borderRadius: "50%",
                      background: "#fff",
                      boxShadow: "0 0 0 3px " + theme.accent + ", 0 0 12px 2px " + theme.accent + "99",
                      transition: "left .6s cubic-bezier(.34,1.56,.64,1)",
                    }}
                  />
                </>
              ) : (
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    bottom: 0,
                    left: "-35%",
                    width: "35%",
                    borderRadius: "999px",
                    background: theme.accent,
                    boxShadow: "0 0 14px " + theme.accent + "aa",
                    animation: "exportIndeterminate 1.3s ease-in-out infinite",
                  }}
                />
              )}
            </div>
            <div
              onClick={onCancel}
              className="amee-menu-item"
              style={{
                marginTop: "4px",
                fontSize: "12.5px",
                fontWeight: 600,
                color: mode.textFaint2,
                padding: "9px 22px",
                borderRadius: "8px",
                cursor: "pointer",
                background: mode.iconBg,
              }}
            >
              {L.exportCancel}
            </div>
          </>
        )}

        {status === "done" && (
          <>
            <div style={nameStyle}>{projectName}</div>
            <div
              style={{
                width: "54px",
                height: "54px",
                borderRadius: "50%",
                background: "#22c55e",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                animation: "savedCheckPop .4s cubic-bezier(.2,.9,.3,1.3) both",
              }}
            >
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <div style={titleStyle}>{L.exportDone}</div>
            <div style={{ display: "flex", gap: "10px", width: "100%", marginTop: "2px" }}>
              <div onClick={onReturnToMenu} className="amee-cta-btn" style={secondaryBtnStyle}>
                {L.returnToMenu}
              </div>
              <div onClick={onContinueEditing} className="amee-cta-btn" style={primaryBtnStyle}>
                {L.continueEditing}
              </div>
            </div>
          </>
        )}

        {status === "failed" && (
          <>
            <div style={nameStyle}>{projectName}</div>
            <div
              style={{
                width: "54px",
                height: "54px",
                borderRadius: "50%",
                background: "#ef4444",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                animation: "savedCheckPop .4s cubic-bezier(.2,.9,.3,1.3) both",
              }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="18" y1="6" x2="6" y2="18" />
              </svg>
            </div>
            <div style={titleStyle}>{L.exportFailed}</div>
            {errorMessage && (
              <div role="alert" style={{ fontSize: "11px", color: mode.textFaint3, lineHeight: 1.4 }}>
                {errorMessage}
              </div>
            )}
            <div onClick={onReturnToEditor} className="amee-cta-btn" style={{ ...primaryBtnStyle, width: "100%" }}>
              {L.returnToEditor}
            </div>
          </>
        )}

        {/* Not in the source design (its own "Cancel" click faked a "failed" phase, since it had
            no real backend to distinguish the two). Real Job.status: "cancelled" (contract §5) is
            explicitly not an error -- the human's own call this turn -- so this gets its own
            neutral-gray treatment, never the red failed styling, and the same two-choice exit as
            "done" (menu / continue editing) rather than failed's single "go back," since nothing
            actually went wrong. */}
        {status === "cancelled" && (
          <>
            <div style={nameStyle}>{projectName}</div>
            <div
              style={{
                width: "54px",
                height: "54px",
                borderRadius: "50%",
                background: "#6b7280",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                animation: "savedCheckPop .4s cubic-bezier(.2,.9,.3,1.3) both",
              }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <rect x="7" y="7" width="10" height="10" rx="2" fill="#fff" />
              </svg>
            </div>
            <div style={titleStyle}>{L.exportCancelled}</div>
            <div style={{ display: "flex", gap: "10px", width: "100%", marginTop: "2px" }}>
              <div onClick={onReturnToMenu} className="amee-cta-btn" style={secondaryBtnStyle}>
                {L.returnToMenu}
              </div>
              <div onClick={onContinueEditing} className="amee-cta-btn" style={primaryBtnStyle}>
                {L.continueEditing}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
