import { useCallback, useRef, useState } from "react";

import type { CaptionPopup } from "../components/CaptionsPanel";
import type { ECS, Segment } from "../api/client";
import type { Strings } from "../i18n";
import {
  addWordAt,
  commitWordEnd,
  commitWordStart,
  commitWordText,
  deleteSegment,
  removeWord,
  splitSegmentAt,
} from "../lib/ecsEdit";

const NOTICE_TIMEOUT_MS = 10000;

interface UseCaptionEditingArgs {
  ecs: ECS | null;
  strings: Strings;
  applyEcsSegments: (segments: Segment[]) => void;
  // Deleting a segment must also drop it as the per-phrase style editing target -- that state
  // lives in useStyleEditing, so this is how the two meet without either importing the other.
  onSegmentDeleted: (segmentId: string) => void;
}

export interface CaptionEditing {
  wordPopup: CaptionPopup;
  confirmDeleteSegmentId: string | null;
  pendingWordId: string | null;
  notice: string | null;
  handleWordClick: (segmentId: string, wordId: string) => void;
  handleRangeClick: (segmentId: string) => void;
  closeWordPopup: () => void;
  handleRemoveWord: (segmentId: string, wordId: string) => void;
  handleAddWord: (segmentId: string, wordId: string, side: "left" | "right") => void;
  handleCommitWordText: (segmentId: string, wordId: string, text: string) => void;
  handleCommitWordStart: (segmentId: string, wordId: string, raw: string) => void;
  handleCommitWordEnd: (segmentId: string, wordId: string, raw: string) => void;
  handleCommitSceneStart: (segmentId: string, raw: string) => void;
  handleCommitSceneEnd: (segmentId: string, raw: string) => void;
  handleSplitSegment: (segmentId: string, wordId: string) => void;
  handleDeleteSegmentClick: (segmentId: string) => void;
  handleConfirmDeleteSegment: (segmentId: string) => void;
  handleCancelDeleteSegment: () => void;
}

