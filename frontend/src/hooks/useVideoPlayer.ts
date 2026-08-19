import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

export interface VideoBoxSize {
  width: number;
  height: number;
}

export interface VideoPlayer {
  videoRef: RefObject<HTMLVideoElement>;
  videoBoxRef: RefObject<HTMLDivElement>;
  videoBoxSize: VideoBoxSize;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  togglePlay: () => void;
  seekTo: (t: number) => void;
  handleVolumeChange: (v: number) => void;
  toggleMute: () => void;
}

// Plain HTML5 <video> transport state, with nothing caption-specific in it: the same hook would
// serve any other page that needed a player. `projectId` is only a re-attach key -- the <video>
// and its box don't exist in the DOM until the project has loaded, so both effects have to run
// again once the refs are actually populated.
export function useVideoPlayer(projectId: string | undefined): VideoPlayer {
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoBoxRef = useRef<HTMLDivElement>(null);
  const [videoBoxSize, setVideoBoxSize] = useState<VideoBoxSize>({ width: 0, height: 0 });
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    const box = videoBoxRef.current;
    if (!box) {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        const { width, height } = entry.contentRect;
        setVideoBoxSize({ width, height });
      }
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, [projectId]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }

    // rAF while playing, not `timeupdate`: CaptionOverlay now derives each word's entrance
    // animation position from `currentTime` alone (deterministic, seekable — the same code path
    // the headless export render drives frame by frame, INVARIANTS R1/P9). `timeupdate` only
    // fires ~4x/sec, which was fine while CSS animated itself off the wall clock, but would make
    // a currentTime-derived animation visibly step. Paused/seeked frames still get a single
    // update from `onSeeked`/`onPause`, so nothing depends on the loop running to stay correct.
    let raf = 0;
    const tick = () => {
      setCurrentTime(video.currentTime);
      raf = requestAnimationFrame(tick);
    };
    const startLoop = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    };
    const stopLoop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };

    const onSyncTime = () => setCurrentTime(video.currentTime);
    const onLoadedMetadata = () => setDuration(video.duration);
    const onPlay = () => {
      setIsPlaying(true);
      startLoop();
    };
    const onPause = () => {
      setIsPlaying(false);
      stopLoop();
      onSyncTime();
    };

    if (!video.paused) {
      startLoop();
    }
    video.addEventListener("seeked", onSyncTime);
    video.addEventListener("loadedmetadata", onLoadedMetadata);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    return () => {
      stopLoop();
      video.removeEventListener("seeked", onSyncTime);
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
    };
  }, [projectId]);

  // Stable (reads the element through the ref, closes over nothing reactive) so the keyboard
  // shortcut that calls it can attach its listener once instead of on every render.
  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    if (video.paused) {
      void video.play();
    } else {
      video.pause();
    }
  }, []);

  const seekTo = useCallback(
    (t: number) => {
      const video = videoRef.current;
      if (!video) {
        return;
      }
      video.currentTime = Math.max(0, Math.min(duration || 0, t));
    },
    [duration]
  );

  const handleVolumeChange = useCallback((v: number) => {
    const video = videoRef.current;
    setVolume(v);
    setMuted(v === 0);
    if (video) {
      video.volume = v;
      video.muted = v === 0;
    }
  }, []);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    setMuted((prev) => {
      const next = !prev;
      if (video) {
        video.muted = next;
      }
      return next;
    });
  }, []);

  return {
    videoRef,
    videoBoxRef,
    videoBoxSize,
    isPlaying,
    currentTime,
    duration,
    volume,
    muted,
    togglePlay,
    seekTo,
    handleVolumeChange,
    toggleMute,
  };
}
