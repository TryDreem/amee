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
    is_hdr: bool


class FfprobeError(RuntimeError):
    pass


# The two standard HDR transfer characteristics ffprobe reports: PQ
# (smpte2084, e.g. HDR10/Dolby Vision) and HLG (arib-std-b67). Wide-gamut
# primaries (bt2020) alone don't imply HDR - the transfer function is the
# signal that actually determines whether naive SDR handling looks wrong.
_HDR_TRANSFER_CHARACTERISTICS = {"smpte2084", "arib-std-b67"}


def _is_hdr(stream: dict[str, Any]) -> bool:
    """A pure predicate (mirrors `_rotation_degrees` below) so it's testable
    without a real HDR video fixture on disk - synthesizing one is awkward
    (libx264 doesn't reliably tag color_transfer via plain ffmpeg CLI flags
    on test-generated lavfi sources)."""
    return stream.get("color_transfer") in _HDR_TRANSFER_CHARACTERISTICS


def _rotation_degrees(stream: dict[str, Any]) -> int:
    """Phone-recorded video (this app's primary use case per arch §2.7's
    vertical-video framing) is very often stored with landscape *sample*
    dimensions plus a rotation transform rather than pre-rotated pixels -
    e.g. an iPhone HEVC clip shot vertically probes as 3840x2160 with a
    Display Matrix side-data entry of rotation: -90. ffmpeg's own decode
    path already applies this automatically wherever it reads frames
    (thumbnail extraction, proxy transcode, the `ass=` burn-in filter all
    see the rotated/display orientation without any code here asking for
    it) - only this raw ffprobe read does not, so left uncorrected it would
    persist landscape numbers for a video everything else already treats as
    portrait. Checks the modern Display Matrix side data first, falling
    back to the legacy `rotate` stream tag some older files still use."""
    for entry in stream.get("side_data_list", []):
        if "rotation" in entry:
            return int(entry["rotation"]) % 360
    return int(stream.get("tags", {}).get("rotate", 0)) % 360


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
        "stream=width,height,color_transfer:stream_side_data=rotation:format=duration",
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
    width = int(stream["width"])
    height = int(stream["height"])
    if _rotation_degrees(stream) % 180 != 0:
        width, height = height, width
    is_hdr = _is_hdr(stream)

    return VideoProbe(
        width=width, height=height, duration_seconds=duration, is_hdr=is_hdr
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


# Standard zscale-based HDR->SDR tonemap chain: PQ/HLG (whichever the source
# uses) decoded to scene-linear light, tonemapped down to a 100-nit SDR
# target with the `hable` operator (a filmic curve - preserves highlight/
# shadow detail instead of just clipping), then converted to BT.709 for a
# normal JPEG. Without this, a raw HDR frame written straight to 8-bit JPEG
# comes out flat and desaturated - not a codec bug, just the wrong transfer
# function/gamut being reinterpreted as the wrong one.
_HDR_TONEMAP_FILTER = (
    "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,"
    "tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p"
)


async def extract_thumbnail(
    path: Path, duration_seconds: float, dest: Path, *, is_hdr: bool = False
) -> None:
    """Single frame at the video's midpoint (arch §2.8c) — not the first
    frame, which is frequently black or a title card. `is_hdr` (from
    `probe_video`) triggers a tonemap pass so the thumbnail doesn't come out
    washed out for HDR source footage (common on recent phones)."""
    midpoint = duration_seconds / 2
    args = ["-ss", str(midpoint), "-i", str(path), "-frames:v", "1"]
    if is_hdr:
        args += ["-vf", _HDR_TONEMAP_FILTER]
    args.append(str(dest))
    await _run_ffmpeg(*args)


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


def _escape_ffmpeg_filter_path(path: str) -> str:
    """libavfilter's own escaping for a filter option value (not the shell —
    `_run_ffmpeg` execs argv directly, no shell is ever involved): backslash,
    single quote, and colon are significant inside a filtergraph string."""
    return path.replace("\\", "\\\\").replace("'", "\\'").replace(":", "\\:")


async def burn_in_captions(video_path: Path, ass_path: Path, dest: Path) -> None:
    """Burns Step 10's `.ass` (the libass intermediate, INVARIANTS X3) into
    the video via ffmpeg's `ass` filter (arch §2.5, contract §12's
    `video_url` output). Always runs against the **original** upload, never
    the preview proxy — same "full quality at final output" rule §2.8a
    already applies to WhisperX (audio extraction always uses the original,
    never the downscaled proxy).

    CRF 18, not proxy's CRF 23: this is the deliverable, not an editor
    convenience copy — a flagged choice, not pinned by any doc."""
    escaped = _escape_ffmpeg_filter_path(str(ass_path))
    await _run_ffmpeg(
        "-i",
        str(video_path),
        "-vf",
        f"ass='{escaped}'",
        "-c:v",
        "libx264",
        "-crf",
        "18",
        "-c:a",
        "copy",
        str(dest),
    )
