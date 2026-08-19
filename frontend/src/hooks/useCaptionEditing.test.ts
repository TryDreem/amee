import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ECS, Segment } from "../api/client";
import { STR } from "../i18n";
import { ecsFixture } from "../mocks/fixtures";
import { present } from "../test-utils";
import { useCaptionEditing } from "./useCaptionEditing";

const L = STR.en;
const FIXTURE_SEGMENT = present(ecsFixture.segments[0], "fixture segment");
const SEGMENT_ID = FIXTURE_SEGMENT.id;
const FIRST_WORD_ID = present(FIXTURE_SEGMENT.words[0], "first word").id;
const LAST_WORD_ID = present(FIXTURE_SEGMENT.words[1], "second word").id;

// `applyEcsSegments` is a spy rather than real state: the hook never owns the document, it hands
// the next Segment[] up to useEditorDocument. Tests that need the hook to *see* the result call
// `rerender` with it, exactly as the page does once React re-renders with the new document.
function setup(ecs: ECS = ecsFixture) {
  const applyEcsSegments = vi.fn<(segments: Segment[]) => void>();
  const onSegmentDeleted = vi.fn<(segmentId: string) => void>();
  const view = renderHook(
    (props: { ecs: ECS }) =>
      useCaptionEditing({ ecs: props.ecs, strings: L, applyEcsSegments, onSegmentDeleted }),
    { initialProps: { ecs } }
  );
  const applyLatest = () => {
    const latest = applyEcsSegments.mock.calls.at(-1)?.[0];
    if (latest) {
      view.rerender({ ecs: { ...ecs, segments: latest } });
    }
  };
  return { ...view, applyEcsSegments, onSegmentDeleted, applyLatest };
}

describe("useCaptionEditing popups", () => {
  it("opens a word popup, then a scene popup, then closes", () => {
    const { result } = setup();

    act(() => result.current.handleWordClick(SEGMENT_ID, FIRST_WORD_ID));
    expect(result.current.wordPopup).toEqual({
      type: "word",
      segmentId: SEGMENT_ID,
      wordId: FIRST_WORD_ID,
    });

    act(() => result.current.handleRangeClick(SEGMENT_ID));
    expect(result.current.wordPopup).toEqual({ type: "scene", segmentId: SEGMENT_ID });

    act(() => result.current.closeWordPopup());
    expect(result.current.wordPopup).toBeNull();
  });

  it("opening a popup cancels a pending delete confirmation", () => {
    const { result } = setup();

    act(() => result.current.handleDeleteSegmentClick(SEGMENT_ID));
    expect(result.current.confirmDeleteSegmentId).toBe(SEGMENT_ID);

    act(() => result.current.handleWordClick(SEGMENT_ID, FIRST_WORD_ID));
    expect(result.current.confirmDeleteSegmentId).toBeNull();
  });
});

