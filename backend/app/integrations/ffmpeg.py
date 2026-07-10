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
