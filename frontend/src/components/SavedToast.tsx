import { UI_MODES, type Prefs } from "../theme";

interface SavedToastProps {
  prefs: Prefs;
  text: string;
}

// Ported verbatim from the design's h_showSavedToast block (Home.dc.html): centered overlay card,
// green checkmark that pops in, text, then the whole card fades out via the animation's own
// second (delayed) keyframe. Lifetime (~1.6s) is owned by the caller (mounts this, then unmounts
// after a timeout) — this component only plays the animation while it's mounted.
export default function SavedToast({ prefs, text }: SavedToastProps): JSX.Element {
  const mode = UI_MODES[prefs.mode];
  const isLight = prefs.mode === "light";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "12px",
          padding: "26px 34px",
          borderRadius: "16px",
          background: isLight ? "rgba(255,255,255,.96)" : "rgba(28,29,32,.92)",
          border: "1px solid " + mode.panelBorder2,
          boxShadow: "0 20px 50px rgba(0,0,0,.35)",
          backdropFilter: "blur(10px)",
          WebkitBackdropFilter: "blur(10px)",
          animation: "savedToastIn .35s cubic-bezier(.2,.8,.2,1) both, savedToastOut .3s ease 1.25s both",
        }}
      >
        <div
          style={{
            width: "52px",
            height: "52px",
            borderRadius: "50%",
            background: "#22c55e",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            animation: "savedCheckPop .4s cubic-bezier(.3,1.4,.4,1) .1s both",
          }}
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#fff"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <div style={{ fontSize: "14.5px", fontWeight: 700, color: mode.textMain }}>{text}</div>
      </div>
    </div>
  );
}