describe("useCaptionEditing word operations", () => {
  it("removes a word and closes the popup", () => {
    const { result, applyEcsSegments } = setup();

    act(() => result.current.handleWordClick(SEGMENT_ID, FIRST_WORD_ID));
    act(() => result.current.handleRemoveWord(SEGMENT_ID, FIRST_WORD_ID));

    expect(result.current.wordPopup).toBeNull();
    const next = applyEcsSegments.mock.calls[0]?.[0];
    expect(next?.[0]?.words.map((w) => w.id)).toEqual([LAST_WORD_ID]);
  });

  it("adds a word and holds its id as pending until its text is committed", () => {
    const { result, applyEcsSegments, applyLatest } = setup();

    act(() => result.current.handleAddWord(SEGMENT_ID, FIRST_WORD_ID, "left"));

    const pending = result.current.pendingWordId;
    expect(pending).toBeTruthy();
    expect(applyEcsSegments).toHaveBeenCalledOnce();
    expect(result.current.notice).toBeNull();

    applyLatest();
    act(() => result.current.handleCommitWordText(SEGMENT_ID, present(pending, "pending word id"), "Wait"));

    expect(applyEcsSegments.mock.calls.at(-1)?.[0]?.[0]?.words.some((w) => w.text === "Wait")).toBe(true);
    expect(result.current.pendingWordId).toBeNull();
  });

  it("raises a notice instead of adding when there is no room to borrow", () => {
    // A single word already at the minimum duration: no neighbour has any span to give up.
    const cramped: ECS = {
      ...ecsFixture,
      segments: [{ id: SEGMENT_ID, words: [{ id: FIRST_WORD_ID, text: "a", start: 0, end: 0.01 }] }],
    };
    const { result, applyEcsSegments } = setup(cramped);

    act(() => result.current.handleAddWord(SEGMENT_ID, FIRST_WORD_ID, "left"));

    expect(applyEcsSegments).not.toHaveBeenCalled();
    expect(result.current.notice).toBe(L.noticeNoRoom);
    expect(result.current.pendingWordId).toBeNull();
  });

  it("clears pendingWordId only for the word actually committed", () => {
    const { result } = setup();

    act(() => result.current.handleAddWord(SEGMENT_ID, FIRST_WORD_ID, "left"));
    const pending = result.current.pendingWordId;

    // Committing a different word's text must leave the pending one alone.
    act(() => result.current.handleCommitWordText(SEGMENT_ID, LAST_WORD_ID, "planet"));
    expect(result.current.pendingWordId).toBe(pending);
  });

  it("commits a scene's start through the segment's first word (bounds stay derived, D5)", () => {
    const { result, applyEcsSegments } = setup();

    act(() => result.current.handleCommitSceneStart(SEGMENT_ID, "0.2"));

    const next = applyEcsSegments.mock.calls[0]?.[0];
    expect(next?.[0]?.words[0]?.start).toBe(0.2);
  });
});

describe("useCaptionEditing segment operations", () => {
  it("splitting on the segment's last word is a silent no-op", () => {
    const { result, applyEcsSegments } = setup();

    act(() => result.current.handleSplitSegment(SEGMENT_ID, LAST_WORD_ID));

    expect(applyEcsSegments).not.toHaveBeenCalled();
    expect(result.current.wordPopup).toBeNull();
  });

  it("splits on any earlier word", () => {
    const { result, applyEcsSegments } = setup();

    act(() => result.current.handleSplitSegment(SEGMENT_ID, FIRST_WORD_ID));

    expect(applyEcsSegments.mock.calls[0]?.[0]).toHaveLength(2);
  });

  it("confirming a delete removes the segment and tells the style panel to drop it", () => {
    const { result, applyEcsSegments, onSegmentDeleted } = setup();

    act(() => result.current.handleDeleteSegmentClick(SEGMENT_ID));
    act(() => result.current.handleConfirmDeleteSegment(SEGMENT_ID));

    expect(result.current.confirmDeleteSegmentId).toBeNull();
    expect(onSegmentDeleted).toHaveBeenCalledWith(SEGMENT_ID);
    expect(applyEcsSegments.mock.calls[0]?.[0]).toEqual([]);
  });

  it("cancelling a delete leaves the document untouched", () => {
    const { result, applyEcsSegments, onSegmentDeleted } = setup();

    act(() => result.current.handleDeleteSegmentClick(SEGMENT_ID));
    act(() => result.current.handleCancelDeleteSegment());

    expect(result.current.confirmDeleteSegmentId).toBeNull();
    expect(applyEcsSegments).not.toHaveBeenCalled();
    expect(onSegmentDeleted).not.toHaveBeenCalled();
  });

  it("deleting the segment that owns a pending word drops the pending word too", () => {
    const { result, applyLatest } = setup();

    act(() => result.current.handleAddWord(SEGMENT_ID, FIRST_WORD_ID, "left"));
    expect(result.current.pendingWordId).toBeTruthy();

    // The segment now really contains the pending word, same as the page sees it.
    applyLatest();
    act(() => result.current.handleConfirmDeleteSegment(SEGMENT_ID));

    expect(result.current.pendingWordId).toBeNull();
  });
});
