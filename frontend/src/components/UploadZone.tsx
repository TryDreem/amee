import { useRef, useState } from "react";

import { STR } from "../i18n";
import { resolveTheme, UI_MODES, type Prefs } from "../theme";

interface UploadZoneProps {
  prefs: Prefs;
  onBack: () => void;
  onFileSelected: (file: File) => void;
  busy: boolean;
  errorMessage: string | null;
}

export default function UploadZone({
  prefs,
  onBack,
  onFileSelected,
  busy,
  errorMessage,
}: UploadZoneProps): JSX.Element {
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const mode = UI_MODES[prefs.mode];
  const theme = resolveTheme(prefs.theme, prefs.mode);
  const L = STR[prefs.lang];

  function pickFile(file: File | null | undefined) {
    if (!file || busy) {
      return;
    }
    onFileSelected(file);
  }

  return (
    <div
      style={{
        maxWidth: "1200px",
        margin: "0 auto",
        padding: "48px 32px 80px",
        animation: "homeUploadIn .4s ease both",
      }}
    >
      <div
        onClick={onBack}
        className="amee-back-link"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          fontSize: "13px",
          fontWeight: 600,
          color: mode.textFaint2,
          cursor: "pointer",
          marginBottom: "36px",
          width: "fit-content",
        }}
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="19" y1="12" x2="5" y2="12" />
          <polyline points="11 5 5 12 11 19" />
        </svg>
        <span>{L.backToProjects}</span>
      </div>

      <div
        style={{
          maxWidth: "560px",
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          gap: "6px",
          alignItems: "center",
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: "24px", fontWeight: 800, color: mode.textMain }}>{L.newProject}</div>
        <div style={{ fontSize: "13.5px", color: mode.textFaint, marginBottom: "26px" }}>
          {L.newProjectSub}
        </div>

        <div
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            if (!busy) {
              setDragOver(true);
            }
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            pickFile(e.dataTransfer.files[0]);
          }}
          style={{
            width: "100%",
            minHeight: "220px",
            borderRadius: "16px",
            cursor: busy ? "default" : "pointer",
            border: "2px dashed " + (dragOver ? theme.accent : mode.dashBorder),
            background: dragOver ? `rgba(${theme.tint ?? "255,255,255"},.06)` : mode.frameBg,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "10px",
            opacity: busy ? 0.6 : 1,
          }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="video/mp4,video/quicktime"
            onChange={(e) => pickFile(e.target.files?.[0])}
            data-testid="upload-file-input"
          />
          <div
            style={{
              width: "44px",
              height: "44px",
              borderRadius: "50%",
              background: mode.iconBg,
              color: mode.iconText,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg
              width="26"
              height="26"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 16V4" />
              <polyline points="7 8.5 12 3.5 17 8.5" />
              <path d="M4 16.5v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
            </svg>
          </div>
          <div style={{ fontSize: "15px", fontWeight: 600, color: mode.textMain }}>
            {busy ? "…" : L.dragHere}
          </div>
          {!busy && (
            <div style={{ fontSize: "12.5px", color: mode.textFaint3 }}>{L.orClick}</div>
          )}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            fontSize: "12px",
            color: mode.textFaint3,
            marginTop: "16px",
          }}
        >
          <span>MP4, MOV</span>
          <span style={{ opacity: 0.6 }}>·</span>
          <span>{L.upTo4k}</span>
          <span style={{ opacity: 0.6 }}>·</span>
          <span>{L.upTo2gb}</span>
          <span style={{ opacity: 0.6 }}>·</span>
          <span>{L.upTo10min}</span>
        </div>

        {errorMessage && (
          <div role="alert" style={{ marginTop: "16px", fontSize: "13px", color: "#ef4444" }}>
            {errorMessage}
          </div>
        )}
      </div>
    </div>
  );
}
