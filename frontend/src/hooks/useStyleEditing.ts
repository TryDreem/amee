import { useCallback, useState } from "react";

import type { CaptionStyleSpec, ECS, StyleOverrides } from "../api/client";
import type { EditSnapshot } from "../lib/editSnapshot";

interface UseStyleEditingArgs {
  ecs: ECS | null;
  styleSpec: CaptionStyleSpec | null;
  applyEdit: (next: EditSnapshot) => void;
  commitSnapshot: (next: EditSnapshot) => void;
  seekTo: (t: number) => void;
  // Picking a segment's brush should reveal the panel that's about to change -- the tab itself is
  // page-level layout state, so the page decides what "show the style panel" means.
  onRequestStyleTab: () => void;
}

export interface StyleEditing {
  // Per-phrase style: which segment's style is currently being edited (arch §4.2). Keyed by the
  // segment's stable `id`, never an array index (D11) — index shifts on split/delete/merge and
  // would silently point the editor at the wrong phrase. Only meaningful while
  // CaptionStyleSpec.perPhraseStyle is on.
  editingSegmentId: string | null;
  handleChangeStyleOverrides: (patch: StyleOverrides) => void;
  handleChangeStyleOverridesLive: (patch: StyleOverrides) => void;
  selectPreset: (presetId: string) => void;
  togglePerPhraseStyle: () => void;
  handleEditSegmentStyle: (segmentId: string) => void;
  // Called when a segment disappears from the document -- a stale editing target would point the
  // style panel at a phrase that no longer exists.
  clearEditingSegmentIfMatches: (segmentId: string) => void;
}

export function useStyleEditing({
  ecs,
  styleSpec,
  applyEdit,
  commitSnapshot,
  seekTo,
  onRequestStyleTab,
}: UseStyleEditingArgs): StyleEditing {
  const [editingSegmentId, setEditingSegmentId] = useState<string | null>(null);

  // Sparse merge of a style-panel patch into the right place: while per-phrase mode is on AND a
  // segment is selected for editing, it goes into THAT segment's own overrides (Segment.overrides
  // lives in the ECS, arch §4.2, addressed by segment id per D11, created lazily); otherwise it
  // goes into the document-level CaptionStyleSpec.overrides (contract §8's sparse "only the
  // changed fields" shape — a slider touching fontSize doesn't clobber any other override
  // already set). Pure -- doesn't touch state -- so it's shared between the instant-apply path
  // and the drag-coalesced live/commit path below.
  const nextSnapshotForOverridesPatch = useCallback(
    (patch: StyleOverrides): EditSnapshot | null => {
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
    },
    [ecs, styleSpec, editingSegmentId]
  );

  // Instant changes (buttons, toggles, preset picks, color swatches): one patch, one history
  // entry, applied immediately.
  const handleChangeStyleOverrides = useCallback(
    (patch: StyleOverrides) => {
      const next = nextSnapshotForOverridesPatch(patch);
      if (next) {
        applyEdit(next);
      }
    },
    [nextSnapshotForOverridesPatch, applyEdit]
  );

  // Continuous drag (range sliders): React's onChange fires on every tick of a drag, not just on
  // release. Pushing a full history entry per tick would make one Undo only step back one tick
  // (e.g. 9.9% instead of the 7.5% the drag started from) instead of undoing the whole gesture.
  // `Live` applies each tick's value for a responsive preview WITHOUT touching history --
  // history.present is deliberately left at its pre-drag value throughout the drag.
  const handleChangeStyleOverridesLive = useCallback(
    (patch: StyleOverrides) => {
      const next = nextSnapshotForOverridesPatch(patch);
      if (next) {
        commitSnapshot(next);
      }
    },
    [nextSnapshotForOverridesPatch, commitSnapshot]
  );

  // Preset switch: CaptionStyleSpec replaced with the new preset's base values, local
  // overrides reset (architecture §7 Behavior Matrix — already-committed row). Preset is a
  // document-level field (no presetId on Segment.overrides), so this stays document-level even
  // in per-phrase mode.
  const selectPreset = useCallback(
    (presetId: string) => {
      if (!ecs || !styleSpec) {
        return;
      }
      applyEdit({
        segments: ecs.segments,
        presetId,
        perPhraseStyle: styleSpec.perPhraseStyle,
        overrides: {},
      });
    },
    [ecs, styleSpec, applyEdit]
  );

  // Document-level toggle (contract §8 perPhraseStyle). Turning it OFF stops editing a specific
  // segment (editingSegmentId → null) but deletes NO segment overrides — they lie dormant and
  // reappear if toggled back on (arch §4.2). Turning it ON leaves editingSegmentId as-is (null
  // until the user picks a segment via its brush).
  const togglePerPhraseStyle = useCallback(() => {
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
  }, [ecs, styleSpec, applyEdit]);

  // Brush click on a segment card (only shown when perPhraseStyle is on): select that segment for
  // style editing, jump the player to its start, and switch to the Style tab so the panel is
  // visible (arch §4.2 editing-vs-rendering: this sets the *editing* target, independent of which
  // segment is on screen).
  const handleEditSegmentStyle = useCallback(
    (segmentId: string) => {
      const segment = ecs?.segments.find((s) => s.id === segmentId);
      const start = segment?.words[0]?.start;
      if (start != null) {
        seekTo(start);
      }
      setEditingSegmentId(segmentId);
      onRequestStyleTab();
    },
    [ecs, seekTo, onRequestStyleTab]
  );

  const clearEditingSegmentIfMatches = useCallback((segmentId: string) => {
    setEditingSegmentId((prev) => (prev === segmentId ? null : prev));
  }, []);

  return {
    editingSegmentId,
    handleChangeStyleOverrides,
    handleChangeStyleOverridesLive,
    selectPreset,
    togglePerPhraseStyle,
    handleEditSegmentStyle,
    clearEditingSegmentIfMatches,
  };
}
