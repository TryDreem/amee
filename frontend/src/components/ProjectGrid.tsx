import { useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";

import { STR } from "../i18n";
import { triggerDownload } from "../lib/download";
import { resolveTheme, UI_MODES, type Prefs } from "../theme";
import { resolveMediaUrl, type Project, type ProjectSort } from "../api/client";

const SORT_ORDER: ProjectSort[] = ["newest", "oldest", "updated", "az", "za", "opened"];

interface ProjectGridProps {
  prefs: Prefs;
  projects: Project[]; // current page only
  total: number; // count across every page matching the current search (contract §4)
  onCreateClick: () => void;
  searchValue: string;
  onSearchChange: (value: string) => void;
  sort: ProjectSort;
  onSortChange: (sort: ProjectSort) => void;
  page: number; // zero-indexed
  pageSize: number;
  onPageChange: (page: number) => void;
  onDeleteClick: (project: Project) => void;
}

function formatDate(iso: string, lang: Prefs["lang"]): string {
  const locale = lang === "ru" ? "ru-RU" : "en-US";
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric" }).format(
    new Date(iso)
  );
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// Ported from the design's winStartFor/buildPageNumbers: a 5-wide sliding window of page
// numbers, clamped so it never runs past either end.
function pageWindow(page: number, totalPages: number): number[] {
  let start = Math.max(0, page - 2);
  const end = Math.min(totalPages - 1, start + 4);
  start = Math.max(0, end - 4);
  const nums: number[] = [];
  for (let i = start; i <= end; i++) {
    nums.push(i);
  }
  return nums;
}

export default function ProjectGrid({
  prefs,
  projects,
  total,
  onCreateClick,
  searchValue,
  onSearchChange,
  sort,
  onSortChange,
  page,
  pageSize,
  onPageChange,
  onDeleteClick,
}: ProjectGridProps): JSX.Element {
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const mode = UI_MODES[prefs.mode];
  const isLight = prefs.mode === "light";
  const theme = resolveTheme(prefs.theme, prefs.mode);
  const L = STR[prefs.lang];
  // Same rule the source design uses (h_hasProjects: totalCount > 0, after search): a search
  // with zero matches shows the same "no projects yet" empty state as a genuinely empty account.
  // A real gap in the source, ported faithfully rather than quietly fixed -- flagged separately.
  const hasProjects = total > 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

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
  const sortBtnStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    fontSize: "13.5px",
    fontWeight: 600,
    color: mode.textMain,
    background: sortMenuOpen
      ? isLight
        ? "rgba(0,0,0,.08)"
        : "rgba(255,255,255,.12)"
      : isLight
        ? "rgba(0,0,0,.05)"
        : "rgba(255,255,255,.06)",
    border: "1px solid " + mode.panelBorder2,
    padding: "10px 14px",
    borderRadius: "10px",
    cursor: "pointer",
    whiteSpace: "nowrap",
  };
  const sortPanelStyle: CSSProperties = {
    position: "absolute",
    top: "46px",
    left: 0,
    zIndex: 40,
    width: "190px",
    padding: "10px",
    borderRadius: "12px",
    background: mode.frameBg,
    border: "1px solid " + mode.panelBorder2,
    boxShadow: "0 12px 32px rgba(0,0,0,.35)",
    transformOrigin: "top left",
    animation: "menuPanelIn .22s cubic-bezier(.2,.8,.2,1) both",
  };
  const sortOptionStyle = (active: boolean): CSSProperties => ({
    padding: "9px 10px",
    borderRadius: "8px",
    cursor: active ? "default" : "pointer",
    marginBottom: "2px",
    fontSize: "13px",
    fontWeight: active ? 700 : 500,
    color: active ? mode.textMain : mode.textFaint2,
    background: active ? (isLight ? "rgba(0,0,0,.06)" : "rgba(255,255,255,.08)") : "transparent",
  });
  const pageBtnStyle = (active: boolean, disabled = false): CSSProperties => ({
    width: "36px",
    height: "36px",
    flex: "none",
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: active ? "13.5px" : "16px",
    fontWeight: active ? 700 : 600,
    cursor: disabled ? "default" : active ? "default" : "pointer",
    color: active ? theme.text : disabled ? mode.textFaint3 : mode.textFaint2,
    background: active ? theme.accent : "transparent",
    opacity: disabled ? 0.35 : 1,
    transition: "background .2s ease, color .2s ease",
  });
  const deleteBtnStyle: CSSProperties = {
    position: "absolute",
    top: "10px",
    right: "10px",
    zIndex: 2,
    width: "30px",
    height: "30px",
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: isLight ? "rgba(255,255,255,.85)" : "rgba(0,0,0,.5)",
    color: mode.textFaint2,
    border: "1px solid " + mode.panelBorder2,
    cursor: "pointer",
    backdropFilter: "blur(4px)",
  };
  const exportedBadgeStyle: CSSProperties = {
    position: "absolute",
    top: "10px",
    left: "10px",
    zIndex: 2,
    display: "flex",
    alignItems: "center",
    gap: "5px",
    padding: "5px 9px 5px 7px",
    borderRadius: "999px",
    color: "#22c55e",
    background: isLight ? "rgba(255,255,255,.9)" : "rgba(0,0,0,.55)",
    border: "1px solid " + mode.panelBorder2,
    backdropFilter: "blur(4px)",
    fontSize: "11px",
    fontWeight: 700,
    cursor: "pointer",
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
          marginBottom: "8px",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "14px", flexWrap: "wrap" }}>
          <div
            style={{
              fontSize: "28px",
              fontWeight: 800,
              color: mode.textMain,
              letterSpacing: "-.01em",
              animation: "homeItemIn .45s ease-out .12s both",
            }}
          >
            {L.myProjects}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "8px 14px",
              borderRadius: "999px",
              minWidth: "200px",
              background: isLight ? "rgba(0,0,0,.04)" : "rgba(255,255,255,.05)",
              border: "1px solid " + mode.panelBorder2,
              animation: "homeItemIn .45s ease-out .16s both",
            }}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ color: mode.textFaint3, flex: "none" }}
            >
              <circle cx="11" cy="11" r="7" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              value={searchValue}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={L.searchPlaceholder}
              style={{
                border: "none",
                outline: "none",
                background: "transparent",
                font: "400 13.5px Inter,system-ui,sans-serif",
                color: mode.textMain,
                width: "100%",
              }}
            />
          </div>
        </div>
        <div
          style={{
            position: "relative",
            // `homeItemIn`'s keyframes animate opacity+transform, so this div is already its own
            // stacking context (CSS spec: animation-name referencing opacity/transform keyframes
            // forces one, regardless of position). Its parent (the header row) isn't a stacking
            // context itself, so without an explicit z-index here this group -- sort button,
            // panel, create button -- gets compared directly against the project grid below at
            // z-index:auto, and loses on DOM order (header comes first) even though the panel's
            // own z-index:40 says otherwise; that z-index only wins fights inside this box, not
            // against a sibling subtree. An explicit z-index here is what actually lets it escape.
            zIndex: 30,
            display: "flex",
            alignItems: "center",
            gap: "12px",
            animation: "homeItemIn .45s ease-out .2s both",
          }}
        >
          <div style={{ position: "relative" }}>
            <div onClick={() => setSortMenuOpen((v) => !v)} className="amee-icon-btn" style={sortBtnStyle}>
              <span>{L.sortLabels[sort]}</span>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.7 }}>
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </div>
            {sortMenuOpen && (
              <>
                <div onClick={() => setSortMenuOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 20 }} />
                <div onClick={(e) => e.stopPropagation()} style={sortPanelStyle}>
                  <div style={{ font: "600 10.5px system-ui,sans-serif", letterSpacing: ".04em", textTransform: "uppercase", color: mode.textFaint3, padding: "2px 10px 8px" }}>
                    {L.sortByLabel}
                  </div>
                  {SORT_ORDER.map((id) => (
                    <div
                      key={id}
                      onClick={() => {
                        onSortChange(id);
                        setSortMenuOpen(false);
                      }}
                      className="amee-menu-item"
                      style={sortOptionStyle(id === sort)}
                    >
                      {L.sortLabels[id]}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
          <div onClick={onCreateClick} className="amee-cta-btn" style={createBtnStyle}>
            <span style={{ fontSize: "16px", lineHeight: 1, fontWeight: 700 }}>+</span>
            <span>{L.createProject}</span>
          </div>
        </div>
      </div>
      <div style={{ fontSize: "13.5px", color: mode.textFaint3, marginBottom: "32px" }}>
        {hasProjects ? `${total} ${L.projectWord(total)}` : ""}
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
              style={{
                position: "relative",
                animation: `homeItemIn .45s ease-out ${0.26 + Math.min(i, 12) * 0.06}s both`,
              }}
            >
            <Link
              to={`/projects/${p.id}`}
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
                  <>
                    {/* Blurred backdrop fills the 16:9 card regardless of the source video's
                        own aspect ratio; the real frame sits on top via object-fit: contain
                        instead of being cropped by a fixed-ratio "cover" box. */}
                    <img
                      src={resolveMediaUrl(p.thumbnail_url)}
                      alt=""
                      aria-hidden="true"
                      style={{
                        position: "absolute",
                        inset: 0,
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        filter: "blur(18px) brightness(0.55)",
                        transform: "scale(1.15)",
                      }}
                    />
                    <img
                      src={resolveMediaUrl(p.thumbnail_url)}
                      alt=""
                      style={{
                        position: "absolute",
                        inset: 0,
                        width: "100%",
                        height: "100%",
                        objectFit: "contain",
                      }}
                    />
                  </>
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
                {p.video_duration_seconds != null && (
                  <div
                    style={{
                      position: "absolute",
                      right: "8px",
                      bottom: "8px",
                      padding: "2px 7px",
                      borderRadius: "5px",
                      background: "rgba(0,0,0,.7)",
                      color: "#fff",
                      fontSize: "11px",
                      fontWeight: 600,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {formatDuration(p.video_duration_seconds)}
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
            </Link>
            {p.latest_export_url && (
              <div
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  void triggerDownload(resolveMediaUrl(p.latest_export_url as string), "video.mp4").catch(() => {
                    /* nothing else to do here -- no persistent header/toast on this page to fall back on */
                  });
                }}
                className="amee-icon-btn"
                title={L.exportedBadgeLabel}
                style={exportedBadgeStyle}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span>{L.exportedBadgeLabel}</span>
              </div>
            )}
            <div
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDeleteClick(p);
              }}
              className="amee-delete-btn"
              title={L.deleteTitle}
              style={deleteBtnStyle}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6" />
                <path d="M14 11v6" />
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
              </svg>
            </div>
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

      {hasProjects && totalPages > 1 && (
        <div style={{ marginTop: "32px", marginBottom: "40px", display: "flex", flexDirection: "column", alignItems: "center", gap: "12px" }}>
          <div style={{ fontSize: "12.5px", color: mode.textFaint3 }}>
            {L.shownOf(projects.length, total)} · {L.pageOf(page + 1, totalPages)}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "2px",
              padding: "6px",
              borderRadius: "100px",
              background: mode.frameBg,
              border: "1px solid " + mode.panelBorder2,
              boxShadow: "0 12px 32px rgba(0,0,0,.35)",
            }}
          >
            <div
              onClick={() => page > 0 && onPageChange(page - 1)}
              style={pageBtnStyle(false, page === 0)}
            >
              ‹
            </div>
            {pageWindow(page, totalPages).map((i) => (
              <div key={i} onClick={() => i !== page && onPageChange(i)} style={pageBtnStyle(i === page)}>
                {i + 1}
              </div>
            ))}
            <div
              onClick={() => page < totalPages - 1 && onPageChange(page + 1)}
              style={pageBtnStyle(false, page === totalPages - 1)}
            >
              ›
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
