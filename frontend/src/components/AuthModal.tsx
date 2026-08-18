import type { Strings } from "../i18n";
import { UI_MODES, type Prefs } from "../theme";

interface AuthModalProps {
  prefs: Prefs;
  strings: Strings;
  onGoogleClick: () => void;
  onClose: () => void;
}

// Mirrors DeleteProjectModal.tsx/ExportModal.tsx: separate file, backdrop + centered card, no
// context access of its own. Simplified from the Claude Design mockup on purpose (plan §Context,
// locked scope decision) -- Google OAuth only, no email/password, so no mode toggle, no
// switch-mode link, no divider, no inputs. Just a title, one Google button, one close.
export default function AuthModal({ prefs, strings: L, onGoogleClick, onClose }: AuthModalProps): JSX.Element {
  const mode = UI_MODES[prefs.mode];
  const isLight = prefs.mode === "light";

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
          width: "320px",
          padding: "28px 24px",
          borderRadius: "16px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
          gap: "18px",
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

        <div style={{ fontSize: "16.5px", fontWeight: 700, color: mode.textMain }}>{L.signIn}</div>

        <div
          onClick={onGoogleClick}
          className="amee-cta-btn"
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "10px",
            padding: "11px",
            borderRadius: "10px",
            fontSize: "13.5px",
            fontWeight: 700,
            cursor: "pointer",
            background: isLight ? "#ffffff" : "#f5f5f5",
            color: "#1f1f1f",
            border: "1px solid " + (isLight ? "rgba(0,0,0,.12)" : "rgba(0,0,0,.08)"),
          }}
        >
          <svg width="18" height="18" viewBox="0 0 48 48">
            <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.4 29.3 35 24 35c-6.1 0-11-4.9-11-11s4.9-11 11-11c2.8 0 5.3 1 7.3 2.7l5.7-5.7C33.5 6.5 29 4.5 24 4.5 12.9 4.5 4 13.4 4 24.5s8.9 20 20 20 20-8.9 20-20c0-1.4-.1-2.7-.4-4z" />
            <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.6 16 19 13 24 13c2.8 0 5.3 1 7.3 2.7l5.7-5.7C33.5 6.5 29 4.5 24 4.5c-7.4 0-13.7 4.2-16.9 10.4z" />
            <path fill="#4CAF50" d="M24 44.5c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.6 26.7 36.5 24 36.5c-5.3 0-9.7-3.4-11.3-8.1l-6.6 5.1C9.9 40.2 16.4 44.5 24 44.5z" />
            <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.2-4.2 5.6l6.2 5.2c-.4.4 6.7-4.9 6.7-15.3 0-1.4-.1-2.7-.4-4z" />
          </svg>
          {L.continueWithGoogle}
        </div>
      </div>
    </div>
  );
}