// Every content operation on the ECS (words and segments) plus the transient UI state those
// operations need: which popup is open, which freshly-added word is awaiting its text, which
// segment is mid-delete-confirmation, and the 10s notice a rejected edit raises. Nothing here
// persists anything -- each handler hands a full next Segment[] to `applyEcsSegments`, which is
// what owns history/dirty (INVARIANTS: local edits only, saved explicitly).
export function useCaptionEditing({
  ecs,
  strings: L,
  applyEcsSegments,
  onSegmentDeleted,
}: UseCaptionEditingArgs): CaptionEditing {
  const [wordPopup, setWordPopup] = useState<CaptionPopup>(null);
  const [confirmDeleteSegmentId, setConfirmDeleteSegmentId] = useState<string | null>(null);
  const [pendingWordId, setPendingWordId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const showNotice = useCallback((text: string) => {
    clearTimeout(noticeTimerRef.current);
    setNotice(text);
    noticeTimerRef.current = setTimeout(() => setNotice(null), NOTICE_TIMEOUT_MS);
  }, []);

  const handleWordClick = useCallback((segmentId: string, wordId: string) => {
    setConfirmDeleteSegmentId(null);
    setWordPopup({ type: "word", segmentId, wordId });
  }, []);

  const handleRangeClick = useCallback((segmentId: string) => {
    setConfirmDeleteSegmentId(null);
    setWordPopup({ type: "scene", segmentId });
  }, []);

  const closeWordPopup = useCallback(() => {
    setWordPopup(null);
  }, []);

  // Remove word: real, distinct from Delete segment — removes just the one word. If that
  // empties the segment, removeWord drops the whole segment too (never leaves a 0-word one).
  const handleRemoveWord = useCallback(
    (segmentId: string, wordId: string) => {
      setWordPopup(null);
      if (!ecs) {
        return;
      }
      applyEcsSegments(removeWord(ecs.segments, segmentId, wordId));
    },
    [ecs, applyEcsSegments]
  );

  // Add word: purely local edit state until an explicit save — nothing here calls PUT /ecs.
  const handleAddWord = useCallback(
    (segmentId: string, wordId: string, side: "left" | "right") => {
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
    },
    [ecs, applyEcsSegments, showNotice, L]
  );

  // Unified for both a freshly-inserted pending word and text-editing an existing word via its
  // popup -- empty text removes the word, text over the edit-time limits (architecture.md
  // §7.1) also removes it with a 10s notice. Clears pendingWordId only when it's the word that
  // was actually committed, so committing a *different* word's text (popup open on one word
  // while another is still pending) doesn't stomp on unrelated state.
  const handleCommitWordText = useCallback(
    (segmentId: string, wordId: string, text: string) => {
      if (!ecs) {
        return;
      }
      const result = commitWordText(ecs.segments, segmentId, wordId, text);
      applyEcsSegments(result.segments);
      setPendingWordId((prev) => (prev === wordId ? null : prev));
      if (result.kind === "removed_limit") {
        showNotice(result.limit === "words" ? L.noticeMaxWords : L.noticeMaxChars);
      }
    },
    [ecs, applyEcsSegments, showNotice, L]
  );

  // Word-boundary editing: real (word popup's start/end fields + the Scene Duration popup,
  // which edits the segment's first/last word directly -- segment bounds stay derived, never
  // stored, per D5; there's no separate field to hold an independent scene start/end).
  const handleCommitWordStart = useCallback(
    (segmentId: string, wordId: string, raw: string) => {
      if (!ecs) {
        return;
      }
      applyEcsSegments(commitWordStart(ecs.segments, segmentId, wordId, raw));
    },
    [ecs, applyEcsSegments]
  );

  const handleCommitWordEnd = useCallback(
    (segmentId: string, wordId: string, raw: string) => {
      if (!ecs) {
        return;
      }
      applyEcsSegments(commitWordEnd(ecs.segments, segmentId, wordId, raw));
    },
    [ecs, applyEcsSegments]
  );

  const handleCommitSceneStart = useCallback(
    (segmentId: string, raw: string) => {
      if (!ecs) {
        return;
      }
      const segment = ecs.segments.find((s) => s.id === segmentId);
      const firstWord = segment?.words[0];
      if (!firstWord) {
        return;
      }
      applyEcsSegments(commitWordStart(ecs.segments, segmentId, firstWord.id, raw));
    },
    [ecs, applyEcsSegments]
  );

  const handleCommitSceneEnd = useCallback(
    (segmentId: string, raw: string) => {
      if (!ecs) {
        return;
      }
      const segment = ecs.segments.find((s) => s.id === segmentId);
      const lastWord = segment?.words.at(-1);
      if (!lastWord) {
        return;
      }
      applyEcsSegments(commitWordEnd(ecs.segments, segmentId, lastWord.id, raw));
    },
    [ecs, applyEcsSegments]
  );

  // Split segment: clicking the segment's last word is a silent no-op (nothing to move into a
  // right-hand part), matching the design's own behavior.
  const handleSplitSegment = useCallback(
    (segmentId: string, wordId: string) => {
      setWordPopup(null);
      if (!ecs) {
        return;
      }
      const result = splitSegmentAt(ecs.segments, segmentId, wordId);
      if ("noop" in result) {
        return;
      }
      applyEcsSegments(result.segments);
    },
    [ecs, applyEcsSegments]
  );

  const handleDeleteSegmentClick = useCallback((segmentId: string) => {
    setWordPopup(null);
    setConfirmDeleteSegmentId(segmentId);
  }, []);

  // Delete segment: also drops a pending "Add word" input if it belonged to the segment being
  // deleted, so state doesn't point at a word that's about to vanish.
  const handleConfirmDeleteSegment = useCallback(
    (segmentId: string) => {
      setConfirmDeleteSegmentId(null);
      if (!ecs) {
        return;
      }
      const segment = ecs.segments.find((s) => s.id === segmentId);
      setPendingWordId((prev) =>
        prev && segment?.words.some((w) => w.id === prev) ? null : prev
      );
      onSegmentDeleted(segmentId);
      applyEcsSegments(deleteSegment(ecs.segments, segmentId));
    },
    [ecs, applyEcsSegments, onSegmentDeleted]
  );

  const handleCancelDeleteSegment = useCallback(() => {
    setConfirmDeleteSegmentId(null);
  }, []);

  return {
    wordPopup,
    confirmDeleteSegmentId,
    pendingWordId,
    notice,
    handleWordClick,
    handleRangeClick,
    closeWordPopup,
    handleRemoveWord,
    handleAddWord,
    handleCommitWordText,
    handleCommitWordStart,
    handleCommitWordEnd,
    handleCommitSceneStart,
    handleCommitSceneEnd,
    handleSplitSegment,
    handleDeleteSegmentClick,
    handleConfirmDeleteSegment,
    handleCancelDeleteSegment,
  };
}
