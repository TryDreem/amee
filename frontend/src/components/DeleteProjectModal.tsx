import type { Strings } from "../i18n";
import { UI_MODES, type Prefs } from "../theme";

interface DeleteProjectModalProps {
  prefs: Prefs;
  strings: Strings;
  projectName: string;
  busy: boolean;
  errorMessage?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

// Ported from the design's h_confirm* block: a centered, icon+title+name+Yes/No modal -- a
// different pattern from the Editor's own inline segment-delete confirm (that one's a two-step
// "tap again" row, not a modal). The design's own delete is a client-side array filter with no
// failure mode; the real DELETE /projects/{id} can come back 409 (a transcribe job is still
// running -- contract §4, backend refuses rather than cancelling, since WhisperX has no OS
// process to signal) or 404 (already gone) -- errorMessage surfaces that, new relative to source.
export default function DeleteProjectModal({
  prefs,
  strings: L,
  projectName,
  busy,
  errorMessage,
  onConfirm,
  onCancel,
}: DeleteProjectModalProps): JSX.Element {
  const mode = UI_MODES[prefs.mode];
  const isLight = prefs.mode === "light";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,.5)",
        backdropFilter: "blur(2px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "320px",
          padding: "26px 24px",
          borderRadius: "16px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
          gap: "6px",
          background: mode.frameBg,
          border: "1px solid " + mode.panelBorder2,
          boxShadow: "0 20px 50px rgba(0,0,0,.4)",
          animation: "confirmModalIn .22s cubic-bezier(.2,.8,.2,1) both",
        }}
      >
        <div
          style={{
            width: "44px",
            height: "44px",
            borderRadius: "50%",
            background: "rgba(239,68,68,.12)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: "6px",
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            <path d="M10 11v6" />
            <path d="M14 11v6" />
            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
          </svg>
        </div>
        <div style={{ fontSize: "16.5px", fontWeight: 700, color: mode.textMain }}>{L.confirmDeleteTitle}</div>
        <div style={{ fontSize: "13px", color: mode.textFaint3, marginBottom: errorMessage ? "4px" : "12px" }}>
          {projectName}
        </div>
        {errorMessage && (
          <div role="alert" style={{ fontSize: "12px", color: "#ef4444", lineHeight: 1.4, marginBottom: "12px" }}>
            {errorMessage}
          </div>
        )}
        <div style={{ display: "flex", gap: "10px", width: "100%" }}>
          <div
            onClick={busy ? undefined : onCancel}
            className="amee-cta-btn"
            style={{
              flex: 1,
              padding: "11px",
              borderRadius: "10px",
              fontSize: "13.5px",
              fontWeight: 700,
              cursor: busy ? "default" : "pointer",
              textAlign: "center",
              background: isLight ? "rgba(0,0,0,.06)" : "rgba(255,255,255,.08)",
              color: mode.textMain,
              opacity: busy ? 0.6 : 1,
            }}
          >
            {L.no}
          </div>
          <div
            onClick={busy ? undefined : onConfirm}
            className="amee-cta-btn"
            style={{
              flex: 1,
              padding: "11px",
              borderRadius: "10px",
              fontSize: "13.5px",
              fontWeight: 700,
              cursor: busy ? "default" : "pointer",
              textAlign: "center",
              background: "#ef4444",
              color: "#ffffff",
              opacity: busy ? 0.7 : 1,
            }}
          >
            {L.yes}
          </div>
        </div>
      </div>
    </div>
  );
}
