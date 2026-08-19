import { useCallback, useEffect, useRef, useState } from "react";

import {
  getEcs,
  getStyle,
  listPresets,
  type CaptionStyleSpec,
  type ECS,
  type Preset,
  type Segment,
} from "../api/client";
import {
  canRedo as canRedoHistory,
  canUndo as canUndoHistory,
  initHistory,
  push as pushHistory,
  redo as redoHistory,
  undo as undoHistory,
  type History,
} from "../lib/history";
import { normalizeStyle, snapshotOf, type EditSnapshot } from "../lib/editSnapshot";

export interface EditorDocument {
  ecs: ECS | null;
  styleSpec: CaptionStyleSpec | null;
  presets: Preset[] | null;
  dirty: boolean;
  styleDirty: boolean;
  undoAvailable: boolean;
  redoAvailable: boolean;
  // The one entry point every real edit (content or style) goes through.
  applyEdit: (next: EditSnapshot) => void;
  // Applies a snapshot WITHOUT pushing history -- the live half of a coalesced drag.
  commitSnapshot: (next: EditSnapshot) => void;
  // Content edit shorthand: keeps the current style fields, swaps in new segments.
  applyEcsSegments: (segments: Segment[]) => void;
  // Folds every live tick since the last commit into exactly one history entry.
  commitPendingEdit: () => void;
  undo: () => void;
  redo: () => void;
  // Save integration: the server's echo replaces local state and clears that half's dirty flag.
  acceptSavedEcs: (next: ECS) => void;
  acceptSavedStyle: (next: CaptionStyleSpec) => void;
  // New save point after a successful PUT. Also becomes the undo stack's `present` -- if the
  // backend normalized anything in the round-trip, subsequent undos should land on what's
  // actually persisted, not on the pre-save snapshot that was sent.
  commitSavePoint: (saved: EditSnapshot) => void;
  // POST /export persists the submitted ecs+style as a side effect (X5), so the document on the
  // server now matches what's on screen -- move the save point up to it without touching history
  // (nothing was edited, so there is nothing new to undo).
  markCurrentAsSaved: () => void;
}

