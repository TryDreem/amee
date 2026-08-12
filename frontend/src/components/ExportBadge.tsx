import { resolveTheme, UI_MODES, type Prefs } from "../theme";

interface ExportBadgeProps {
  prefs: Prefs;
  count: number;
  title: string;
  onClick: () => void;
}

// Ported from the design's h_exportBadge*: a small ring + count in the top bar, shown only while
// at least one export is genuinely in progress (design: `active.length > 0`, filtered to
// phase === 'progress' -- a done/failed export doesn't keep the badge alive, matching
// h_exportBadgeShow exactly). The design's ring arc is filled by a fake local percentage;
// Job.progress_percent doesn't exist on the wire yet (Step 11 Track 2, not landed), so this
// spins a fixed arc instead of filling one -- same honesty rule, and the same visual language
// (exportRingSpin, index.css), as the Export button's own spinner in the Editor.
export default function ExportBadge({ prefs, count, title, onClick }: ExportBadgeProps): JSX.Element {
  const mode = UI_MODES[prefs.mode];
  const isLight = prefs.mode === "light";
  const theme = resolveTheme(prefs.theme, prefs.mode);
  const ringC = 2 * Math.PI * 15.5;

  return (
    <div
      onClick={onClick}
      className="amee-icon-btn"
      title={title}
      style={{
        position: "relative",
        width: "34px",
        height: "34px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
      }}
    >
      <svg width="34" height="34" viewBox="0 0 36 36" style={{ animation: "exportRingSpin 1.1s linear infinite" }}>
        <circle
          cx="18"
          cy="18"
          r="15.5"
          fill="none"
          strokeWidth="3"
          stroke={isLight ? "rgba(0,0,0,.12)" : "rgba(255,255,255,.18)"}
        />
        <circle
          cx="18"
          cy="18"
          r="15.5"
          fill="none"
          strokeWidth="3"
          strokeLinecap="round"
          stroke={theme.accent}
          strokeDasharray={ringC}
          strokeDashoffset={ringC * 0.75}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "12px",
          fontWeight: 800,
          color: mode.textMain,
        }}
      >
        {count}
      </div>
    </div>
  );
}
