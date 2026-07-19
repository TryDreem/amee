import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import CaptionsPanel from "./CaptionsPanel";
import { STR } from "../i18n";
import type { Prefs } from "../theme";
import type { Segment } from "../api/client";

const prefs: Prefs = { theme: "mono", mode: "dark", lang: "en" };

const segments: Segment[] = [
  {
    id: "seg-1",
    words: [
      { id: "w-1", text: "Hello", start: 0, end: 0.4 },
      { id: "w-2", text: "world", start: 0.4, end: 0.9 },
    ],
  },
];

function noop() {}

describe("CaptionsPanel", () => {
  it("opens a word's popup on click and closes it on re-click", () => {
    const onWordClick = vi.fn();
    render(
      <CaptionsPanel
        prefs={prefs}
        strings={STR.en}
        segments={segments}
        popup={null}
        confirmDeleteSegmentId={null}
        pendingWordId={null}
        onWordClick={onWordClick}
        onClosePopup={noop}
        onAddWord={noop}
        onSplitSegment={noop}
        onDeleteClick={noop}
        onConfirmDelete={noop}
        onCancelDelete={noop}
        onCommitPendingWord={noop}
      />
    );

    fireEvent.click(screen.getByText("Hello"));
    expect(onWordClick).toHaveBeenCalledWith("seg-1", "w-1");
  });

  it("renders the add-word/split action buttons when a word's popup is open", () => {
    render(
      <CaptionsPanel
        prefs={prefs}
        strings={STR.en}
        segments={segments}
        popup={{ segmentId: "seg-1", wordId: "w-1" }}
        confirmDeleteSegmentId={null}
        pendingWordId={null}
        onWordClick={noop}
        onClosePopup={noop}
        onAddWord={noop}
        onSplitSegment={noop}
        onDeleteClick={noop}
        onConfirmDelete={noop}
        onCancelDelete={noop}
        onCommitPendingWord={noop}
      />
    );

    expect(screen.getByLabelText("Add word left")).toBeInTheDocument();
    expect(screen.getByLabelText("Split segment")).toBeInTheDocument();
    expect(screen.getByLabelText("Add word right")).toBeInTheDocument();
  });

  it("calls onAddWord/onSplitSegment with the segment and word id when clicked", () => {
    const onAddWord = vi.fn();
    const onSplitSegment = vi.fn();
    render(
      <CaptionsPanel
        prefs={prefs}
        strings={STR.en}
        segments={segments}
        popup={{ segmentId: "seg-1", wordId: "w-1" }}
        confirmDeleteSegmentId={null}
        pendingWordId={null}
        onWordClick={noop}
        onClosePopup={noop}
        onAddWord={onAddWord}
        onSplitSegment={onSplitSegment}
        onDeleteClick={noop}
        onConfirmDelete={noop}
        onCancelDelete={noop}
        onCommitPendingWord={noop}
      />
    );

    fireEvent.click(screen.getByLabelText("Add word right"));
    expect(onAddWord).toHaveBeenCalledWith("seg-1", "w-1", "right");

    fireEvent.click(screen.getByLabelText("Split segment"));
    expect(onSplitSegment).toHaveBeenCalledWith("seg-1", "w-1");
  });

  it("opens an inline delete confirmation and calls onConfirmDelete/onCancelDelete", () => {
    const onDeleteClick = vi.fn();
    const { rerender } = render(
      <CaptionsPanel
        prefs={prefs}
        strings={STR.en}
        segments={segments}
        popup={null}
        confirmDeleteSegmentId={null}
        pendingWordId={null}
        onWordClick={noop}
        onClosePopup={noop}
        onAddWord={noop}
        onSplitSegment={noop}
        onDeleteClick={onDeleteClick}
        onConfirmDelete={noop}
        onCancelDelete={noop}
        onCommitPendingWord={noop}
      />
    );

    fireEvent.click(screen.getByLabelText("Delete segment"));
    expect(onDeleteClick).toHaveBeenCalledWith("seg-1");

    const onConfirmDelete = vi.fn();
    const onCancelDelete = vi.fn();
    rerender(
      <CaptionsPanel
        prefs={prefs}
        strings={STR.en}
        segments={segments}
        popup={null}
        confirmDeleteSegmentId="seg-1"
        pendingWordId={null}
        onWordClick={noop}
        onClosePopup={noop}
        onAddWord={noop}
        onSplitSegment={noop}
        onDeleteClick={onDeleteClick}
        onConfirmDelete={onConfirmDelete}
        onCancelDelete={onCancelDelete}
        onCommitPendingWord={noop}
      />
    );

    expect(screen.getByText("Delete this segment?")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Yes"));
    expect(onConfirmDelete).toHaveBeenCalledWith("seg-1");
  });

  it("renders an input for the pending word and commits its text on blur", () => {
    const onCommitPendingWord = vi.fn();
    render(
      <CaptionsPanel
        prefs={prefs}
        strings={STR.en}
        segments={segments}
        popup={null}
        confirmDeleteSegmentId={null}
        pendingWordId="w-1"
        onWordClick={noop}
        onClosePopup={noop}
        onAddWord={noop}
        onSplitSegment={noop}
        onDeleteClick={noop}
        onConfirmDelete={noop}
        onCancelDelete={noop}
        onCommitPendingWord={onCommitPendingWord}
      />
    );

    const input = screen.getByTestId("pending-word-input-w-1");
    fireEvent.change(input, { target: { value: "hi" } });
    fireEvent.blur(input);
    expect(onCommitPendingWord).toHaveBeenCalledWith("hi");
  });
});
