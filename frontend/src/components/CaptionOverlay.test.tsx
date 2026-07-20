import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import CaptionOverlay from "./CaptionOverlay";
import type { PresetBase, Segment } from "../api/client";

const segments: Segment[] = [
  {
    id: "seg-1",
    words: [
      { id: "w-1", text: "Hello,", start: 0, end: 0.4 },
      { id: "w-2", text: "world", start: 0.4, end: 0.9 },
    ],
  },
];

const baseStyle: PresetBase = {
  fontSize: 0.08,
  fontFamily: "Inter",
  fontWeight: 700,
  color: "#ffffff",
  highlightColors: ["#ffe600"],
  textTransform: "none",
  italic: false,
  glow: false,
  outline: null,
  shadow: null,
  showPunctuation: true,
  revealMode: "phrase",
  captionAnimation: "none",
  verticalPosition: 0.75,
  safeArea: { top: 0.1, bottom: 0.15 },
};

describe("CaptionOverlay", () => {
  it("renders every word of the active segment in phrase mode", () => {
    render(
      <CaptionOverlay
        segments={segments}
        currentTime={0.1}
        style={baseStyle}
        containerWidth={300}
        containerHeight={500}
      />
    );
    expect(screen.getByText("Hello,")).toBeInTheDocument();
    expect(screen.getByText("world")).toBeInTheDocument();
  });

  // S8 / contract §8: revealMode "single-word" renders only the active word -- every other
  // word is absent from the output entirely, not merely hidden.
  it('renders only the active word for revealMode "single-word", not the rest of the segment', () => {
    render(
      <CaptionOverlay
        segments={segments}
        currentTime={0.1}
        style={{ ...baseStyle, revealMode: "single-word" }}
        containerWidth={300}
        containerHeight={500}
      />
    );
    expect(screen.getByText("Hello,")).toBeInTheDocument();
    expect(screen.queryByText("world")).not.toBeInTheDocument();
  });

  it('switches which single word is rendered as playback moves into the next word', () => {
    const { rerender } = render(
      <CaptionOverlay
        segments={segments}
        currentTime={0.1}
        style={{ ...baseStyle, revealMode: "single-word" }}
        containerWidth={300}
        containerHeight={500}
      />
    );
    expect(screen.getByText("Hello,")).toBeInTheDocument();

    rerender(
      <CaptionOverlay
        segments={segments}
        currentTime={0.5}
        style={{ ...baseStyle, revealMode: "single-word" }}
        containerWidth={300}
        containerHeight={500}
      />
    );
    expect(screen.queryByText("Hello,")).not.toBeInTheDocument();
    expect(screen.getByText("world")).toBeInTheDocument();
  });

  it("renders nothing (no leftover word) in single-word mode before any word has started", () => {
    const lateSegments: Segment[] = [
      { id: "seg-1", words: [{ id: "w-1", text: "Hi", start: 5, end: 5.4 }] },
    ];
    render(
      <CaptionOverlay
        segments={lateSegments}
        currentTime={0}
        style={{ ...baseStyle, revealMode: "single-word" }}
        containerWidth={300}
        containerHeight={500}
      />
    );
    expect(screen.queryByText("Hi")).not.toBeInTheDocument();
  });

  it("strips punctuation from the single displayed word when showPunctuation is off", () => {
    render(
      <CaptionOverlay
        segments={segments}
        currentTime={0.1}
        style={{ ...baseStyle, revealMode: "single-word", showPunctuation: false }}
        containerWidth={300}
        containerHeight={500}
      />
    );
    expect(screen.queryByText("Hello,")).not.toBeInTheDocument();
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });

  it("applies the resolved captionAnimation as a CSS animation on the caption block", () => {
    const { container } = render(
      <CaptionOverlay
        segments={segments}
        currentTime={0.1}
        style={{ ...baseStyle, captionAnimation: "pop" }}
        containerWidth={300}
        containerHeight={500}
      />
    );
    const block = container.firstElementChild as HTMLElement;
    expect(block.style.animation).toContain("capPop");
  });

  it("applies no CSS animation when captionAnimation is none", () => {
    const { container } = render(
      <CaptionOverlay
        segments={segments}
        currentTime={0.1}
        style={{ ...baseStyle, captionAnimation: "none" }}
        containerWidth={300}
        containerHeight={500}
      />
    );
    const block = container.firstElementChild as HTMLElement;
    expect(block.style.animation).toBe("");
  });
});
