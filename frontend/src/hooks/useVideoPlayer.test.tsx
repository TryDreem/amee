import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useVideoPlayer, type VideoPlayer } from "./useVideoPlayer";

let player: VideoPlayer;

function Harness(): JSX.Element {
  player = useVideoPlayer("project-1");
  return (
    <div ref={player.videoBoxRef}>
      <video ref={player.videoRef} data-testid="video" />
    </div>
  );
}

function setup(duration?: number) {
  render(<Harness />);
  const video = screen.getByTestId("video") as HTMLVideoElement;
  // jsdom has no media pipeline: `duration` is read-only and playback is unimplemented, so both
  // are stood in for here. Everything else under test is real DOM/state behavior.
  Object.defineProperty(video, "duration", { value: duration ?? NaN, configurable: true });
  video.play = vi.fn().mockResolvedValue(undefined);
  video.pause = vi.fn(() => {
    Object.defineProperty(video, "paused", { value: true, configurable: true });
  });
  if (duration != null) {
    act(() => {
      fireEvent(video, new Event("loadedmetadata"));
    });
  }
  return video;
}

describe("useVideoPlayer transport", () => {
  it("picks up duration from loadedmetadata and starts paused at zero", () => {
    setup(10);

    expect(player.duration).toBe(10);
    expect(player.currentTime).toBe(0);
    expect(player.isPlaying).toBe(false);
  });

  it("clamps a seek to the video's own bounds", () => {
    const video = setup(10);

    act(() => player.seekTo(4));
    expect(video.currentTime).toBe(4);

    act(() => player.seekTo(99));
    expect(video.currentTime).toBe(10);

    act(() => player.seekTo(-5));
    expect(video.currentTime).toBe(0);
  });

  it("seeking before metadata arrives clamps to zero rather than NaN", () => {
    const video = setup();

    act(() => player.seekTo(4));
    expect(video.currentTime).toBe(0);
  });

  it("play/pause events drive isPlaying, and a pause resyncs the clock", () => {
    const video = setup(10);
    Object.defineProperty(video, "currentTime", { value: 3.5, configurable: true, writable: true });

    act(() => {
      fireEvent(video, new Event("play"));
    });
    expect(player.isPlaying).toBe(true);

    act(() => {
      fireEvent(video, new Event("pause"));
    });
    expect(player.isPlaying).toBe(false);
    expect(player.currentTime).toBe(3.5);
  });

  it("togglePlay asks the element to play when paused", () => {
    const video = setup(10);
    Object.defineProperty(video, "paused", { value: true, configurable: true });

    act(() => player.togglePlay());

    expect(video.play).toHaveBeenCalledOnce();
    expect(video.pause).not.toHaveBeenCalled();
  });

  it("togglePlay pauses when already playing", () => {
    const video = setup(10);
    Object.defineProperty(video, "paused", { value: false, configurable: true });

    act(() => player.togglePlay());

    expect(video.pause).toHaveBeenCalledOnce();
  });

  it("a seeked event resyncs currentTime without playing", () => {
    const video = setup(10);
    Object.defineProperty(video, "currentTime", { value: 7.25, configurable: true, writable: true });

    act(() => {
      fireEvent(video, new Event("seeked"));
    });

    expect(player.currentTime).toBe(7.25);
    expect(player.isPlaying).toBe(false);
  });
});

describe("useVideoPlayer volume", () => {
  it("mirrors a volume change onto the element", () => {
    const video = setup(10);

    act(() => player.handleVolumeChange(0.4));

    expect(player.volume).toBe(0.4);
    expect(player.muted).toBe(false);
    expect(video.volume).toBe(0.4);
    expect(video.muted).toBe(false);
  });

  it("dragging the volume to zero counts as muted", () => {
    const video = setup(10);

    act(() => player.handleVolumeChange(0));

    expect(player.muted).toBe(true);
    expect(video.muted).toBe(true);
  });

  it("toggleMute flips both state and element, and back again", () => {
    const video = setup(10);

    act(() => player.toggleMute());
    expect(player.muted).toBe(true);
    expect(video.muted).toBe(true);

    act(() => player.toggleMute());
    expect(player.muted).toBe(false);
    expect(video.muted).toBe(false);
  });

  it("unmuting does not lose the volume level the user had set", () => {
    setup(10);

    act(() => player.handleVolumeChange(0.3));
    act(() => player.toggleMute());
    act(() => player.toggleMute());

    expect(player.volume).toBe(0.3);
  });
});
