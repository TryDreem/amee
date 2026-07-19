import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Link, useParams } from "react-router-dom";

import CaptionOverlay from "../components/CaptionOverlay";
import CaptionsPanel, { type WordPopup } from "../components/CaptionsPanel";
import { useAmeePrefs } from "../hooks/useAmeePrefs";
import {
  ApiError,
  getEcs,
  getProject,
  getStyle,
  listPresets,
  putEcs,
  resolveMediaUrl,
  resolveStyle,
  type ECS,
  type CaptionStyleSpec,
  type PresetBase,
  type Preset,
  type Project,
} from "../api/client";
import { resolveTheme, UI_MODES } from "../theme";
import { STR } from "../i18n";
import { addWordAt, commitWordText, deleteSegment, splitSegmentAt } from "../lib/ecsEdit";

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

export default function Editor(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const { prefs } = useAmeePrefs();
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [ecs, setEcs] = useState<ECS | null>(null);
  const [styleSpec, setStyleSpec] = useState<CaptionStyleSpec | null>(null);
  const [presets, setPresets] = useState<Preset[] | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const videoBoxRef = useRef<HTMLDivElement>(null);
  const [videoBoxSize, setVideoBoxSize] = useState({ width: 0, height: 0 });
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);

  // Step 6a: left-panel tab. "style" is the default to match the design's own default view.
  const [activeTab, setActiveTab] = useState<"style" | "captions">("style");

  // Editing UI state. Split segment / delete segment mutation logic lands in Steps 5c/5d;
  // Add word (Step 5b) is real below.
  const [wordPopup, setWordPopup] = useState<WordPopup>(null);
  const [confirmDeleteSegmentId, setConfirmDeleteSegmentId] = useState<string | null>(null);
  const [pendingWordId, setPendingWordId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  function showNotice(text: string) {
    clearTimeout(noticeTimerRef.current);
    setNotice(text);
    noticeTimerRef.current = setTimeout(() => setNotice(null), 10000);
  }

  // Save: explicit action only (CLAUDE.md "Settled": whole-document PUT, no autosave on
  // every edit). `dirty` tracks whether anything has changed since the last successful save
  // or load — Add word/Split/Delete (5b-5d) all flow through setEcs, so marking dirty there
  // covers all three without each handler needing to know about saving.
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [justSaved, setJustSaved] = useState(false);

  function updateEcs(next: ECS) {
    setEcs(next);
    setDirty(true);
  }

  async function handleSave() {
    if (!id || !ecs || saving || !dirty) {
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await putEcs(id, ecs.segments);
      setEcs(saved);
      setDirty(false);
      setJustSaved(true);
      clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setJustSaved(false), 2000);
    } catch (err) {
      setSaveError(err instanceof ApiError ? `${err.status}: ${err.message}` : L.saveFailed);
    } finally {
      setSaving(false);
    }
  }

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
    return () => {
      cancelled = true;
    };
  }, [id]);

  // ECS/style/presets are independent of the video player; a failure here shouldn't block
  // playback — captions just won't render (the video still loads and plays fine on its own).
  useEffect(() => {
    if (!id) {
      return;
    }
    let cancelled = false;
    Promise.all([getEcs(id), getStyle(id), listPresets()])
      .then(([ecsResult, styleResult, presetsResult]) => {
        if (!cancelled) {
          setEcs(ecsResult);
          setStyleSpec(styleResult);
          setPresets(presetsResult);
        }
      })
      .catch(() => {
        // Captions are supplementary here; swallow — no error UI blocks the video for this.
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    const box = videoBoxRef.current;
    if (!box) {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        const { width, height } = entry.contentRect;
        setVideoBoxSize({ width, height });
      }
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, [project?.id]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    const onTimeUpdate = () => setCurrentTime(video.currentTime);
    const onLoadedMetadata = () => setDuration(video.duration);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);

    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("loadedmetadata", onLoadedMetadata);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    return () => {
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
    };
  }, [project?.id]);

  const mode = UI_MODES[prefs.mode];
  const theme = resolveTheme(prefs.theme, prefs.mode);
  const L = STR[prefs.lang];

  function togglePlay() {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    if (video.paused) {
      void video.play();
    } else {
      video.pause();
    }
  }

  function seekTo(t: number) {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    video.currentTime = Math.max(0, Math.min(duration || 0, t));
  }

  function handleVolumeChange(v: number) {
    const video = videoRef.current;
    setVolume(v);
    setMuted(v === 0);
    if (video) {
      video.volume = v;
      video.muted = v === 0;
    }
  }

  function toggleMute() {
    const video = videoRef.current;
    const next = !muted;
    setMuted(next);
    if (video) {
      video.muted = next;
    }
  }

  function handleWordClick(segmentId: string, wordId: string) {
    setConfirmDeleteSegmentId(null);
    setWordPopup({ segmentId, wordId });
  }

  function closeWordPopup() {
    setWordPopup(null);
  }

  // Add word: real (Step 5b). Purely local edit state until an explicit save (Step 5e) —
  // nothing here calls PUT /ecs yet.
  function handleAddWord(segmentId: string, wordId: string, side: "left" | "right") {
    setWordPopup(null);
    if (!ecs) {
      return;
    }
    const result = addWordAt(ecs.segments, segmentId, wordId, side);
    if ("error" in result) {
      showNotice(L.noticeNoRoom);
      return;
    }
    updateEcs({ ...ecs, segments: result.segments });
    setPendingWordId(result.newWordId);
  }

  // Empty text removes the just-inserted word again; text over the edit-time limits
  // (architecture.md §7.1) also removes it, with a 10s notice explaining which limit.
  function handleCommitPendingWord(text: string) {
    if (!ecs || !pendingWordId) {
      return;
    }
    const segment = ecs.segments.find((s) => s.words.some((w) => w.id === pendingWordId));
    if (!segment) {
      setPendingWordId(null);
      return;
    }
    const result = commitWordText(ecs.segments, segment.id, pendingWordId, text);
    updateEcs({ ...ecs, segments: result.segments });
    setPendingWordId(null);
    if (result.kind === "removed_limit") {
      showNotice(result.limit === "words" ? L.noticeMaxWords : L.noticeMaxChars);
    }
  }

  // Split segment: real (Step 5c). Clicking the segment's last word is a silent no-op
  // (nothing to move into a right-hand part), matching the design's own behavior.
  function handleSplitSegment(segmentId: string, wordId: string) {
    setWordPopup(null);
    if (!ecs) {
      return;
    }
    const result = splitSegmentAt(ecs.segments, segmentId, wordId);
    if ("noop" in result) {
      return;
    }
    updateEcs({ ...ecs, segments: result.segments });
  }

  function handleDeleteSegmentClick(segmentId: string) {
    setWordPopup(null);
    setConfirmDeleteSegmentId(segmentId);
  }

  // Delete segment: real (Step 5d). Also drops a pending "Add word" input if it belonged
  // to the segment being deleted, so state doesn't point at a word that's about to vanish.
  function handleConfirmDeleteSegment(segmentId: string) {
    setConfirmDeleteSegmentId(null);
    if (!ecs) {
      return;
    }
    if (pendingWordId) {
      const segment = ecs.segments.find((s) => s.id === segmentId);
      if (segment?.words.some((w) => w.id === pendingWordId)) {
        setPendingWordId(null);
      }
    }
    updateEcs({ ...ecs, segments: deleteSegment(ecs.segments, segmentId) });
  }

  function handleCancelDeleteSegment() {
    setConfirmDeleteSegmentId(null);
  }

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
  const resolvedStyle: PresetBase | null =
    activePreset && styleSpec ? resolveStyle(activePreset, styleSpec.overrides) : null;

  const otherTab = activeTab === "style" ? "captions" : "style";
  const otherTabLabel = activeTab === "style" ? L.captionsTab : L.styleTab;

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: mode.pageBg }}>
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
          <Link
            to="/"
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
          </Link>
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
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            {saveError && (
              <span role="alert" style={{ fontSize: "12px", color: "#ef4444" }}>
                {saveError}
              </span>
            )}
            {justSaved && !dirty && (
              <span style={{ fontSize: "12px", color: mode.textFaint3 }}>{L.saved}</span>
            )}
            <div
              onClick={handleSave}
              className="amee-cta-btn"
              style={{
                fontSize: "13px",
                fontWeight: 700,
                color: theme.text,
                background: theme.accent,
                padding: "8px 18px",
                borderRadius: "8px",
                cursor: dirty && !saving ? "pointer" : "default",
                opacity: dirty && !saving ? 1 : 0.5,
              }}
            >
              {saving ? L.saving : L.save}
            </div>
            {/* POST /export is still 501 on the backend (backend/app/api/v1/export.py) --
                shown, not hidden, so the gap is visible rather than silently dropped. */}
            <div
              title="POST /projects/{id}/export — not implemented yet"
              style={{
                fontSize: "13px",
                fontWeight: 700,
                color: mode.textFaint3,
                background: mode.cardBg,
                padding: "8px 18px",
                borderRadius: "8px",
                cursor: "not-allowed",
                opacity: 0.5,
              }}
            >
              {L.export}
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
            <div style={{ fontSize: "15px", fontWeight: 700, color: mode.textMain }}>
              {activeTab === "style" ? L.styleTab : L.captionsTab}
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

          {notice && (
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
              {notice}
            </div>
          )}

          <div style={{ flex: 1, overflow: "auto", minHeight: 0, padding: "0 22px 22px" }}>
            {activeTab === "captions" ? (
              ecs && (
                <CaptionsPanel
                  prefs={prefs}
                  strings={L}
                  segments={ecs.segments}
                  popup={wordPopup}
                  confirmDeleteSegmentId={confirmDeleteSegmentId}
                  pendingWordId={pendingWordId}
                  onWordClick={handleWordClick}
                  onClosePopup={closeWordPopup}
                  onAddWord={handleAddWord}
                  onSplitSegment={handleSplitSegment}
                  onDeleteClick={handleDeleteSegmentClick}
                  onConfirmDelete={handleConfirmDeleteSegment}
                  onCancelDelete={handleCancelDeleteSegment}
                  onCommitPendingWord={handleCommitPendingWord}
                />
              )
            ) : (
              <div style={{ fontSize: "13px", color: mode.textFaint3, padding: "40px 0", textAlign: "center" }}>
                {L.stylePanelPlaceholder}
              </div>
            )}
          </div>
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", minHeight: 0 }}>
            <div
              ref={videoBoxRef}
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
                ref={videoRef}
                src={videoSrc}
                style={{ width: "100%", height: "100%", objectFit: "contain" }}
              />
              {ecs && resolvedStyle && videoBoxSize.width > 0 && (
                <CaptionOverlay
                  segments={ecs.segments}
                  currentTime={currentTime}
                  style={resolvedStyle}
                  containerWidth={videoBoxSize.width}
                  containerHeight={videoBoxSize.height}
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
              value={duration ? Math.round((currentTime / duration) * 1000) : 0}
              onChange={(e) => seekTo((Number(e.target.value) / 1000) * duration)}
              style={{ width: "100%", accentColor: theme.accent }}
            />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                <div
                  onClick={togglePlay}
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
                  {isPlaying ? "❚❚" : "▶"}
                </div>
                <div
                  style={{
                    fontSize: "12.5px",
                    color: mode.textFaint3,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {formatTime(currentTime)} / {formatTime(duration)}
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <div
                  onClick={() => seekTo(currentTime - 1)}
                  className="amee-icon-btn"
                  style={smallIconBtnStyle(mode)}
                >
                  «
                </div>
                <div
                  onClick={() => seekTo(currentTime + 1)}
                  className="amee-icon-btn"
                  style={smallIconBtnStyle(mode)}
                >
                  »
                </div>
                <div onClick={toggleMute} className="amee-icon-btn" style={smallIconBtnStyle(mode)}>
                  <VolumeIcon muted={muted || volume === 0} />
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={muted ? 0 : volume}
                  onChange={(e) => handleVolumeChange(Number(e.target.value))}
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

function VolumeIcon({ muted }: { muted: boolean }): JSX.Element {
  if (muted) {
    return (
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M11 5L6 9H2v6h4l5 4V5z" />
        <line x1="23" y1="9" x2="17" y2="15" />
        <line x1="17" y1="9" x2="23" y2="15" />
      </svg>
    );
  }
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M11 5L6 9H2v6h4l5 4V5z" />
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
    </svg>
  );
}
