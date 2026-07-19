import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Link, useParams } from "react-router-dom";

import TopBar from "../components/TopBar";
import CaptionOverlay from "../components/CaptionOverlay";
import CaptionsPanel, { type WordPopup } from "../components/CaptionsPanel";
import { useAmeePrefs } from "../hooks/useAmeePrefs";
import {
  ApiError,
  getEcs,
  getProject,
  getStyle,
  listPresets,
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
  const { prefs, update } = useAmeePrefs();
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

  // Selection/popup UI state only — nothing here mutates `ecs` yet (Step 5a). Add word /
  // split segment / delete segment logic lands in later steps; these handlers just manage
  // which popup or inline confirm is open.
  const [wordPopup, setWordPopup] = useState<WordPopup>(null);
  const [confirmDeleteSegmentId, setConfirmDeleteSegmentId] = useState<string | null>(null);

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

  // TODO(Step 5b): wire ecsEdit.addWordAt and call putEcs / update local `ecs` state.
  // Params kept to match the real handler signature callers already depend on.
  function handleAddWord(segmentId: string, wordId: string, side: "left" | "right") {
    void segmentId;
    void wordId;
    void side;
    setWordPopup(null);
  }

  // TODO(Step 5c): wire ecsEdit.splitSegmentAt and update local `ecs` state.
  function handleSplitSegment(segmentId: string, wordId: string) {
    void segmentId;
    void wordId;
    setWordPopup(null);
  }

  function handleDeleteSegmentClick(segmentId: string) {
    setWordPopup(null);
    setConfirmDeleteSegmentId(segmentId);
  }

  // TODO(Step 5d): wire ecsEdit.deleteSegment and update local `ecs` state.
  function handleConfirmDeleteSegment(segmentId: string) {
    void segmentId;
    setConfirmDeleteSegmentId(null);
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
        <TopBar prefs={prefs} onUpdatePrefs={update} />
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
        <TopBar prefs={prefs} onUpdatePrefs={update} />
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

  const activePreset =
    styleSpec && presets ? presets.find((p) => p.id === styleSpec.presetId) : undefined;
  const resolvedStyle: PresetBase | null =
    activePreset && styleSpec ? resolveStyle(activePreset, styleSpec.overrides) : null;

  return (
    <div style={{ minHeight: "100vh", background: mode.pageBg }}>
      <TopBar prefs={prefs} onUpdatePrefs={update} />

      <div style={{ maxWidth: "1200px", margin: "0 auto", padding: "32px" }}>
        {backLink}

        <div style={{ fontSize: "13px", fontWeight: 600, color: mode.textFaint3, marginBottom: "16px" }}>
          {project.name}
        </div>

        <div style={{ display: "flex", justifyContent: "center" }}>
          <div
            ref={videoBoxRef}
            style={{
              position: "relative",
              height: "min(70vh, 640px)",
              aspectRatio: String(aspect),
              maxWidth: "100%",
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

        <div
          style={{
            maxWidth: "640px",
            margin: "18px auto 0",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
          }}
        >
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

        {ecs && (
          <CaptionsPanel
            prefs={prefs}
            strings={L}
            segments={ecs.segments}
            popup={wordPopup}
            confirmDeleteSegmentId={confirmDeleteSegmentId}
            onWordClick={handleWordClick}
            onClosePopup={closeWordPopup}
            onAddWord={handleAddWord}
            onSplitSegment={handleSplitSegment}
            onDeleteClick={handleDeleteSegmentClick}
            onConfirmDelete={handleConfirmDeleteSegment}
            onCancelDelete={handleCancelDeleteSegment}
          />
        )}
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
