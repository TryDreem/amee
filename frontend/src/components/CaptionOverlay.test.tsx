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

  // Words are display:inline-block (for the transform keyframes), which trims a span's own
  // trailing whitespace — so the space must live between the spans or the words run together.
  it("keeps a space between adjacent words on a line", () => {
    const { container } = render(
      <CaptionOverlay
        segments={segments}
        currentTime={0.1}
        style={baseStyle}
        containerWidth={300}
        containerHeight={500}
      />
    );
    expect(container.textContent).toContain("Hello, world");
  });

  // Multi-word entrance animation is per-word (staggered), applied to each word span.
  it("applies the resolved captionAnimation per word", () => {
    render(
      <CaptionOverlay
        segments={segments}
        currentTime={0.1}
        style={{ ...baseStyle, captionAnimation: "pop" }}
        containerWidth={300}
        containerHeight={500}
      />
    );
    const word = screen.getByText("Hello,");
    expect(word.style.animationName).toBe("capPop");
  });

  // P9/R1: a frame is fully determined by (segments, style, currentTime) — the animation is
  // emitted paused, seeked via a negative delay to exactly how far into it this instant is, with
  // no dependency on when the element mounted. That is what lets the headless export render jump
  // to an arbitrary frame and get what preview shows at the same time.
  it("seeks the entrance animation deterministically from currentTime", () => {
    const at = (t: number): { delay: string; playState: string } => {
      const { unmount } = render(
        <CaptionOverlay
          segments={segments}
          currentTime={t}
          style={{ ...baseStyle, captionAnimation: "pop" }}
          containerWidth={300}
          containerHeight={500}
        />
      );
      const { animationDelay, animationPlayState } = screen.getByText("Hello,").style;
      unmount();
      return { delay: animationDelay, playState: animationPlayState };
    };

    // The first word starts at 0, so 0.1s in the animation is 100ms deep and always paused.
    expect(at(0.1).delay).toBe("-100ms");
    expect(at(0.1).playState).toBe("paused");
    // Same component, later instant → a different, later point of the same animation.
    expect(at(0.25).delay).toBe("-250ms");
  });

  it("applies no CSS animation when captionAnimation is none", () => {
    render(
      <CaptionOverlay
        segments={segments}
        currentTime={0.1}
        style={{ ...baseStyle, captionAnimation: "none" }}
        containerWidth={300}
        containerHeight={500}
      />
    );
    expect(screen.getByText("Hello,").style.animationName).toBe("");
  });

  // Single-word cards reuse pop/bounce/snap captionAnimation values but render distinct capWord*
  // keyframes in single-word mode.
  it("uses the single-word keyframe in single-word mode", () => {
    render(
      <CaptionOverlay
        segments={segments}
        currentTime={0.1}
        style={{ ...baseStyle, revealMode: "single-word", captionAnimation: "pop" }}
        containerWidth={300}
        containerHeight={500}
      />
    );
    expect(screen.getByText("Hello,").style.animationName).toBe("capWordPop");
  });

  // "progressive" is a MOVING highlight (arch §7 Behavior Matrix): only the single
  // currently-active word takes the highlight color at any instant. Words already passed must
  // revert to the base color, not stay highlighted (the bug: every revealed word turned red and
  // stayed red, i.e. karaoke-style cumulative highlighting instead of a moving one).
  it('highlights only the single currently-active word in "progressive" mode, not every word up to it', () => {
    const threeWords: Segment[] = [
      {
        id: "seg-1",
        words: [
          { id: "w-1", text: "I", start: 0, end: 0.3 },
          { id: "w-2", text: "love", start: 0.3, end: 0.6 },
          { id: "w-3", text: "you", start: 0.6, end: 0.9 },
        ],
      },
    ];
    render(
      <CaptionOverlay
        segments={threeWords}
        currentTime={0.4}
        style={{ ...baseStyle, revealMode: "progressive" }}
        containerWidth={300}
        containerHeight={500}
      />
    );
    expect(screen.getByText("I").style.color).toBe("rgb(255, 255, 255)");
    expect(screen.getByText("love").style.color).toBe("rgb(255, 230, 0)");
    expect(screen.getByText("you").style.color).toBe("rgb(255, 255, 255)");
  });

  it('highlights every word at once in "phrase" mode', () => {
    const threeWords: Segment[] = [
      {
        id: "seg-1",
        words: [
          { id: "w-1", text: "I", start: 0, end: 0.3 },
          { id: "w-2", text: "love", start: 0.3, end: 0.6 },
          { id: "w-3", text: "you", start: 0.6, end: 0.9 },
        ],
      },
    ];
    render(
      <CaptionOverlay
        segments={threeWords}
        currentTime={0.4}
        style={{ ...baseStyle, revealMode: "phrase" }}
        containerWidth={300}
        containerHeight={500}
      />
    );
    expect(screen.getByText("I").style.color).toBe("rgb(255, 230, 0)");
    expect(screen.getByText("love").style.color).toBe("rgb(255, 230, 0)");
    expect(screen.getByText("you").style.color).toBe("rgb(255, 230, 0)");
  });
});
