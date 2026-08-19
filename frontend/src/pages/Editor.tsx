import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Link, useParams } from "react-router-dom";

import CaptionOverlay from "../components/CaptionOverlay";
import CaptionsPanel from "../components/CaptionsPanel";
import ExportModal from "../components/ExportModal";
import ExportToast from "../components/ExportToast";
import StylePanel from "../components/StylePanel";
import VolumeIcon from "../components/VolumeIcon";
import { useAmeePrefs } from "../hooks/useAmeePrefs";
import { useCaptionEditing } from "../hooks/useCaptionEditing";
import { useEditorDocument } from "../hooks/useEditorDocument";
import { useEditorHotkeys } from "../hooks/useEditorHotkeys";
import { useProjectExport } from "../hooks/useProjectExport";
import { useProjectSave } from "../hooks/useProjectSave";
import { useStyleEditing } from "../hooks/useStyleEditing";
import { useVideoPlayer } from "../hooks/useVideoPlayer";
import {
  ApiError,
  getProject,
  isTerminalJobStatus,
  openProject,
  resolveMediaUrl,
  resolveStyleLayers,
  type PresetBase,
  type Project,
} from "../api/client";
import { resolveTheme, UI_MODES } from "../theme";
import { STR } from "../i18n";
import { findActiveSegmentIndex } from "../lib/activeSegment";
import { triggerDownload } from "../lib/download";

// Export button's percent ring (r=15.5, matching the design's e_exportRingProgressStyle exactly).
const EXPORT_RING_CIRCUMFERENCE = 2 * Math.PI * 15.5;

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function smallIconBtnStyle(mode: { textFaint2: string }): CSSProperties {
  return {
    width: "30px",
    height: "30px",
    borderRadius: "8px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    color: mode.textFaint2,
  };
}

// Top-bar icon button (undo / redo / ⋯), ported from the design's e_iconBtnStyle: a filled
// rounded square with the glyph centered, 34×34.
function headerIconBtnStyle(mode: { iconBg: string; iconText: string }): CSSProperties {
  return {
    width: "34px",
    height: "34px",
    borderRadius: "9px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: mode.iconBg,
    color: mode.iconText,
    fontSize: "15px",
    cursor: "pointer",
  };
}

