import type { Strings } from "../i18n";
import { UI_MODES, type Prefs } from "../theme";

interface UploadNoticeProps {
  prefs: Prefs;
  strings: Strings;
  onClose: () => void;
}

// Same backdrop + centered card as AuthModal/ExportModal/DeleteProjectModal — a one-time-per-tab
// heads-up shown on the Upload screen (see UploadZone.tsx's sessionStorage-backed dismissal),
// explaining why the first upload/export today might be slow: VM#2's auto Start/Deallocate
// (app/integrations/azure_vm.py, scripts/ops/vm2_self_deallocate.py) means the processing server
// isn't always running.
export default function UploadNotice({ prefs, strings: L, onClose }: UploadNoticeProps): JSX.Element {
  const mode = UI_MODES[prefs.mode];

  return (
    <div
      onClick={onClose}
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
          position: "relative",
          width: "360px",
          padding: "28px 24px",
          borderRadius: "16px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
          gap: "16px",
          background: mode.frameBg,
          border: "1px solid " + mode.panelBorder2,
          boxShadow: "0 20px 50px rgba(0,0,0,.4)",
          animation: "confirmModalIn .22s cubic-bezier(.2,.8,.2,1) both",
        }}
      >
        <div
          onClick={onClose}
          aria-label={L.close}
          title={L.close}
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

        <div style={{ fontSize: "16.5px", fontWeight: 700, color: mode.textMain }}>
          {L.uploadNoticeTitle}
        </div>

        <div style={{ fontSize: "13.5px", lineHeight: 1.5, color: mode.textFaint2 }}>
          {L.uploadNoticeBody}
        </div>

        <div
          onClick={onClose}
          className="amee-cta-btn"
          style={{
            width: "100%",
            padding: "11px",
            borderRadius: "10px",
            fontSize: "13.5px",
            fontWeight: 700,
            cursor: "pointer",
            textAlign: "center",
            background: mode.textMain,
            color: mode.pageBg,
          }}
        >
          {L.uploadNoticeGotIt}
        </div>
      </div>
    </div>
  );
}
