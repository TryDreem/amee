import { useRef, useState } from "react";

import { STR } from "../i18n";
import { resolveTheme, UI_MODES, type Prefs } from "../theme";
import { AUTO_LANGUAGE_CODE, VIDEO_LANGUAGES } from "../lib/languages";

interface UploadZoneProps {
  prefs: Prefs;
  onBack: () => void;
  onFileSelected: (file: File, language: string) => void;
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
  const [language, setLanguage] = useState(AUTO_LANGUAGE_CODE);
  const [langMenuOpen, setLangMenuOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const mode = UI_MODES[prefs.mode];
  const isLight = prefs.mode === "light";
  const theme = resolveTheme(prefs.theme, prefs.mode);
  const L = STR[prefs.lang];

  const selectedLanguage =
    language === AUTO_LANGUAGE_CODE
      ? { code: AUTO_LANGUAGE_CODE, flag: "🌐", name: L.autoDetect }
      : (VIDEO_LANGUAGES.find((l) => l.code === language) ?? {
          code: AUTO_LANGUAGE_CODE,
          flag: "🌐",
          name: L.autoDetect,
        });

  function pickFile(file: File | null | undefined) {
    if (!file || busy) {
      return;
    }
    onFileSelected(file, language);
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
            position: "relative",
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

          {!busy && (
            <div
              onClick={(e) => {
                e.stopPropagation();
                setLangMenuOpen((v) => !v);
              }}
              style={{
                position: "absolute",
                top: "12px",
                right: "12px",
                zIndex: 2,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "6px 10px 6px 8px",
                borderRadius: "10px",
                background: langMenuOpen
                  ? isLight
                    ? "rgba(0,0,0,.08)"
                    : "rgba(255,255,255,.14)"
                  : isLight
                    ? "rgba(0,0,0,.05)"
                    : "rgba(255,255,255,.08)",
                color: mode.textFaint2,
                border: "1px solid " + mode.panelBorder2,
              }}
            >
              <span style={{ fontSize: "16px", lineHeight: 1 }}>{selectedLanguage.flag}</span>
              <span style={{ fontSize: "12px", fontWeight: 600, color: mode.textMain, whiteSpace: "nowrap" }}>
                {selectedLanguage.name}
              </span>
              <span style={{ fontSize: "9px", opacity: 0.7, marginLeft: "2px" }}>
                {langMenuOpen ? "▲" : "▾"}
              </span>
            </div>
          )}

          {langMenuOpen && (
            <>
              <div
                onClick={(e) => {
                  e.stopPropagation();
                  setLangMenuOpen(false);
                }}
                style={{ position: "fixed", inset: 0, zIndex: 20 }}
              />
              <div
                onClick={(e) => e.stopPropagation()}
                data-testid="video-language-panel"
                style={{
                  position: "absolute",
                  top: "52px",
                  right: "12px",
                  zIndex: 22,
                  width: "220px",
                  maxHeight: "320px",
                  overflowY: "auto",
                  padding: "10px",
                  borderRadius: "12px",
                  background: isLight ? "rgba(255,255,255,.98)" : "rgba(24,24,27,.97)",
                  border: "1px solid " + mode.panelBorder2,
                  boxShadow: "0 16px 40px rgba(0,0,0,.4)",
                  animation: "videoLangMenuIn .22s cubic-bezier(.2,.8,.2,1) both",
                }}
              >
                {[{ code: AUTO_LANGUAGE_CODE, flag: "🌐", name: L.autoDetect }, ...VIDEO_LANGUAGES].map(
                  (opt) => {
                    const active = language === opt.code;
                    return (
                      <div
                        key={opt.code}
                        onClick={(e) => {
                          e.stopPropagation();
                          setLanguage(opt.code);
                          setLangMenuOpen(false);
                        }}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "10px",
                          padding: "8px 10px",
                          borderRadius: "8px",
                          cursor: "pointer",
                          fontSize: "13px",
                          fontWeight: active ? 700 : 500,
                          color: active ? theme.text : mode.textMain,
                          background: active ? theme.accent : "transparent",
                        }}
                      >
                        <span style={{ fontSize: "15px" }}>{opt.flag}</span>
                        <span>{opt.name}</span>
                      </div>
                    );
                  }
                )}
              </div>
            </>
          )}

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
          <span>{L.upTo100mb}</span>
          <span style={{ opacity: 0.6 }}>·</span>
          <span>{L.upTo1min}</span>
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
