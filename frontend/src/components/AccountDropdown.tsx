import { useRef, type CSSProperties } from "react";

import { resolveMediaUrl } from "../api/client";
import type { Strings } from "../i18n";
import { UI_MODES, type Prefs } from "../theme";

interface AccountDropdownProps {
  prefs: Prefs;
  strings: Strings;
  name: string | null;
  email: string;
  avatarUrl: string | null;
  projectCount: number;
  projectCap: number;
  photoBusy: boolean;
  photoError?: string | null;
  onChangePhoto: (file: File) => void;
  onLogOut: () => void;
}

// Logged-in popover content -- same "just the panel box" split as AccountTooltip; TopBar owns
// open/close.
export default function AccountDropdown({
  prefs,
  strings: L,
  name,
  email,
  avatarUrl,
  projectCount,
  projectCap,
  photoBusy,
  photoError,
  onChangePhoto,
  onLogOut,
}: AccountDropdownProps): JSX.Element {
  const mode = UI_MODES[prefs.mode];
  const isLight = prefs.mode === "light";
  const atCap = projectCount >= projectCap;
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div style={panelStyle(mode)}>
      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "14px" }}>
        <div
          onClick={() => !photoBusy && fileInputRef.current?.click()}
          title={L.changePhotoLabel}
          style={{
            position: "relative",
            width: "44px",
            height: "44px",
            flex: "none",
            borderRadius: "50%",
            cursor: photoBusy ? "default" : "pointer",
            overflow: "hidden",
            background: mode.iconBg,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            opacity: photoBusy ? 0.6 : 1,
          }}
        >
          {avatarUrl ? (
            <img
              src={resolveMediaUrl(avatarUrl)}
              alt=""
              data-testid="account-avatar-img"
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={mode.iconText} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          )}
          <div
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              height: "16px",
              background: "rgba(0,0,0,.45)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                onChangePhoto(file);
              }
              e.target.value = "";
            }}
          />
        </div>
        <div style={{ minWidth: 0 }}>
          {name && (
            <div
              style={{
                fontSize: "13.5px",
                fontWeight: 700,
                color: mode.textMain,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {name}
            </div>
          )}
          <div
            style={{
              fontSize: "11.5px",
              color: mode.textFaint3,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {email}
          </div>
        </div>
      </div>

      {photoError && (
        <div role="alert" style={{ fontSize: "11px", color: "#ef4444", marginBottom: "10px" }}>
          {photoError}
        </div>
      )}

      <div
        style={{
          fontSize: "11px",
          fontWeight: 600,
          color: atCap ? "#ef4444" : mode.textFaint3,
          marginBottom: "12px",
        }}
      >
        {L.projectsUploadedLabel(projectCount, projectCap)}
      </div>

      <div
        onClick={onLogOut}
        className="amee-menu-item"
        style={{
          padding: "9px 10px",
          borderRadius: "8px",
          cursor: "pointer",
          fontSize: "13px",
          fontWeight: 600,
          color: mode.textMain,
          background: isLight ? "rgba(0,0,0,.04)" : "rgba(255,255,255,.05)",
          textAlign: "center",
        }}
      >
        {L.logOut}
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
