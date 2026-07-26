import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import CaptionOverlay from "../components/CaptionOverlay";
import CaptionsPanel, { type CaptionPopup } from "../components/CaptionsPanel";
import StylePanel from "../components/StylePanel";
import { useAmeePrefs } from "../hooks/useAmeePrefs";
import {
  ApiError,
  exportProject,
  exportProjectSrt,
  exportSrtUrl,
  exportVideoUrl,
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
  type ExportPayload,
  type PresetBase,
  type Preset,
  type Project,
  type Segment,
  type StyleOverrides,
} from "../api/client";
import { useJobPolling } from "../hooks/useJobPolling";
import { resolveTheme, UI_MODES } from "../theme";
import { STR } from "../i18n";
import { findActiveSegmentIndex } from "../lib/activeSegment";
import { fontName } from "../lib/fonts";
import {
  addWordAt,
  commitWordEnd,
  commitWordStart,
  commitWordText,
  deleteSegment,
  removeWord,
  splitSegmentAt,
} from "../lib/ecsEdit";
import {
  canRedo as canRedoHistory,
  canUndo as canUndoHistory,
  initHistory,
  push as pushHistory,
  redo as redoHistory,
  undo as undoHistory,
  type History,
} from "../lib/history";

// Step 7: everything the undo/redo stack tracks as one edit -- content (segments) and the
// document-level style fields, snapshotted together so a single Undo button steps through
// whichever kind of edit the user made last (matches the Behavior Matrix's own framing: one
// linear undo/redo history, not separate content/style stacks).
interface EditSnapshot {
  segments: Segment[];
  presetId: string;
  perPhraseStyle: boolean;
  overrides: StyleOverrides;
}

// `overrides.fontFamily` must be one bare family name: it ends up in the export's ASS `Style:`
// line, which is comma-separated, so a CSS stack ("'Golos Text', sans-serif") shifts every field
// after it and libass drops the style — the video burns with no captions. Documents written
// before that was settled hold exactly that, so collapse it to the family name on load; the next
// save/export then persists the repaired value. Applied before the save point is taken, so this
// repair never shows up as an unsaved change.
function normalizeStyle(style: CaptionStyleSpec): CaptionStyleSpec {
  const family = style.overrides.fontFamily;
  if (typeof family !== "string" || fontName(family) === family) {
    return style;
  }
  return { ...style, overrides: { ...style.overrides, fontFamily: fontName(family) } };
}

function snapshotOf(ecs: ECS, style: CaptionStyleSpec): EditSnapshot {
  return structuredClone({
    segments: ecs.segments,
    presetId: style.presetId,
    perPhraseStyle: style.perPhraseStyle,
    overrides: style.overrides,
  });
}

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

