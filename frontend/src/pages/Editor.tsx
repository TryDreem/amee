import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Link, useParams } from "react-router-dom";

import CaptionOverlay from "../components/CaptionOverlay";
import CaptionsPanel, { type CaptionPopup } from "../components/CaptionsPanel";
import StylePanel from "../components/StylePanel";
import { useAmeePrefs } from "../hooks/useAmeePrefs";
import {
  ApiError,
  getEcs,
  getProject,
  getStyle,
  listPresets,
  putEcs,
  putStyle,
  resolveMediaUrl,
  resolveStyleLayers,
  type ECS,
  type CaptionStyleSpec,
  type PresetBase,
  type Preset,
  type Project,
  type StyleOverrides,
} from "../api/client";
import { resolveTheme, UI_MODES } from "../theme";
import { STR } from "../i18n";
import { findActiveSegmentIndex } from "../lib/activeSegment";
import {
  addWordAt,
  commitWordEnd,
  commitWordStart,
  commitWordText,
  deleteSegment,
  removeWord,
  splitSegmentAt,
} from "../lib/ecsEdit";

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
  const [wordPopup, setWordPopup] = useState<CaptionPopup>(null);
  const [confirmDeleteSegmentId, setConfirmDeleteSegmentId] = useState<string | null>(null);
  const [pendingWordId, setPendingWordId] = useState<string | null>(null);
  // Per-phrase style: which segment's style is currently being edited (arch §4.2). Keyed by the
  // segment's stable `id`, never an array index (D11) — index shifts on split/delete/merge and
  // would silently point the editor at the wrong phrase. Only meaningful while
  // CaptionStyleSpec.perPhraseStyle is on.
  const [editingSegmentId, setEditingSegmentId] = useState<string | null>(null);
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
  const [styleDirty, setStyleDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [justSaved, setJustSaved] = useState(false);

  function updateEcs(next: ECS) {
    setEcs(next);
    setDirty(true);
  }

  // Sparse merge into the document-level overrides, same "only the changed fields" shape the
  // wire format uses (contract §8) — a slider touching fontSize doesn't clobber any other
  // override already set. This is CaptionStyleSpec.overrides (Style document → styleDirty).
  function updateStyleOverrides(patch: StyleOverrides) {
    setStyleSpec((prev) => (prev ? { ...prev, overrides: { ...prev.overrides, ...patch } } : prev));
    setStyleDirty(true);
  }

  // Sparse merge into ONE segment's own overrides (arch §4.2). Segment.overrides lives in the
  // ECS, so this marks the ECS dirty (not the style doc). Addressed by segment id (D11). Created
  // lazily — a segment stays override-free until its style is actually edited here.
  function updateSegmentOverrides(segmentId: string, patch: StyleOverrides) {
    setEcs((prev) =>
      prev
        ? {
            ...prev,
            segments: prev.segments.map((s) =>
              s.id === segmentId ? { ...s, overrides: { ...(s.overrides ?? {}), ...patch } } : s
            ),
          }
        : prev
    );
    setDirty(true);
  }

  // Routes a style-panel change to the right place: while per-phrase mode is on AND a segment is
  // selected for editing, changes write to THAT segment's overrides; otherwise they write to the
  // document-level style (arch §4.2 — "any change in the style panel is written to
  // segmentStyles[editingSegmentId]... only when the mode is on and a segment is selected").
  function handleChangeStyleOverrides(patch: StyleOverrides) {
    if (styleSpec?.perPhraseStyle && editingSegmentId) {
      updateSegmentOverrides(editingSegmentId, patch);
    } else {
      updateStyleOverrides(patch);
    }
  }

  // Preset switch: CaptionStyleSpec replaced with the new preset's base values, local
  // overrides reset (architecture §7 Behavior Matrix — already-committed row). Preset is a
  // document-level field (no presetId on Segment.overrides), so this stays document-level even
  // in per-phrase mode.
  function selectPreset(presetId: string) {
    setStyleSpec((prev) => (prev ? { ...prev, presetId, overrides: {} } : prev));
    setStyleDirty(true);
  }

  // Document-level toggle (contract §8 perPhraseStyle). Turning it OFF stops editing a specific
  // segment (editingSegmentId → null) but deletes NO segment overrides — they lie dormant and
  // reappear if toggled back on (arch §4.2). Turning it ON leaves editingSegmentId as-is (null
  // until the user picks a segment via its brush).
  function togglePerPhraseStyle() {
    setStyleSpec((prev) => {
      if (!prev) {
        return prev;
      }
      const on = !prev.perPhraseStyle;
      if (!on) {
        setEditingSegmentId(null);
      }
      return { ...prev, perPhraseStyle: on };
    });
    setStyleDirty(true);
  }

  // Brush click on a segment card (only shown when perPhraseStyle is on): select that segment for
  // style editing, jump the player to its start, and switch to the Style tab so the panel is
  // visible (arch §4.2 editing-vs-rendering: this sets the *editing* target, independent of which
  // segment is on screen).
  function handleEditSegmentStyle(segmentId: string) {
    const segment = ecs?.segments.find((s) => s.id === segmentId);
    const start = segment?.words[0]?.start;
    if (start != null) {
      seekTo(start);
    }
    setEditingSegmentId(segmentId);
    setActiveTab("style");
  }

  async function handleSave() {
    if (!id || saving || (!dirty && !styleDirty)) {
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      if (dirty && ecs) {
        const saved = await putEcs(id, ecs.segments);
        setEcs(saved);
        setDirty(false);
      }
      if (styleDirty && styleSpec) {
        const saved = await putStyle(id, styleSpec.presetId, styleSpec.perPhraseStyle, styleSpec.overrides);
        setStyleSpec(saved);
        setStyleDirty(false);
      }
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
    setWordPopup({ type: "word", segmentId, wordId });
  }

  function handleRangeClick(segmentId: string) {
    setConfirmDeleteSegmentId(null);
    setWordPopup({ type: "scene", segmentId });
  }

  function closeWordPopup() {
    setWordPopup(null);
  }

  // Remove word: real, distinct from Delete segment — removes just the one word. If that
  // empties the segment, removeWord drops the whole segment too (never leaves a 0-word one).
  function handleRemoveWord(segmentId: string, wordId: string) {
    setWordPopup(null);
    if (!ecs) {
      return;
    }
    updateEcs({ ...ecs, segments: removeWord(ecs.segments, segmentId, wordId) });
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

  // Unified for both a freshly-inserted pending word and text-editing an existing word via its
  // popup -- empty text removes the word, text over the edit-time limits (architecture.md
  // §7.1) also removes it with a 10s notice. Clears pendingWordId only when it's the word that
  // was actually committed, so committing a *different* word's text (popup open on one word
  // while another is still pending) doesn't stomp on unrelated state.
  function handleCommitWordText(segmentId: string, wordId: string, text: string) {
    if (!ecs) {
      return;
    }
    const result = commitWordText(ecs.segments, segmentId, wordId, text);
    updateEcs({ ...ecs, segments: result.segments });
    if (pendingWordId === wordId) {
      setPendingWordId(null);
    }
    if (result.kind === "removed_limit") {
      showNotice(result.limit === "words" ? L.noticeMaxWords : L.noticeMaxChars);
    }
  }

  // Word-boundary editing: real (word popup's start/end fields + the Scene Duration popup,
  // which edits the segment's first/last word directly -- segment bounds stay derived, never
  // stored, per D5; there's no separate field to hold an independent scene start/end).
  function handleCommitWordStart(segmentId: string, wordId: string, raw: string) {
    if (!ecs) {
      return;
    }
    updateEcs({ ...ecs, segments: commitWordStart(ecs.segments, segmentId, wordId, raw) });
  }

  function handleCommitWordEnd(segmentId: string, wordId: string, raw: string) {
    if (!ecs) {
      return;
    }
    updateEcs({ ...ecs, segments: commitWordEnd(ecs.segments, segmentId, wordId, raw) });
  }

  function handleCommitSceneStart(segmentId: string, raw: string) {
    if (!ecs) {
      return;
    }
    const segment = ecs.segments.find((s) => s.id === segmentId);
    const firstWord = segment?.words[0];
    if (!firstWord) {
      return;
    }
    updateEcs({ ...ecs, segments: commitWordStart(ecs.segments, segmentId, firstWord.id, raw) });
  }

  function handleCommitSceneEnd(segmentId: string, raw: string) {
    if (!ecs) {
      return;
    }
    const segment = ecs.segments.find((s) => s.id === segmentId);
    const lastWord = segment?.words.at(-1);
    if (!lastWord) {
      return;
    }
    updateEcs({ ...ecs, segments: commitWordEnd(ecs.segments, segmentId, lastWord.id, raw) });
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
    if (editingSegmentId === segmentId) {
      setEditingSegmentId(null);
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

  const perPhrase = styleSpec?.perPhraseStyle ?? false;

  // RENDERING resolution (arch §4.2): the segment active at the current time gets its own
  // effective style. CaptionOverlay independently re-derives the active segment from the same
  // currentTime/segments, so the two always agree on which segment this style belongs to. When
  // per-phrase is off, segment overrides lie dormant (null passed) and every segment renders the
  // document style.
  const renderSegment =
    ecs && findActiveSegmentIndex(ecs.segments, currentTime) >= 0
      ? ecs.segments[findActiveSegmentIndex(ecs.segments, currentTime)]
      : undefined;
  const resolvedStyle: PresetBase | null =
    activePreset && styleSpec
      ? resolveStyleLayers(activePreset, styleSpec.overrides, perPhrase ? renderSegment?.overrides : null)
      : null;

  // EDITING resolution (arch §4.2): the style shown in / written by the panel is for the segment
  // selected for editing (editingSegmentId), which is frequently NOT the one on screen. When
  // per-phrase is off, or no segment is selected, the panel edits the document-level style.
  const editingSegment =
    perPhrase && editingSegmentId ? ecs?.segments.find((s) => s.id === editingSegmentId) : undefined;
  const panelStyle: PresetBase | null =
    activePreset && styleSpec
      ? resolveStyleLayers(activePreset, styleSpec.overrides, editingSegment?.overrides)
      : null;

  const otherTab = activeTab === "style" ? "captions" : "style";
  const tabLabel = activeTab === "style" ? L.captionsStyleLabel : L.captionsLabel;
  const otherTabLabel = activeTab === "style" ? L.editCaptionsLabel : L.captionsStyleLabel;

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
            {justSaved && !dirty && !styleDirty && (
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
                cursor: (dirty || styleDirty) && !saving ? "pointer" : "default",
                opacity: (dirty || styleDirty) && !saving ? 1 : 0.5,
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
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <div style={{ fontSize: "15px", fontWeight: 700, color: mode.textMain }}>{tabLabel}</div>
              {styleSpec && (
                <div
                  onClick={togglePerPhraseStyle}
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

          {activeTab === "captions" ? (
            <div style={{ flex: 1, overflow: "auto", minHeight: 0, padding: "0 22px 22px" }}>
              {ecs && (
                <CaptionsPanel
                  prefs={prefs}
                  strings={L}
                  segments={ecs.segments}
                  currentTime={currentTime}
                  resolvedStyle={resolvedStyle}
                  perPhraseStyle={perPhrase}
                  editingSegmentId={editingSegmentId}
                  popup={wordPopup}
                  confirmDeleteSegmentId={confirmDeleteSegmentId}
                  pendingWordId={pendingWordId}
                  onSeek={seekTo}
                  onEditSegmentStyle={handleEditSegmentStyle}
                  onWordClick={handleWordClick}
                  onRangeClick={handleRangeClick}
                  onClosePopup={closeWordPopup}
                  onAddWord={handleAddWord}
                  onSplitSegment={handleSplitSegment}
                  onRemoveWord={handleRemoveWord}
                  onDeleteClick={handleDeleteSegmentClick}
                  onConfirmDelete={handleConfirmDeleteSegment}
                  onCancelDelete={handleCancelDeleteSegment}
                  onCommitWordText={handleCommitWordText}
                  onCommitWordStart={handleCommitWordStart}
                  onCommitWordEnd={handleCommitWordEnd}
                  onCommitSceneStart={handleCommitSceneStart}
                  onCommitSceneEnd={handleCommitSceneEnd}
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
              // When editing one segment's style, highlight colors collapse to a single "Main"
              // swatch (arch §4.2 — a per-phrase override is authored as a length-1
              // highlightColors array; per-word karaoke across 3 colors is meaningless for one
              // phrase). Off / no segment selected → the normal 3-swatch document editor.
              singleColor={Boolean(editingSegment)}
              onSelectPreset={selectPreset}
              onChangeOverrides={handleChangeStyleOverrides}
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
