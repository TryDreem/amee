import asyncio
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class VideoProbe:
    width: int
    height: int
    duration_seconds: float


class FfprobeError(RuntimeError):
    pass


async def probe_video(path: Path) -> VideoProbe:
    """Width/height/duration via ffprobe — the Layout Engine needs these at
    upload time (arch §4, contract §4). Runs as a real async subprocess, not
    a blocking call wrapped in a thread, matching the async-first integration
    layer used everywhere else (app/db.py, Celery's asyncio.run())."""
    proc = await asyncio.create_subprocess_exec(
        "ffprobe",
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height:format=duration",
        "-of",
        "json",
        str(path),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    if proc.returncode != 0:
        raise FfprobeError(stderr.decode().strip())

    data: dict[str, Any] = json.loads(stdout)
    streams = data.get("streams") or []
    if not streams:
        raise FfprobeError(f"no video stream found in {path}")

    stream = streams[0]
    duration = float(data["format"]["duration"])
    return VideoProbe(
        width=int(stream["width"]),
        height=int(stream["height"]),
        duration_seconds=duration,
    )


class FfmpegError(RuntimeError):
    pass


async def _run_ffmpeg(*args: str) -> None:
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg",
        "-y",
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await proc.communicate()
    if proc.returncode != 0:
        raise FfmpegError(stderr.decode().strip())


async def extract_thumbnail(path: Path, duration_seconds: float, dest: Path) -> None:
    """Single frame at the video's midpoint (arch §2.8c) — not the first
    frame, which is frequently black or a title card."""
    midpoint = duration_seconds / 2
    await _run_ffmpeg(
        "-ss", str(midpoint), "-i", str(path), "-frames:v", "1", str(dest)
    )


async def transcode_proxy(path: Path, dest: Path) -> None:
    """Downscale to 1080p height, aspect ratio preserved, H.264/CRF 23 (arch
    §2.8d) — only called by the caller when `probe.height > 1080`; this
    function itself has no opinion on when it should run."""
    await _run_ffmpeg(
        "-i",
        str(path),
        "-vf",
        "scale=-2:1080",
        "-c:v",
        "libx264",
        "-crf",
        "23",
        "-c:a",
        "copy",
        str(dest),
    )
