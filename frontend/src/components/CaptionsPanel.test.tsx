import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import CaptionsPanel from "./CaptionsPanel";
import { STR } from "../i18n";
import type { Prefs } from "../theme";
import type { PresetBase, Segment } from "../api/client";

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

function renderPanel(overrides: Partial<Parameters<typeof CaptionsPanel>[0]> = {}) {
  return render(
    <CaptionsPanel
      prefs={prefs}
      strings={STR.en}
      segments={segments}
      currentTime={0}
      resolvedStyle={null}
      perPhraseStyle={false}
      editingSegmentId={null}
      popup={null}
      confirmDeleteSegmentId={null}
      pendingWordId={null}
      onSeek={noop}
      onEditSegmentStyle={noop}
      onWordClick={noop}
      onRangeClick={noop}
      onClosePopup={noop}
      onAddWord={noop}
      onSplitSegment={noop}
      onRemoveWord={noop}
      onDeleteClick={noop}
      onConfirmDelete={noop}
      onCancelDelete={noop}
      onCommitWordText={noop}
      onCommitWordStart={noop}
      onCommitWordEnd={noop}
      onCommitSceneStart={noop}
      onCommitSceneEnd={noop}
      {...overrides}
    />
  );
}

describe("CaptionsPanel", () => {
  it("opens a word's popup on click and seeks to its start", () => {
    const onWordClick = vi.fn();
    const onSeek = vi.fn();
    renderPanel({ onWordClick, onSeek });

    fireEvent.click(screen.getByText("Hello"));
    expect(onWordClick).toHaveBeenCalledWith("seg-1", "w-1");
    expect(onSeek).toHaveBeenCalledWith(0);
  });

  it("renders the add-word/split/remove action buttons when a word's popup is open", () => {
    renderPanel({ popup: { type: "word", segmentId: "seg-1", wordId: "w-1" } });

    expect(screen.getByLabelText("Add word left")).toBeInTheDocument();
    expect(screen.getByText(/Split segment/)).toBeInTheDocument();
    expect(screen.getByLabelText("Add word right")).toBeInTheDocument();
    expect(screen.getByText(/Remove word/)).toBeInTheDocument();
  });

  it("calls onAddWord/onSplitSegment/onRemoveWord with the segment and word id when clicked", () => {
    const onAddWord = vi.fn();
    const onSplitSegment = vi.fn();
    const onRemoveWord = vi.fn();
    renderPanel({
      popup: { type: "word", segmentId: "seg-1", wordId: "w-1" },
      onAddWord,
      onSplitSegment,
      onRemoveWord,
    });

    fireEvent.click(screen.getByLabelText("Add word right"));
    expect(onAddWord).toHaveBeenCalledWith("seg-1", "w-1", "right");

    fireEvent.click(screen.getByText(/Split segment/));
    expect(onSplitSegment).toHaveBeenCalledWith("seg-1", "w-1");

    fireEvent.click(screen.getByText(/Remove word/));
    expect(onRemoveWord).toHaveBeenCalledWith("seg-1", "w-1");
  });

  it("turns the popup's target word into an editable text input, seeded with its raw text", () => {
    renderPanel({ popup: { type: "word", segmentId: "seg-1", wordId: "w-1" } });

    const input = screen.getByTestId("word-edit-input-w-1");
    expect(input).toHaveValue("Hello");
  });

  it("commits word text on blur and on Enter (which also closes the popup)", () => {
    const onCommitWordText = vi.fn();
    const onClosePopup = vi.fn();
    renderPanel({
      popup: { type: "word", segmentId: "seg-1", wordId: "w-1" },
      onCommitWordText,
      onClosePopup,
    });

    const input = screen.getByTestId("word-edit-input-w-1");
    fireEvent.change(input, { target: { value: "Hi" } });
    fireEvent.blur(input);
    expect(onCommitWordText).toHaveBeenCalledWith("seg-1", "w-1", "Hi");
    expect(onClosePopup).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "Hey" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommitWordText).toHaveBeenCalledWith("seg-1", "w-1", "Hey");
    expect(onClosePopup).toHaveBeenCalled();
  });

  it("shows the segment's time as the word popup's range line and commits start/end on blur", () => {
    const onCommitWordStart = vi.fn();
    const onCommitWordEnd = vi.fn();
    renderPanel({
      popup: { type: "word", segmentId: "seg-1", wordId: "w-2" },
      onCommitWordStart,
      onCommitWordEnd,
    });

    // The range line shows the *segment's* span (0.00–0.90), not a per-word computed range.
    expect(screen.getByText("Range: 0.00–0.90s")).toBeInTheDocument();

    const startInput = screen.getByDisplayValue("0.40");
    fireEvent.change(startInput, { target: { value: "0.5" } });
    fireEvent.blur(startInput);
    expect(onCommitWordStart).toHaveBeenCalledWith("seg-1", "w-2", "0.5");

    const endInput = screen.getByDisplayValue("0.90");
    fireEvent.change(endInput, { target: { value: "1.0" } });
    fireEvent.blur(endInput);
    expect(onCommitWordEnd).toHaveBeenCalledWith("seg-1", "w-2", "1.0");
  });

  it("opens the scene-duration popup on range-label click and seeks to the segment start", () => {
    const onRangeClick = vi.fn();
    const onSeek = vi.fn();
    renderPanel({ onRangeClick, onSeek });

    fireEvent.click(screen.getByText("0.00 – 0.90s"));
    expect(onRangeClick).toHaveBeenCalledWith("seg-1");
    expect(onSeek).toHaveBeenCalledWith(0);
  });

  it("shows the scene-duration popup with editable start/end committing onto the edge words", () => {
    const onCommitSceneStart = vi.fn();
    const onCommitSceneEnd = vi.fn();
    renderPanel({
      popup: { type: "scene", segmentId: "seg-1" },
      onCommitSceneStart,
      onCommitSceneEnd,
    });

    expect(screen.getByText("Scene Duration")).toBeInTheDocument();

    const startInput = screen.getByDisplayValue("0.00");
    fireEvent.change(startInput, { target: { value: "-0.1" } });
    fireEvent.blur(startInput);
    expect(onCommitSceneStart).toHaveBeenCalledWith("seg-1", "-0.1");

    const endInput = screen.getByDisplayValue("0.90");
    fireEvent.change(endInput, { target: { value: "1.2" } });
    fireEvent.blur(endInput);
    expect(onCommitSceneEnd).toHaveBeenCalledWith("seg-1", "1.2");
  });

  it("opens an inline delete confirmation and calls onConfirmDelete/onCancelDelete", () => {
    const onDeleteClick = vi.fn();
    const onConfirmDelete = vi.fn();
    const onCancelDelete = vi.fn();
    const { rerender } = renderPanel({ onDeleteClick });

    fireEvent.click(screen.getByLabelText("Delete segment"));
    expect(onDeleteClick).toHaveBeenCalledWith("seg-1");

    rerender(
      <CaptionsPanel
        prefs={prefs}
        strings={STR.en}
        segments={segments}
        currentTime={0}
        resolvedStyle={null}
        perPhraseStyle={false}
        editingSegmentId={null}
        popup={null}
        confirmDeleteSegmentId="seg-1"
        pendingWordId={null}
        onSeek={noop}
        onEditSegmentStyle={noop}
        onWordClick={noop}
        onRangeClick={noop}
        onClosePopup={noop}
        onAddWord={noop}
        onSplitSegment={noop}
        onRemoveWord={noop}
        onDeleteClick={onDeleteClick}
        onConfirmDelete={onConfirmDelete}
        onCancelDelete={onCancelDelete}
        onCommitWordText={noop}
        onCommitWordStart={noop}
        onCommitWordEnd={noop}
        onCommitSceneStart={noop}
        onCommitSceneEnd={noop}
      />
    );

    expect(screen.getByText("Delete this segment?")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Yes"));
    expect(onConfirmDelete).toHaveBeenCalledWith("seg-1");
  });

  it("renders an input for the pending word and commits its text on blur", () => {
    const onCommitWordText = vi.fn();
    renderPanel({ pendingWordId: "w-1", onCommitWordText });

    const input = screen.getByTestId("pending-word-input-w-1");
    fireEvent.change(input, { target: { value: "hi" } });
    fireEvent.blur(input);
    expect(onCommitWordText).toHaveBeenCalledWith("seg-1", "w-1", "hi");
  });

  it("does not show the per-segment brush when perPhraseStyle is off", () => {
    renderPanel({ perPhraseStyle: false });
    expect(screen.queryByLabelText("Style this segment")).not.toBeInTheDocument();
  });

  it("shows the per-segment brush and routes clicks to onEditSegmentStyle when perPhraseStyle is on", () => {
    const onEditSegmentStyle = vi.fn();
    renderPanel({ perPhraseStyle: true, onEditSegmentStyle });

    const brush = screen.getByLabelText("Style this segment");
    expect(brush).toBeInTheDocument();
    fireEvent.click(brush);
    expect(onEditSegmentStyle).toHaveBeenCalledWith("seg-1");
  });

  it("bolds and underlines the active word using the segment's round-robin highlight color", () => {
    const resolvedStyle = { highlightColors: ["#00ff00"], color: "#ffffff" } as PresetBase;
    renderPanel({ currentTime: 0.1, resolvedStyle });

    const helloSpan = screen.getByText("Hello");
    expect(helloSpan).toHaveStyle({ fontWeight: "700", color: "#00ff00" });

    const worldSpan = screen.getByText("world");
    expect(worldSpan).toHaveStyle({ fontWeight: "500", color: "#ffffff" });
  });

  it("strips punctuation from displayed (non-editing) word text when showPunctuation is off", () => {
    const punctSegments: Segment[] = [
      { id: "seg-1", words: [{ id: "w-1", text: "Hello,", start: 0, end: 0.4 }] },
    ];
    const resolvedStyle = { showPunctuation: false } as PresetBase;
    renderPanel({ segments: punctSegments, resolvedStyle });

    expect(screen.queryByText("Hello,")).not.toBeInTheDocument();
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });

  it("shows raw punctuation in the list when showPunctuation is on", () => {
    const punctSegments: Segment[] = [
      { id: "seg-1", words: [{ id: "w-1", text: "Hello,", start: 0, end: 0.4 }] },
    ];
    const resolvedStyle = { showPunctuation: true } as PresetBase;
    renderPanel({ segments: punctSegments, resolvedStyle });

    expect(screen.getByText("Hello,")).toBeInTheDocument();
  });

  it("always edits the raw (unstripped) text even when showPunctuation is off", () => {
    const punctSegments: Segment[] = [
      { id: "seg-1", words: [{ id: "w-1", text: "Hello,", start: 0, end: 0.4 }] },
    ];
    const resolvedStyle = { showPunctuation: false } as PresetBase;
    renderPanel({
      segments: punctSegments,
      resolvedStyle,
      popup: { type: "word", segmentId: "seg-1", wordId: "w-1" },
    });

    expect(screen.getByTestId("word-edit-input-w-1")).toHaveValue("Hello,");
  });
});