// Owns the edited document itself (ECS + CaptionStyleSpec) together with its undo/redo history
// and dirty tracking, because the three are one state machine, not three: every edit pushes
// history, and `dirty` is always recomputed by comparing against the last-saved snapshot rather
// than toggled as an independent boolean -- so undo/redo can't desync it (undoing back to exactly
// the last-saved state clears dirty instead of leaving it stuck true). Splitting them across
// hooks would mean exporting `lastSavedRef` publicly, which is weaker encapsulation than the
// single component this replaces.
export function useEditorDocument(projectId: string | undefined): EditorDocument {
  const [ecs, setEcs] = useState<ECS | null>(null);
  const [styleSpec, setStyleSpec] = useState<CaptionStyleSpec | null>(null);
  const [presets, setPresets] = useState<Preset[] | null>(null);

  const [dirty, setDirty] = useState(false);
  const [styleDirty, setStyleDirty] = useState(false);

  const [history, setHistory] = useState<History<EditSnapshot> | null>(null);
  const historyRef = useRef<History<EditSnapshot> | null>(null);
  const lastSavedRef = useRef<EditSnapshot | null>(null);
  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  // ECS/style/presets are independent of the video player; a failure here shouldn't block
  // playback — captions just won't render (the video still loads and plays fine on its own).
  useEffect(() => {
    if (!projectId) {
      return;
    }
    let cancelled = false;
    Promise.all([getEcs(projectId), getStyle(projectId), listPresets()])
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
  }, [projectId]);

  const recomputeDirty = useCallback((next: EditSnapshot) => {
    const saved = lastSavedRef.current;
    setDirty(saved == null || JSON.stringify(next.segments) !== JSON.stringify(saved.segments));
    setStyleDirty(
      saved == null ||
        next.presetId !== saved.presetId ||
        next.perPhraseStyle !== saved.perPhraseStyle ||
        JSON.stringify(next.overrides) !== JSON.stringify(saved.overrides)
    );
  }, []);

  // Applies a snapshot as the new current state -- shared by real edits, undo, and redo, so all
  // three ways of landing on a given document state update ecs/styleSpec/dirty identically.
  const commitSnapshot = useCallback(
    (next: EditSnapshot) => {
      setEcs((prev) => (prev ? { ...prev, segments: next.segments } : prev));
      setStyleSpec((prev) =>
        prev
          ? { ...prev, presetId: next.presetId, perPhraseStyle: next.perPhraseStyle, overrides: next.overrides }
          : prev
      );
      recomputeDirty(next);
    },
    [recomputeDirty]
  );

  // Pushes the current state onto the undo stack, then commits `next` as the new present.
  // `history.present` always mirrors ecs/styleSpec, so pushing it is equivalent to snapshotting
  // "before this edit".
  const applyEdit = useCallback(
    (next: EditSnapshot) => {
      const h = historyRef.current;
      if (h) {
        setHistory(pushHistory(h, next));
      }
      commitSnapshot(next);
    },
    [commitSnapshot]
  );

  const undo = useCallback(() => {
    const h = historyRef.current;
    if (!h || !canUndoHistory(h)) {
      return;
    }
    const nextHistory = undoHistory(h);
    setHistory(nextHistory);
    commitSnapshot(nextHistory.present);
  }, [commitSnapshot]);

  const redo = useCallback(() => {
    const h = historyRef.current;
    if (!h || !canRedoHistory(h)) {
      return;
    }
    const nextHistory = redoHistory(h);
    setHistory(nextHistory);
    commitSnapshot(nextHistory.present);
  }, [commitSnapshot]);

  // Content edit: builds the next snapshot from the current style fields (untouched) plus the
  // new `segments` (every ecsEdit.ts operation -- add/remove/split/delete/commit word -- produces
  // a full next Segment[], never a diff).
  const applyEcsSegments = useCallback(
    (newSegments: Segment[]) => {
      if (!ecs || !styleSpec) {
        return;
      }
      applyEdit({
        segments: newSegments,
        presetId: styleSpec.presetId,
        perPhraseStyle: styleSpec.perPhraseStyle,
        overrides: styleSpec.overrides,
      });
    },
    [ecs, styleSpec, applyEdit]
  );

  // Called once when a drag/gesture ends (mouseup/touchend/keyup/blur on a slider). Folds every
  // live tick since the last commit into exactly one history entry, since history.present still
  // holds the pre-drag value.
  const commitPendingEdit = useCallback(() => {
    if (!ecs || !styleSpec || !history) {
      return;
    }
    const current = snapshotOf(ecs, styleSpec);
    if (JSON.stringify(current) === JSON.stringify(history.present)) {
      return;
    }
    setHistory(pushHistory(history, current));
  }, [ecs, styleSpec, history]);

  const acceptSavedEcs = useCallback((next: ECS) => {
    setEcs(next);
    setDirty(false);
  }, []);

  const acceptSavedStyle = useCallback((next: CaptionStyleSpec) => {
    setStyleSpec(next);
    setStyleDirty(false);
  }, []);

  const commitSavePoint = useCallback((saved: EditSnapshot) => {
    lastSavedRef.current = saved;
    setHistory((h) => (h ? { ...h, present: saved } : h));
  }, []);

  const markCurrentAsSaved = useCallback(() => {
    if (!ecs || !styleSpec) {
      return;
    }
    lastSavedRef.current = snapshotOf(ecs, styleSpec);
    setDirty(false);
    setStyleDirty(false);
  }, [ecs, styleSpec]);

  return {
    ecs,
    styleSpec,
    presets,
    dirty,
    styleDirty,
    undoAvailable: history != null && canUndoHistory(history),
    redoAvailable: history != null && canRedoHistory(history),
    applyEdit,
    commitSnapshot,
    applyEcsSegments,
    commitPendingEdit,
    undo,
    redo,
    acceptSavedEcs,
    acceptSavedStyle,
    commitSavePoint,
    markCurrentAsSaved,
  };
}