// Thin by design: this page owns which project is open, the left panel's tab, the "⋯" menu, and
// the layout -- every other concern (player transport, the edited document + undo/redo, caption
// edits, style edits, saving, exporting) lives in its own hook next to this file.
export default function Editor(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const { prefs } = useAmeePrefs();
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Step 6a: left-panel tab. "style" is the default to match the design's own default view.
  const [activeTab, setActiveTab] = useState<"style" | "captions">("style");

  // The "⋯" export options menu in the top bar (design's `menuOpen`). Anchored to the dots
  // button, closed on outside-click / Escape.
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  const mode = UI_MODES[prefs.mode];
  const theme = resolveTheme(prefs.theme, prefs.mode);
  const L = STR[prefs.lang];

  const player = useVideoPlayer(project?.id);
  const doc = useEditorDocument(id);
  const styleEditing = useStyleEditing({
    ecs: doc.ecs,
    styleSpec: doc.styleSpec,
    applyEdit: doc.applyEdit,
    commitSnapshot: doc.commitSnapshot,
    seekTo: player.seekTo,
    onRequestStyleTab: () => setActiveTab("style"),
  });
  const captions = useCaptionEditing({
    ecs: doc.ecs,
    strings: L,
    applyEcsSegments: doc.applyEcsSegments,
    onSegmentDeleted: styleEditing.clearEditingSegmentIfMatches,
  });
  const save = useProjectSave({ projectId: id, doc, strings: L });
  const exp = useProjectExport({ projectId: id, project, setProject, doc, strings: L });

  useEditorHotkeys({ togglePlay: player.togglePlay, undo: doc.undo, redo: doc.redo });

  useEffect(() => {
    if (!id) {
      return;
    }
    let cancelled = false;
    getProject(id)
      .then((result) => {
        if (!cancelled) {
          setProject(result);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            err instanceof ApiError ? `${err.status}: ${err.message}` : "Failed to load project."
          );
        }
      });
    // "Recently opened" is written only by this explicit call, never as a side effect of the
    // GET above (D13) -- that's what keeps GET /projects/{id} safe to cache later. Without it
    // last_opened_at stays null forever and the `opened` sort degrades to its id tie-break,
    // which reads as random order. Fire-and-forget: a failure here must not surface as a load
    // error, since the editor works fine either way.
    void openProject(id).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Close the "⋯" export menu on an outside click or Escape (same dismissal pattern as the
  // TopBar/color-picker popovers). Only attached while the menu is open.
  useEffect(() => {
    if (!exportMenuOpen) {
      return;
    }
    function onDown(e: MouseEvent) {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setExportMenuOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setExportMenuOpen(false);
      }
    }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [exportMenuOpen]);

  const backLink = (
    <Link
      to="/"
      className="amee-back-link"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        fontSize: "13px",
        fontWeight: 600,
        color: mode.textFaint2,
        textDecoration: "none",
        marginBottom: "20px",
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
    </Link>
  );

  if (error) {
    return (
      <div style={{ minHeight: "100vh", background: mode.pageBg }}>
        <div style={{ padding: "32px" }}>
          {backLink}
          <div role="alert" style={{ color: "#ef4444" }}>
            {error}
          </div>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div style={{ minHeight: "100vh", background: mode.pageBg }}>
        <div style={{ padding: "32px", color: mode.textFaint3 }}>Loading…</div>
      </div>
    );
  }

  const { ecs, styleSpec, presets } = doc;

  // No aspect-ratio picker (catalogue item #8) — always the real video's own dimensions,
  // falling back to 9/16 while they're still null (pre-transcription).
  const aspect =
    project.video_width && project.video_height
      ? project.video_width / project.video_height
      : 9 / 16;
  const videoSrc = resolveMediaUrl(project.preview_video_url ?? project.video_url);

  // Fixed-size preview box, not a stretch-to-fill one — matches the design's own
  // previewFrameStyle: the box's own pixel size is derived from the aspect ratio against
  // a fixed base, then centered in the available space, instead of growing to fill it.
  const isSquareAspect = Math.abs(aspect - 1) < 0.01;
  const previewBase = isSquareAspect ? 420 : 500;
  const previewW = aspect <= 1 ? Math.round(previewBase * aspect) : previewBase;
  const previewH = aspect <= 1 ? previewBase : Math.round(previewBase / aspect);

  const activePreset =
    styleSpec && presets ? presets.find((p) => p.id === styleSpec.presetId) : undefined;

  const perPhrase = styleSpec?.perPhraseStyle ?? false;

  const menuItemStyle: CSSProperties = {
    padding: "9px 10px",
    borderRadius: "6px",
    fontSize: "12.5px",
    fontWeight: 500,
    color: mode.textMain,
    cursor: "pointer",
  };

  // RENDERING resolution (arch §4.2): the segment active at the current time gets its own
  // effective style. CaptionOverlay independently re-derives the active segment from the same
  // currentTime/segments, so the two always agree on which segment this style belongs to. When
  // per-phrase is off, segment overrides lie dormant (null passed) and every segment renders the
  // document style.
  const renderSegment =
    ecs && findActiveSegmentIndex(ecs.segments, player.currentTime) >= 0
      ? ecs.segments[findActiveSegmentIndex(ecs.segments, player.currentTime)]
      : undefined;
  const resolvedStyle: PresetBase | null =
    activePreset && styleSpec
      ? resolveStyleLayers(activePreset, styleSpec.overrides, perPhrase ? renderSegment?.overrides : null)
      : null;

  // EDITING resolution (arch §4.2): the style shown in / written by the panel is for the segment
  // selected for editing (editingSegmentId), which is frequently NOT the one on screen. When
  // per-phrase is off, or no segment is selected, the panel edits the document-level style.
  const editingSegment =
    perPhrase && styleEditing.editingSegmentId
      ? ecs?.segments.find((s) => s.id === styleEditing.editingSegmentId)
      : undefined;
  const panelStyle: PresetBase | null =
    activePreset && styleSpec
      ? resolveStyleLayers(activePreset, styleSpec.overrides, editingSegment?.overrides)
      : null;

  const otherTab = activeTab === "style" ? "captions" : "style";
  const tabLabel = activeTab === "style" ? L.captionsStyleLabel : L.captionsLabel;
  const otherTabLabel = activeTab === "style" ? L.editCaptionsLabel : L.captionsStyleLabel;

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: mode.pageBg }}>
      {/* Step 11b/11c: only the "video" kind gets the full modal, matching the design -- the ⋯
          menu's SRT export was never wired into the design's export-modal system either. */}
      {exp.record && exp.kind === "video" && exp.job && !exp.record.minimized && (
        <ExportModal
          prefs={prefs}
          strings={L}
          projectName={project.name}
          status={exp.job.status}
          progressPercent={exp.job.progress_percent}
          errorMessage={exp.job.error ?? exp.pollError ?? null}
          onCancel={exp.cancel}
          onReturnToMenu={exp.returnToMenu}
          onContinueEditing={exp.dismiss}
          onReturnToEditor={exp.dismiss}
          onMinimize={exp.minimize}
        />
      )}
      {/* Minimized AND actually finished -- a still-running minimized export has no persistent
          indicator of its own (design's own choice), only the button's spinner above/below. */}
      {exp.record &&
        exp.kind === "video" &&
        exp.job &&
        exp.record.minimized &&
        isTerminalJobStatus(exp.job.status) && (
          <ExportToast
            prefs={prefs}
            strings={L}
            status={exp.job.status}
            onOpen={exp.reopen}
            onDownload={
              project.latest_export_url
                ? // Narrowed by the condition above, but that narrowing doesn't survive into a
                  // closure called later (project is regular state, could in principle change) --
                  // the cast is safe here since latest_export_url only ever gets set, never
                  // cleared, once a video export exists.
                  () => {
                    void triggerDownload(resolveMediaUrl(project.latest_export_url as string), "video.mp4");
                  }
                : undefined
            }
            onDismiss={exp.dismiss}
          />
        )}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 24px",
          borderBottom: "1px solid " + mode.panelBorder,
          flex: "none",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0, flex: "1 1 auto", overflow: "hidden" }}>
          <div
            onClick={() => void save.handleGoHome()}
            role="button"
            aria-label={L.backToProjects}
            title={L.backToProjects}
            className="amee-icon-btn"
            style={{
              flex: "none",
              width: "30px",
              height: "30px",
              borderRadius: "8px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: mode.iconBg,
              color: mode.iconText,
              cursor: "pointer",
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 11l9-8 9 8" />
              <path d="M5 10v10h14V10" />
            </svg>
          </div>
          <div
            style={{
              fontSize: "13.5px",
              fontWeight: 600,
              color: mode.textMain,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              minWidth: 0,
            }}
          >
            {project.name}
          </div>
        </div>

        {ecs && (
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <div
              onClick={doc.undo}
              aria-label={L.undo}
              title={L.undo}
              className="amee-icon-btn"
              style={{
                ...headerIconBtnStyle(mode),
                cursor: doc.undoAvailable ? "pointer" : "default",
                opacity: doc.undoAvailable ? 1 : 0.35,
              }}
            >
              ↺
            </div>
            <div
              onClick={doc.redo}
              aria-label={L.redo}
              title={L.redo}
              className="amee-icon-btn"
              style={{
                ...headerIconBtnStyle(mode),
                cursor: doc.redoAvailable ? "pointer" : "default",
                opacity: doc.redoAvailable ? 1 : 0.35,
              }}
            >
              ↻
            </div>
            {/* "⋯" export options menu (design: menuOpen). Anchored to the dots button so the
                dropdown drops directly under it regardless of Save/Export widths. */}
            <div ref={exportMenuRef} style={{ position: "relative", display: "flex" }}>
              <div
                onClick={() => setExportMenuOpen((v) => !v)}
                aria-label={L.export}
                title={L.export}
                className="amee-icon-btn"
                style={headerIconBtnStyle(mode)}
              >
                ⋯
              </div>
              {exportMenuOpen && (
                <div
                  style={{
                    position: "absolute",
                    top: "calc(100% + 8px)",
                    right: 0,
                    width: "240px",
                    background: mode.frameBg,
                    border: "1px solid " + mode.cardBorder,
                    borderRadius: "10px",
                    boxShadow: "0 20px 50px rgba(0,0,0,.5)",
                    padding: "6px",
                    zIndex: 20,
                    transformOrigin: "top right",
                    animation: "menuPanelIn .22s cubic-bezier(.2,.8,.2,1) both",
                  }}
                >
                  <div
                    className="amee-menu-item"
                    onClick={() => {
                      setExportMenuOpen(false);
                      void exp.start("srt");
                    }}
                    style={{
                      ...menuItemStyle,
                      cursor: exp.busy ? "default" : "pointer",
                      opacity: exp.busy ? 0.5 : 1,
                    }}
                  >
                    {exp.busy && exp.kind === "srt" ? L.exporting : L.downloadSrt}
                  </div>
                  {/* Subtitles-on-a-green-background has no backend support: the contract has
                      only video (§12 /export) and SRT (/export-srt), and ffmpeg's burn-in always
                      renders onto the source video. Shown disabled rather than wired to
                      something that would quietly produce an ordinary export instead. */}
                  <div
                    title={L.notAvailableYet}
                    aria-disabled
                    style={{ ...menuItemStyle, cursor: "not-allowed", opacity: 0.4 }}
                  >
                    {L.exportSubsOnly}
                  </div>
                </div>
              )}
            </div>
            {(save.saveError || exp.error || exp.pollError) && (
              <span role="alert" style={{ fontSize: "12px", color: "#ef4444" }}>
                {save.saveError ?? exp.error ?? exp.pollError}
              </span>
            )}
            {save.justSaved && !doc.dirty && !doc.styleDirty && (
              <span style={{ fontSize: "12px", color: mode.textFaint3 }}>{L.saved}</span>
            )}
            <div
              onClick={save.handleSave}
              className="amee-cta-btn"
              style={{
                fontSize: "13px",
                fontWeight: 700,
                color: theme.text,
                background: theme.accent,
                padding: "8px 18px",
                borderRadius: "8px",
                cursor: (doc.dirty || doc.styleDirty) && !save.saving ? "pointer" : "default",
                opacity: (doc.dirty || doc.styleDirty) && !save.saving ? 1 : 0.5,
              }}
            >
              {save.saving ? L.saving : L.save}
            </div>
            {/* Step 11g: Project.latest_export_url (contract §4) -- lets the user re-download the
                last export without re-running one, even after a reload, even if it finished in a
                previous visit. Video only (never export_srt, per the contract's own field docs). */}
            {project.latest_export_url && (
              <div
                onClick={() => {
                  void triggerDownload(resolveMediaUrl(project.latest_export_url as string), "video.mp4");
                }}
                className="amee-icon-btn"
                title={L.downloadLastExport}
                style={{
                  width: "34px",
                  height: "34px",
                  borderRadius: "8px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  cursor: "pointer",
                  color: mode.textFaint2,
                  background: mode.iconBg,
                  flex: "none",
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
              </div>
            )}
            {/* POST /export renders the burned-in video and persists ecs+style as a side
                effect (X5), so it works with or without a preceding Save. Step 11c: while a
                video export is tracked (running, minimized or not), the button shows a spinner
                instead of the label and reopens the modal on click rather than starting a
                second export (design: e_onOpenExport). */}
            <div
              onClick={() => {
                if (exp.record?.kind === "video") {
                  exp.reopen();
                } else {
                  void exp.start("video");
                }
              }}
              className="amee-cta-btn"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "7px",
                fontSize: "13px",
                fontWeight: 700,
                color: mode.textMain,
                background: mode.cardBg,
                padding: "8px 18px",
                borderRadius: "8px",
                cursor: exp.starting ? "default" : "pointer",
                opacity: exp.starting ? 0.6 : 1,
              }}
            >
              {exp.videoRunning &&
                (exp.job?.progress_percent != null ? (
                  <svg width="13" height="13" viewBox="0 0 36 36" style={{ flex: "none" }}>
                    <circle cx="18" cy="18" r="15.5" fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="4" />
                    <circle
                      cx="18"
                      cy="18"
                      r="15.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="4"
                      strokeLinecap="round"
                      style={{
                        strokeDasharray: EXPORT_RING_CIRCUMFERENCE,
                        strokeDashoffset: EXPORT_RING_CIRCUMFERENCE * (1 - exp.job.progress_percent / 100),
                        transform: "rotate(-90deg)",
                        transformOrigin: "18px 18px",
                        transition: "stroke-dashoffset .6s cubic-bezier(.34,1.56,.64,1)",
                      }}
                    />
                  </svg>
                ) : (
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                    style={{ animation: "exportRingSpin .9s linear infinite", flex: "none" }}
                  >
                    <path d="M21 12a9 9 0 1 1-3.5-7.13" />
                  </svg>
                ))}
              {exp.videoRunning ? L.exporting : L.export}
            </div>
          </div>
        )}
      </div>

      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <div
          style={{
            width: "58%",
            flex: "none",
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            borderRight: "1px solid " + mode.panelBorder,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "16px 22px",
              flex: "none",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <div style={{ fontSize: "15px", fontWeight: 700, color: mode.textMain }}>{tabLabel}</div>
              {styleSpec && (
                <div
                  onClick={styleEditing.togglePerPhraseStyle}
                  className="amee-cta-btn"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "6px 10px",
                    borderRadius: "100px",
                    cursor: "pointer",
                    fontSize: "11.5px",
                    fontWeight: 600,
                    background: styleSpec.perPhraseStyle ? theme.accent : mode.iconBg,
                    color: styleSpec.perPhraseStyle ? theme.text : mode.iconText,
                  }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9.06 11.9l8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08" />
                    <path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z" />
                  </svg>
                  <span>{styleSpec.perPhraseStyle ? L.styleEachPhrase : L.styleSameForAll}</span>
                </div>
              )}
            </div>
            <div
              onClick={() => setActiveTab(otherTab)}
              className="amee-cta-btn"
              style={{
                fontSize: "12.5px",
                fontWeight: 700,
                color: theme.text,
                background: theme.accent,
                padding: "7px 14px",
                borderRadius: "8px",
                cursor: "pointer",
              }}
            >
              {otherTabLabel}
            </div>
          </div>

          {captions.notice && (
            <div
              role="alert"
              style={{
                margin: "0 22px 12px",
                padding: "10px 14px",
                borderRadius: "8px",
                background: "rgba(239,68,68,.12)",
                color: "#ef4444",
                fontSize: "13px",
                fontWeight: 600,
                textAlign: "center",
                flex: "none",
              }}
            >
              {captions.notice}
            </div>
          )}

          {activeTab === "captions" ? (
            <div style={{ flex: 1, overflow: "auto", minHeight: 0, padding: "0 22px 22px" }}>
              {ecs && (
                <CaptionsPanel
                  prefs={prefs}
                  strings={L}
                  segments={ecs.segments}
                  currentTime={player.currentTime}
                  resolvedStyle={resolvedStyle}
                  perPhraseStyle={perPhrase}
                  editingSegmentId={styleEditing.editingSegmentId}
                  popup={captions.wordPopup}
                  confirmDeleteSegmentId={captions.confirmDeleteSegmentId}
                  pendingWordId={captions.pendingWordId}
                  onSeek={player.seekTo}
                  onEditSegmentStyle={styleEditing.handleEditSegmentStyle}
                  onWordClick={captions.handleWordClick}
                  onRangeClick={captions.handleRangeClick}
                  onClosePopup={captions.closeWordPopup}
                  onAddWord={captions.handleAddWord}
                  onSplitSegment={captions.handleSplitSegment}
                  onRemoveWord={captions.handleRemoveWord}
                  onDeleteClick={captions.handleDeleteSegmentClick}
                  onConfirmDelete={captions.handleConfirmDeleteSegment}
                  onCancelDelete={captions.handleCancelDeleteSegment}
                  onCommitWordText={captions.handleCommitWordText}
                  onCommitWordStart={captions.handleCommitWordStart}
                  onCommitWordEnd={captions.handleCommitWordEnd}
                  onCommitSceneStart={captions.handleCommitSceneStart}
                  onCommitSceneEnd={captions.handleCommitSceneEnd}
                />
              )}
            </div>
          ) : presets && activePreset && panelStyle && styleSpec ? (
            <StylePanel
              prefs={prefs}
              strings={L}
              presets={presets}
              activePresetId={styleSpec.presetId}
              resolvedStyle={panelStyle}
              bounds={activePreset.bounds}
              // Highlight colors collapse to a single "Main" swatch in two cases, both because
              // the 3-colour cycle has nothing to cycle over:
              //  - editing one segment's style (arch §4.2 — a per-phrase override is authored as
              //    a length-1 highlightColors array; per-word karaoke across 3 colours is
              //    meaningless for one phrase);
              //  - `revealMode: "single-word"`, where exactly one word is on screen at a time and
              //    it is always the highlighted one, so cycling by segment index just makes the
              //    caption change colour between phrases for no reason the user asked for.
              // Off → the normal 3-swatch document editor.
              singleColor={Boolean(editingSegment) || panelStyle.revealMode === "single-word"}
              onSelectPreset={styleEditing.selectPreset}
              onChangeOverrides={styleEditing.handleChangeStyleOverrides}
              onLiveChangeOverrides={styleEditing.handleChangeStyleOverridesLive}
              onCommitOverrides={doc.commitPendingEdit}
            />
          ) : (
            <div style={{ flex: 1, fontSize: "13px", color: mode.textFaint3, padding: "40px 22px", textAlign: "center" }}>
              {L.stylePanelPlaceholder}
            </div>
          )}
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", minHeight: 0 }}>
            <div
              ref={player.videoBoxRef}
              style={{
                position: "relative",
                width: previewW + "px",
                height: previewH + "px",
                borderRadius: "16px",
                overflow: "hidden",
                background: "#000",
                boxShadow: "0 20px 60px rgba(0,0,0,.4)",
              }}
            >
              <video
                ref={player.videoRef}
                src={videoSrc}
                style={{ width: "100%", height: "100%", objectFit: "contain" }}
              />
              {ecs && resolvedStyle && player.videoBoxSize.width > 0 && (
                <CaptionOverlay
                  segments={ecs.segments}
                  currentTime={player.currentTime}
                  style={resolvedStyle}
                  containerWidth={player.videoBoxSize.width}
                  containerHeight={player.videoBoxSize.height}
                />
              )}
            </div>
          </div>

          <div style={{ flex: "none", padding: "18px 24px 26px", display: "flex", flexDirection: "column", gap: "10px" }}>
            <input
              type="range"
              min={0}
              max={1000}
              step={1}
              value={player.duration ? Math.round((player.currentTime / player.duration) * 1000) : 0}
              onChange={(e) => player.seekTo((Number(e.target.value) / 1000) * player.duration)}
              style={{ width: "100%", accentColor: theme.accent }}
            />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                <div
                  onClick={player.togglePlay}
                  className="amee-icon-btn"
                  style={{
                    width: "36px",
                    height: "36px",
                    borderRadius: "50%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    background: theme.accent,
                    color: theme.text,
                    fontSize: "13px",
                  }}
                >
                  {player.isPlaying ? "❚❚" : "▶"}
                </div>
                <div
                  style={{
                    fontSize: "12.5px",
                    color: mode.textFaint3,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {formatTime(player.currentTime)} / {formatTime(player.duration)}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <div
                  onClick={() => player.seekTo(player.currentTime - 1)}
                  className="amee-icon-btn"
                  style={smallIconBtnStyle(mode)}
                >
                  «
                </div>
                <div
                  onClick={() => player.seekTo(player.currentTime + 1)}
                  className="amee-icon-btn"
                  style={smallIconBtnStyle(mode)}
                >
                  »
                </div>
                <div onClick={player.toggleMute} className="amee-icon-btn" style={smallIconBtnStyle(mode)}>
                  <VolumeIcon muted={player.muted || player.volume === 0} />
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={player.muted ? 0 : player.volume}
                  onChange={(e) => player.handleVolumeChange(Number(e.target.value))}
                  style={{ width: "80px", accentColor: theme.accent }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
