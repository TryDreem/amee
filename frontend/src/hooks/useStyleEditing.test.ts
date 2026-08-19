import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { CaptionStyleSpec, ECS } from "../api/client";
import type { EditSnapshot } from "../lib/editSnapshot";
import { ecsFixture, styleFixture } from "../mocks/fixtures";
import { present } from "../test-utils";
import { useStyleEditing } from "./useStyleEditing";

const FIXTURE_SEGMENT = present(ecsFixture.segments[0], "fixture segment");
const SEGMENT_ID = FIXTURE_SEGMENT.id;
const FIRST_WORD_START = present(FIXTURE_SEGMENT.words[0], "first word").start;

function setup(styleSpec: CaptionStyleSpec = styleFixture, ecs: ECS = ecsFixture) {
  const applyEdit = vi.fn<(next: EditSnapshot) => void>();
  const commitSnapshot = vi.fn<(next: EditSnapshot) => void>();
  const seekTo = vi.fn<(t: number) => void>();
  const onRequestStyleTab = vi.fn();
  const view = renderHook(() =>
    useStyleEditing({ ecs, styleSpec, applyEdit, commitSnapshot, seekTo, onRequestStyleTab })
  );
  return { ...view, applyEdit, commitSnapshot, seekTo, onRequestStyleTab };
}

describe("useStyleEditing override routing (arch §4.2)", () => {
  it("writes to the document-level overrides when per-phrase style is off", () => {
    const { result, applyEdit } = setup();

    act(() => result.current.handleChangeStyleOverrides({ fontSize: 0.07 }));

    const next = present(applyEdit.mock.calls[0], "applyEdit call")[0];
    expect(next.overrides).toEqual({ fontSize: 0.07 });
    expect(next.segments[0]?.overrides).toBeUndefined();
  });

  it("merges sparsely rather than clobbering overrides already set", () => {
    const { result, applyEdit } = setup({ ...styleFixture, overrides: { italic: true } });

    act(() => result.current.handleChangeStyleOverrides({ fontSize: 0.07 }));

    expect(present(applyEdit.mock.calls[0], "applyEdit call")[0].overrides).toEqual({ italic: true, fontSize: 0.07 });
  });

  it("writes into the selected segment's own overrides in per-phrase mode, leaving the document style alone", () => {
    const perPhrase: CaptionStyleSpec = { ...styleFixture, perPhraseStyle: true };
    const { result, applyEdit } = setup(perPhrase);

    act(() => result.current.handleEditSegmentStyle(SEGMENT_ID));
    act(() => result.current.handleChangeStyleOverrides({ fontSize: 0.07 }));

    const next = present(applyEdit.mock.calls[0], "applyEdit call")[0];
    expect(next.segments[0]?.overrides).toEqual({ fontSize: 0.07 });
    expect(next.overrides).toEqual({});
  });

  it("per-phrase mode with no segment selected still writes document-level", () => {
    const perPhrase: CaptionStyleSpec = { ...styleFixture, perPhraseStyle: true };
    const { result, applyEdit } = setup(perPhrase);

    act(() => result.current.handleChangeStyleOverrides({ fontSize: 0.07 }));

    expect(present(applyEdit.mock.calls[0], "applyEdit call")[0].overrides).toEqual({ fontSize: 0.07 });
    expect(present(applyEdit.mock.calls[0], "applyEdit call")[0].segments[0]?.overrides).toBeUndefined();
  });

  it("a live drag tick commits without pushing history", () => {
    const { result, applyEdit, commitSnapshot } = setup();

    act(() => result.current.handleChangeStyleOverridesLive({ fontSize: 0.07 }));

    expect(applyEdit).not.toHaveBeenCalled();
    expect(present(commitSnapshot.mock.calls[0], "commitSnapshot call")[0].overrides).toEqual({ fontSize: 0.07 });
  });
});

describe("useStyleEditing segment selection", () => {
  it("selecting a segment seeks to its first word and reveals the style panel", () => {
    const { result, seekTo, onRequestStyleTab } = setup();

    act(() => result.current.handleEditSegmentStyle(SEGMENT_ID));

    expect(result.current.editingSegmentId).toBe(SEGMENT_ID);
    expect(seekTo).toHaveBeenCalledWith(FIRST_WORD_START);
    expect(onRequestStyleTab).toHaveBeenCalledOnce();
  });

  it("clears the editing target only when the deleted segment is the selected one", () => {
    const { result } = setup();

    act(() => result.current.handleEditSegmentStyle(SEGMENT_ID));

    act(() => result.current.clearEditingSegmentIfMatches("some-other-segment"));
    expect(result.current.editingSegmentId).toBe(SEGMENT_ID);

    act(() => result.current.clearEditingSegmentIfMatches(SEGMENT_ID));
    expect(result.current.editingSegmentId).toBeNull();
  });
});

describe("useStyleEditing document-level actions", () => {
  it("switching preset resets local overrides", () => {
    const { result, applyEdit } = setup({ ...styleFixture, overrides: { fontSize: 0.07 } });

    act(() => result.current.selectPreset("preset-2"));

    const next = present(applyEdit.mock.calls[0], "applyEdit call")[0];
    expect(next.presetId).toBe("preset-2");
    expect(next.overrides).toEqual({});
  });

  it("turning per-phrase off stops editing a segment but deletes no segment overrides", () => {
    const withSegmentOverride: ECS = {
      ...ecsFixture,
      segments: [{ ...FIXTURE_SEGMENT, overrides: { italic: true } }],
    };
    const perPhrase: CaptionStyleSpec = { ...styleFixture, perPhraseStyle: true };
    const { result, applyEdit } = setup(perPhrase, withSegmentOverride);

    act(() => result.current.handleEditSegmentStyle(SEGMENT_ID));
    act(() => result.current.togglePerPhraseStyle());

    expect(result.current.editingSegmentId).toBeNull();
    const next = present(applyEdit.mock.calls.at(-1), "last applyEdit call")[0];
    expect(next.perPhraseStyle).toBe(false);
    // Dormant, not deleted -- they must reappear if the toggle goes back on (arch §4.2).
    expect(next.segments[0]?.overrides).toEqual({ italic: true });
  });

  it("turning per-phrase on leaves the editing target unset", () => {
    const { result, applyEdit } = setup();

    act(() => result.current.togglePerPhraseStyle());

    expect(present(applyEdit.mock.calls[0], "applyEdit call")[0].perPhraseStyle).toBe(true);
    expect(result.current.editingSegmentId).toBeNull();
  });
});
