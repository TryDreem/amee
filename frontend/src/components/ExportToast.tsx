import type { TerminalJobStatus } from "../api/client";
import type { Strings } from "../i18n";
import { resolveTheme, UI_MODES, type Prefs } from "../theme";

interface ExportToastProps {
  prefs: Prefs;
  strings: Strings;
  status: TerminalJobStatus;
  onOpen: () => void;
  onDownload?: () => void; // only ever passed for the "done" case -- nothing to download otherwise
  onDismiss: () => void;
}

const ICON_BG: Record<ExportToastProps["status"], string> = {
  done: "#22c55e",
  failed: "#ef4444",
  // Not an error (contract §5's own distinction) -- neutral gray, not the failed red.
  cancelled: "#6b7280",
};

// Ported from the design's e_exportToastStyle block: bottom-right corner card, shown only while
// the modal is minimized AND the job has actually finished (done, failed, or cancelled) -- a
// still-running minimized export has no persistent indicator of its own, only the ring on the
// Export button. No auto-dismiss timer anywhere in the design's own toast path, confirmed by the
// human this session -- only the ✕ closes it.
export default function ExportToast({
  prefs,
  strings: L,
  status,
  onOpen,
  onDownload,
  onDismiss,
}: ExportToastProps): JSX.Element {
  const mode = UI_MODES[prefs.mode];
  const title = status === "done" ? L.exportDone : status === "cancelled" ? L.exportCancelled : L.exportFailed;

  return (
    <div
      style={{
        position: "fixed",
        bottom: "20px",
        right: "20px",
        zIndex: 60,
        display: "flex",
        alignItems: "flex-start",
        gap: "10px",
        background: mode.frameBg,
        border: "1px solid " + mode.cardBorder,
        borderRadius: "12px",
        padding: "14px 26px 14px 14px",
        boxShadow: "0 16px 40px rgba(0,0,0,.4)",
        maxWidth: "250px",
        animation: "exportToastIn .35s cubic-bezier(.2,.8,.2,1) both",
      }}
    >
      <div
        style={{
          width: "24px",
          height: "24px",
          borderRadius: "50%",
          background: ICON_BG[status],
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flex: "none",
          marginTop: "1px",
        }}
      >
        {status === "done" && (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
        {status === "failed" && (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <line x1="6" y1="6" x2="18" y2="18" />
            <line x1="18" y1="6" x2="6" y2="18" />
          </svg>
        )}
        {status === "cancelled" && (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
            <rect x="7" y="7" width="10" height="10" rx="2" fill="#fff" />
          </svg>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px", flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "12.5px", fontWeight: 700, color: mode.textMain }}>{title}</div>
        <div style={{ display: "flex", gap: "14px" }}>
          {status === "done" && onDownload && (
            <div onClick={onDownload} style={{ fontSize: "11.5px", fontWeight: 600, color: resolveTheme(prefs.theme, prefs.mode).accent, cursor: "pointer" }}>
              {L.exportDownload}
            </div>
          )}
          <div onClick={onOpen} style={{ fontSize: "11.5px", fontWeight: 600, color: resolveTheme(prefs.theme, prefs.mode).accent, cursor: "pointer" }}>
            {L.exportOpen}
          </div>
        </div>
      </div>
      <div
        onClick={onDismiss}
        style={{
          position: "absolute",
          top: "8px",
          right: "8px",
          width: "16px",
          height: "16px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: mode.textFaint3,
          fontSize: "9px",
          cursor: "pointer",
        }}
      >
        ✕
      </div>
    </div>
  );
}