export default function Editor(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
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

  // The "⋯" export options menu in the top bar (design's `menuOpen`). Anchored to the dots
  // button, closed on outside-click / Escape.
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  // Export (Step 8). Both endpoints are async jobs (contract §12): POST returns 202 + a Job, then
  // GET /jobs/{id} is polled until done/failed — the same hook already used for transcribe. Only
  // one export runs at a time; `exportKind` records which url to pull off the finished job, since
  // `Job.result` is a union whose shape follows the job type.
  const [exportJobId, setExportJobId] = useState<string | null>(null);
  const [exportKind, setExportKind] = useState<"video" | "srt" | null>(null);
  const [exportStarting, setExportStarting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  // The last finished artifact, kept until the next export replaces it, so a blocked or failed
  // automatic download never leaves the user with nothing to click.
  const [exportReady, setExportReady] = useState<{ url: string; filename: string } | null>(null);
  const { job: exportJob, error: exportPollError } = useJobPolling(exportJobId);
  // Which job has already been handed to the user. Clearing exportJobId/exportKind re-runs the
  // completion effect before the poller's own reset lands, which would otherwise download the
  // same file twice — this makes handling a finished job idempotent per job id.
  const handledExportJobRef = useRef<string | null>(null);

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

  // Step 7: undo/redo history. `lastSavedRef` is the snapshot last confirmed on the server (set
  // on initial load and after each successful save) -- dirty/styleDirty are always recomputed
  // against it, never toggled as an independent boolean, so undo/redo can't desync them (e.g.
  // undoing back to exactly the last-saved state must clear dirty, not leave it stuck true).
  const [history, setHistory] = useState<History<EditSnapshot> | null>(null);
  const historyRef = useRef<History<EditSnapshot> | null>(null);
  const lastSavedRef = useRef<EditSnapshot | null>(null);
  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  function recomputeDirty(next: EditSnapshot) {
    const saved = lastSavedRef.current;
    setDirty(saved == null || JSON.stringify(next.segments) !== JSON.stringify(saved.segments));
    setStyleDirty(
      saved == null ||
        next.presetId !== saved.presetId ||
        next.perPhraseStyle !== saved.perPhraseStyle ||
        JSON.stringify(next.overrides) !== JSON.stringify(saved.overrides)
    );
  }

  // Applies a snapshot as the new current state -- shared by real edits, undo, and redo, so all
  // three ways of landing on a given document state update ecs/styleSpec/dirty identically.
  function commitSnapshot(next: EditSnapshot) {
    setEcs((prev) => (prev ? { ...prev, segments: next.segments } : prev));
    setStyleSpec((prev) =>
      prev
        ? { ...prev, presetId: next.presetId, perPhraseStyle: next.perPhraseStyle, overrides: next.overrides }
        : prev
    );
    recomputeDirty(next);
  }

  // The one entry point every real edit (content or style) goes through: pushes the current
  // state onto the undo stack, then commits `next` as the new present. `history.present` always
  // mirrors ecs/styleSpec, so pushing it is equivalent to snapshotting "before this edit".
  function applyEdit(next: EditSnapshot) {
    if (history) {
      setHistory(pushHistory(history, next));
    }
    commitSnapshot(next);
  }

  function handleUndo() {
    const h = historyRef.current;
    if (!h || !canUndoHistory(h)) {
      return;
    }
    const nextHistory = undoHistory(h);
    setHistory(nextHistory);
    commitSnapshot(nextHistory.present);
  }

  function handleRedo() {
    const h = historyRef.current;
    if (!h || !canRedoHistory(h)) {
      return;
    }
    const nextHistory = redoHistory(h);
    setHistory(nextHistory);
    commitSnapshot(nextHistory.present);
  }

  // Content edit: builds the next snapshot from the current style fields (untouched) plus the
  // new `segments` (every ecsEdit.ts operation -- add/remove/split/delete/commit word -- produces
  // a full next Segment[], never a diff).
  function applyEcsSegments(newSegments: Segment[]) {
    if (!ecs || !styleSpec) {
      return;
    }
    applyEdit({
      segments: newSegments,
      presetId: styleSpec.presetId,
      perPhraseStyle: styleSpec.perPhraseStyle,
      overrides: styleSpec.overrides,
    });
  }

  // Sparse merge of a style-panel patch into the right place: while per-phrase mode is on AND a
  // segment is selected for editing, it goes into THAT segment's own overrides (Segment.overrides
  // lives in the ECS, arch §4.2, addressed by segment id per D11, created lazily); otherwise it
  // goes into the document-level CaptionStyleSpec.overrides (contract §8's sparse "only the
  // changed fields" shape — a slider touching fontSize doesn't clobber any other override
  // already set). Pure -- doesn't touch state -- so it's shared between the instant-apply path
  // and the drag-coalesced live/commit path below.
  function nextSnapshotForOverridesPatch(patch: StyleOverrides): EditSnapshot | null {
    if (!ecs || !styleSpec) {
      return null;
    }
    if (styleSpec.perPhraseStyle && editingSegmentId) {
      const segments = ecs.segments.map((s) =>
        s.id === editingSegmentId ? { ...s, overrides: { ...(s.overrides ?? {}), ...patch } } : s
      );
      return {
        segments,
        presetId: styleSpec.presetId,
        perPhraseStyle: styleSpec.perPhraseStyle,
        overrides: styleSpec.overrides,
      };
    }
    return {
      segments: ecs.segments,
      presetId: styleSpec.presetId,
      perPhraseStyle: styleSpec.perPhraseStyle,
      overrides: { ...styleSpec.overrides, ...patch },
    };
  }

  // Instant changes (buttons, toggles, preset picks, color swatches): one patch, one history
  // entry, applied immediately.
  function handleChangeStyleOverrides(patch: StyleOverrides) {
    const next = nextSnapshotForOverridesPatch(patch);
    if (next) {
      applyEdit(next);
    }
  }

  // Continuous drag (range sliders): React's onChange fires on every tick of a drag, not just on
  // release. Pushing a full history entry per tick would make one Undo only step back one tick
  // (e.g. 9.9% instead of the 7.5% the drag started from) instead of undoing the whole gesture.
  // `Live` applies each tick's value for a responsive preview WITHOUT touching history --
  // history.present is deliberately left at its pre-drag value throughout the drag.
  function handleChangeStyleOverridesLive(patch: StyleOverrides) {
    const next = nextSnapshotForOverridesPatch(patch);
    if (next) {
      commitSnapshot(next);
    }
  }

  // Called once when the drag/gesture ends (mouseup/touchend/keyup/blur on the slider). Folds
  // every live tick since the last commit into exactly one history entry, since history.present
  // still holds the pre-drag value.
  function commitPendingEdit() {
    if (!ecs || !styleSpec || !history) {
      return;
    }
    const current = snapshotOf(ecs, styleSpec);
    if (JSON.stringify(current) === JSON.stringify(history.present)) {
      return;
    }
    setHistory(pushHistory(history, current));
  }

  // Preset switch: CaptionStyleSpec replaced with the new preset's base values, local
  // overrides reset (architecture §7 Behavior Matrix — already-committed row). Preset is a
  // document-level field (no presetId on Segment.overrides), so this stays document-level even
  // in per-phrase mode.
  function selectPreset(presetId: string) {
    if (!ecs || !styleSpec) {
      return;
    }
    applyEdit({
      segments: ecs.segments,
      presetId,
      perPhraseStyle: styleSpec.perPhraseStyle,
      overrides: {},
    });
  }

  // Document-level toggle (contract §8 perPhraseStyle). Turning it OFF stops editing a specific
  // segment (editingSegmentId → null) but deletes NO segment overrides — they lie dormant and
  // reappear if toggled back on (arch §4.2). Turning it ON leaves editingSegmentId as-is (null
  // until the user picks a segment via its brush).
  function togglePerPhraseStyle() {
    if (!ecs || !styleSpec) {
      return;
    }
    const on = !styleSpec.perPhraseStyle;
    if (!on) {
      setEditingSegmentId(null);
    }
    applyEdit({
      segments: ecs.segments,
      presetId: styleSpec.presetId,
      perPhraseStyle: on,
      overrides: styleSpec.overrides,
    });
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

  // The finished file arrives from a poll, not from the click, so there's no user activation left
  // by then: opening it in a new tab is silently swallowed by the popup blocker and the export
  // appears to do nothing. Fetching it as a blob sidesteps that entirely — a blob: URL is
  // same-origin, so `download` is honored and no window is opened. Whatever happens here, the
  // caller also leaves a visible link, so a failure can't lose the artifact.
  async function triggerDownload(url: string, filename: string) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`${response.status}`);
    }
    const objectUrl = URL.createObjectURL(await response.blob());
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoking synchronously can cancel the download that was just started.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  }

  async function startExport(kind: "video" | "srt") {
    if (!id || !ecs || !styleSpec || exportStarting || exportJobId) {
      return;
    }
    setExportError(null);
    setExportReady(null);
    setExportStarting(true);
    const payload: ExportPayload = {
      segments: ecs.segments,
      presetId: styleSpec.presetId,
      perPhraseStyle: styleSpec.perPhraseStyle,
      overrides: styleSpec.overrides,
    };
    try {
      const job = kind === "srt" ? await exportProjectSrt(id, payload) : await exportProject(id, payload);
      setExportKind(kind);
      setExportJobId(job.id);
      // POST /export persists the submitted ecs+style as a side effect (X5), so the document on
      // the server now matches what's on screen — reflect that instead of leaving Save still
      // claiming unsaved changes. /export-srt deliberately does NOT persist (X6), so it must not
      // touch the save point.
      if (kind === "video") {
        lastSavedRef.current = snapshotOf(ecs, styleSpec);
        setDirty(false);
        setStyleDirty(false);
      }
    } catch (err) {
      setExportError(err instanceof ApiError ? `${err.status}: ${err.message}` : L.exportFailed);
    } finally {
      setExportStarting(false);
    }
  }

  // Shared by the Save button and "go home" (below): both need "persist whatever is dirty, then
  // do the thing" with identical error handling, so there's one save path instead of two that
  // could drift. Returns true when it's safe to proceed (saved, or there was nothing to save) —
  // false on a real failure, which the caller must NOT treat as "safe to navigate away from
  // unsaved work".
  async function performSave(): Promise<boolean> {
    if (!id || !ecs || !styleSpec) {
      return true;
    }
    if (!dirty && !styleDirty) {
      return true;
    }
    setSaving(true);
    setSaveError(null);
    try {
      let nextEcs = ecs;
      let nextStyle = styleSpec;
      if (dirty) {
        nextEcs = await putEcs(id, ecs.segments);
        setEcs(nextEcs);
        setDirty(false);
      }
      if (styleDirty) {
        nextStyle = await putStyle(id, styleSpec.presetId, styleSpec.perPhraseStyle, styleSpec.overrides);
        setStyleSpec(nextStyle);
        setStyleDirty(false);
      }
      // The server's echo becomes the new save point AND the new undo-stack "present" -- if the
      // backend normalized anything in the round-trip, subsequent undos should land on what's
      // actually persisted, not on the pre-save snapshot that was sent.
      const savedSnapshot = snapshotOf(nextEcs, nextStyle);
      lastSavedRef.current = savedSnapshot;
      setHistory((h) => (h ? { ...h, present: savedSnapshot } : h));
      return true;
    } catch (err) {
      setSaveError(err instanceof ApiError ? `${err.status}: ${err.message}` : L.saveFailed);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleSave() {
    if (saving) {
      return;
    }
    const ok = await performSave();
    if (ok) {
      setJustSaved(true);
      clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => setJustSaved(false), 2000);
    }
  }

  // Leaving the editor via the home icon (design: e_onGoHome) persists whatever is dirty first,
  // same as clicking Save, then navigates with a "just saved" flag the Home page reads once to
  // play the toast (design's sessionStorage flag, done via router state instead since this is one
  // SPA rather than two static pages). A failed save must NOT navigate away — that would silently
  // strand the user's edits behind a page they can no longer see, having just told them it worked.
  async function handleGoHome() {
    if (saving) {
      return;
    }
    const ok = await performSave();
    if (ok) {
      navigate("/", { state: { justSaved: true } });
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
          const normalized = normalizeStyle(styleResult);
          setEcs(ecsResult);
          setStyleSpec(normalized);
          setPresets(presetsResult);
          const snapshot = snapshotOf(ecsResult, normalized);
          lastSavedRef.current = snapshot;
          setHistory(initHistory(snapshot));
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

  // Step 7c: Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z, matching the Behavior Matrix's "button or keyboard
  // shortcut" wording. Reads history via the ref (not the `history` state closure) so this
  // listener is attached exactly once rather than re-subscribing on every edit. Skipped while
  // focus is inside a text input/textarea/contenteditable so it doesn't fight the field's own
  // native undo (e.g. while typing a word's text or a timestamp).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod || e.key.toLowerCase() !== "z") {
        return;
      }
      const target = e.target as HTMLElement | null;
      const isEditable =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        Boolean(target?.isContentEditable);
      if (isEditable) {
        return;
      }
      e.preventDefault();
      if (e.shiftKey) {
        handleRedo();
      } else {
        handleUndo();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // Intentionally empty deps: handleUndo/handleRedo read history via historyRef, not the
    // `history` closure, specifically so this listener attaches once instead of on every edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Finished export job -> hand the artifact to the user, then clear the job so the poller stops
  // and a new export can start. `result` is a union keyed on job type, so the url is read through
  // the matching narrowing helper rather than by indexing a field that may not be there.
  useEffect(() => {
    if (!exportJob || (exportJob.status !== "done" && exportJob.status !== "failed")) {
      return;
    }
    if (handledExportJobRef.current === exportJob.id) {
      return;
    }
    handledExportJobRef.current = exportJob.id;
    if (exportJob.status === "done") {
      const url = exportKind === "srt" ? exportSrtUrl(exportJob) : exportVideoUrl(exportJob);
      if (url) {
        const filename = exportKind === "srt" ? "captions.srt" : "video.mp4";
        const absolute = resolveMediaUrl(url);
        // Kept in state as well as auto-downloaded: the link is the guarantee. If the automatic
        // download is blocked or the fetch fails, a finished export must still be reachable
        // rather than silently lost.
        setExportReady({ url: absolute, filename });
        void triggerDownload(absolute, filename).catch(() => {
          /* the visible link above remains the way to get it */
        });
      } else {
        setExportError(L.exportFailed);
      }
      setExportJobId(null);
      setExportKind(null);
    } else if (exportJob.status === "failed") {
      setExportError(exportJob.error ?? L.exportFailed);
      setExportJobId(null);
      setExportKind(null);
    }
    // `triggerDownload`/`L` are stable enough for this effect's purpose; re-running it on every
    // render would re-fire the download.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exportJob, exportKind]);

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
    applyEcsSegments(removeWord(ecs.segments, segmentId, wordId));
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
    applyEcsSegments(result.segments);
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
    applyEcsSegments(result.segments);
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
    applyEcsSegments(commitWordStart(ecs.segments, segmentId, wordId, raw));
  }

  function handleCommitWordEnd(segmentId: string, wordId: string, raw: string) {
    if (!ecs) {
      return;
    }
    applyEcsSegments(commitWordEnd(ecs.segments, segmentId, wordId, raw));
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
    applyEcsSegments(commitWordStart(ecs.segments, segmentId, firstWord.id, raw));
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
    applyEcsSegments(commitWordEnd(ecs.segments, segmentId, lastWord.id, raw));
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
    applyEcsSegments(result.segments);
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
    applyEcsSegments(deleteSegment(ecs.segments, segmentId));
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
  const undoAvailable = history != null && canUndoHistory(history);
  const redoAvailable = history != null && canRedoHistory(history);

  // An export is in flight from the click until the polled job reaches done/failed.
  const exportBusy = exportStarting || exportJobId !== null;
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
          <div
            onClick={() => void handleGoHome()}
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
              onClick={handleUndo}
              aria-label={L.undo}
              title={L.undo}
              className="amee-icon-btn"
              style={{
                ...headerIconBtnStyle(mode),
                cursor: undoAvailable ? "pointer" : "default",
                opacity: undoAvailable ? 1 : 0.35,
              }}
            >
              ↺
            </div>
            <div
              onClick={handleRedo}
              aria-label={L.redo}
              title={L.redo}
              className="amee-icon-btn"
              style={{
                ...headerIconBtnStyle(mode),
                cursor: redoAvailable ? "pointer" : "default",
                opacity: redoAvailable ? 1 : 0.35,
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
                      void startExport("srt");
                    }}
                    style={{
                      ...menuItemStyle,
                      cursor: exportBusy ? "default" : "pointer",
                      opacity: exportBusy ? 0.5 : 1,
                    }}
                  >
                    {exportBusy && exportKind === "srt" ? L.exporting : L.downloadSrt}
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
            {(saveError || exportError || exportPollError) && (
              <span role="alert" style={{ fontSize: "12px", color: "#ef4444" }}>
                {saveError ?? exportError ?? exportPollError}
              </span>
            )}
            {justSaved && !dirty && !styleDirty && (
              <span style={{ fontSize: "12px", color: mode.textFaint3 }}>{L.saved}</span>
            )}
            {exportReady && (
              <a
                href={exportReady.url}
                download={exportReady.filename}
                target="_blank"
                rel="noreferrer"
                className="amee-cta-btn"
                style={{
                  fontSize: "12.5px",
                  fontWeight: 700,
                  color: theme.text,
                  background: theme.accent,
                  padding: "7px 14px",
                  borderRadius: "8px",
                  textDecoration: "none",
                }}
              >
                {L.downloadReady}
              </a>
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
            {/* POST /export renders the burned-in video and persists ecs+style as a side
                effect (X5), so it works with or without a preceding Save. */}
            <div
              onClick={() => void startExport("video")}
              className="amee-cta-btn"
              style={{
                fontSize: "13px",
                fontWeight: 700,
                color: mode.textMain,
                background: mode.cardBg,
                padding: "8px 18px",
                borderRadius: "8px",
                cursor: exportBusy ? "default" : "pointer",
                opacity: exportBusy ? 0.6 : 1,
              }}
            >
              {exportBusy && exportKind !== "srt" ? L.exporting : L.export}
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
              onLiveChangeOverrides={handleChangeStyleOverridesLive}
              onCommitOverrides={commitPendingEdit}
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
                  isPlaying={isPlaying}
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
