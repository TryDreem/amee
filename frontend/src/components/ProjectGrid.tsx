import { STR } from "../i18n";
import { resolveTheme, UI_MODES, type Prefs } from "../theme";
import type { Project } from "../api/client";

interface ProjectGridProps {
  prefs: Prefs;
  projects: Project[];
  onCreateClick: () => void;
}

function formatDate(iso: string, lang: Prefs["lang"]): string {
  const locale = lang === "ru" ? "ru-RU" : "en-US";
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric" }).format(
    new Date(iso)
  );
}

export default function ProjectGrid({ prefs, projects, onCreateClick }: ProjectGridProps): JSX.Element {
  const mode = UI_MODES[prefs.mode];
  const isLight = prefs.mode === "light";
  const theme = resolveTheme(prefs.theme, prefs.mode);
  const L = STR[prefs.lang];
  const hasProjects = projects.length > 0;

  const createBtnStyle = {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    fontSize: "13.5px",
    fontWeight: 700,
    color: theme.text,
    background: theme.accent,
    padding: "12px 20px",
    borderRadius: "10px",
    cursor: "pointer",
    whiteSpace: "nowrap" as const,
  };

  return (
    <div
      style={{
        maxWidth: "1200px",
        margin: "0 auto",
        padding: "48px 32px 80px",
        animation: "homeFrameIn .5s cubic-bezier(.2,.7,.2,1) both",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "20px",
          marginBottom: "32px",
          flexWrap: "wrap",
        }}
      >
        <div style={{ animation: "homeItemIn .45s ease-out .12s both" }}>
          <div style={{ fontSize: "28px", fontWeight: 800, color: mode.textMain, letterSpacing: "-.01em" }}>
            {L.myProjects}
          </div>
          <div style={{ fontSize: "13.5px", color: mode.textFaint3, marginTop: "6px" }}>
            {hasProjects ? `${projects.length} ${L.projectWord(projects.length)}` : ""}
          </div>
        </div>
        <div style={{ display: "inline-flex", animation: "homeItemIn .45s ease-out .2s both" }}>
          <div onClick={onCreateClick} className="amee-cta-btn" style={createBtnStyle}>
            <span style={{ fontSize: "16px", lineHeight: 1, fontWeight: 700 }}>+</span>
            <span>{L.createProject}</span>
          </div>
        </div>
      </div>

      {hasProjects ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))",
            gap: "22px",
          }}
        >
          {projects.map((p, i) => (
            <div
              key={p.id}
              style={{ animation: `homeItemIn .45s ease-out ${0.26 + Math.min(i, 12) * 0.06}s both` }}
            >
            <a
              href="#"
              onClick={(e) => e.preventDefault()}
              className="amee-project-card"
              style={{
                display: "flex",
                flexDirection: "column",
                borderRadius: "14px",
                overflow: "hidden",
                cursor: "pointer",
                background: mode.cardBg,
                border: "1px solid " + mode.cardBorder,
                textDecoration: "none",
              }}
            >
              <div
                style={{
                  position: "relative",
                  width: "100%",
                  aspectRatio: "16/9",
                  background: p.thumbnail_url
                    ? undefined
                    : `repeating-linear-gradient(135deg,${mode.stripeA},${mode.stripeA} 12px,${mode.stripeB} 12px,${mode.stripeB} 24px)`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {p.thumbnail_url ? (
                  <img
                    src={p.thumbnail_url}
                    alt=""
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                ) : (
                  <div
                    style={{
                      font: "11px ui-monospace,Menlo,monospace",
                      color: isLight ? "rgba(0,0,0,.35)" : "rgba(255,255,255,.4)",
                    }}
                  >
                    {L.thumbLabel}
                  </div>
                )}
              </div>
              <div style={{ padding: "14px 16px 16px", display: "flex", flexDirection: "column", gap: "4px" }}>
                <div
                  style={{
                    fontSize: "14.5px",
                    fontWeight: 600,
                    color: mode.textMain,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {p.name}
                </div>
                <div style={{ fontSize: "12px", color: mode.textFaint3 }}>
                  {formatDate(p.created_at, prefs.lang)}
                </div>
              </div>
            </a>
            </div>
          ))}
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
            gap: "14px",
            padding: "90px 20px 60px",
            maxWidth: "420px",
            margin: "0 auto",
            animation: "homeItemIn .45s ease-out .12s both",
          }}
        >
          <div
            style={{
              width: "56px",
              height: "56px",
              borderRadius: "50%",
              background: mode.iconBg,
              color: mode.iconText,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: "6px",
            }}
          >
            <svg
              width="30"
              height="30"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="2.5" y="5.5" width="14" height="13" rx="2.5" />
              <path d="M16.5 10l5-3v10l-5-3" />
            </svg>
          </div>
          <div style={{ fontSize: "19px", fontWeight: 700, color: mode.textMain }}>{L.emptyTitle}</div>
          <div style={{ fontSize: "13.5px", lineHeight: 1.55, color: mode.textFaint, marginBottom: "6px" }}>
            {L.emptyText}
          </div>
          <div onClick={onCreateClick} className="amee-cta-btn" style={createBtnStyle}>
            <span style={{ fontSize: "16px", lineHeight: 1, fontWeight: 700 }}>+</span>
            <span>{L.createFirst}</span>
          </div>
        </div>
      )}
    </div>
  );
}
