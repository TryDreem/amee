import asyncio
import json
from collections.abc import Awaitable, Callable
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


async def _run_ffmpeg(
    *args: str,
    on_progress: Callable[[float], Awaitable[None]] | None = None,
    total_duration_seconds: float | None = None,
    on_pid: Callable[[int], Awaitable[None]] | None = None,
) -> None:
    """When `on_progress` is given (alongside the video's known total
    duration), reads ffmpeg's own `-progress pipe:1` machine-readable output
    line by line *while the process runs*, rather than the plain
    `proc.communicate()` every other caller uses - that call only returns
    once the process exits, which is exactly wrong for reporting progress
    of the thing that hasn't exited yet. `on_progress` has no idea this is
    ffmpeg, Celery, or Redis - it's just "here's a percent" - so this stays
    a pure ffmpeg wrapper with no knowledge of how the percent gets used or
    persisted (that's `app/workers/tasks.py`'s job). `on_pid`, if given,
    fires once with the OS pid right after spawn - same "no idea what this
    is for" boundary, used by the export-cancel path (P8) to know what to
    signal later.

    `start_new_session=True` always, not just when `on_pid` is given: puts
    ffmpeg in its own process group regardless of caller, so a future signal
    sent to that group (`os.killpg`) only ever reaches this one process
    tree - never the Celery worker process that spawned it."""
    ffmpeg_args = list(args)
    if on_progress is not None:
        # -nostats: without it, ffmpeg's normal human-readable status line
        # still writes to stderr on every update, which would otherwise
        # spam FfmpegError's error text on failure with hundreds of
        # near-duplicate progress lines instead of the actual error.
        ffmpeg_args = ["-progress", "pipe:1", "-nostats", *ffmpeg_args]

    proc = await asyncio.create_subprocess_exec(
        "ffmpeg",
        "-y",
        *ffmpeg_args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        start_new_session=True,
    )
    if on_pid is not None:
        await on_pid(proc.pid)

    assert proc.stdout is not None and proc.stderr is not None  # PIPE above

    stderr_task = asyncio.create_task(proc.stderr.read())
    if on_progress is not None and total_duration_seconds:
        async for raw_line in proc.stdout:
            line = raw_line.decode().strip()
            # out_time_ms is misleadingly named - ffmpeg has reported it in
            # *microseconds* since the flag was introduced, a long-standing
            # naming bug kept for backwards compatibility. out_time_us is
            # the same value under its honest name; using it sidesteps the
            # trap entirely rather than "dividing by 1000" on the wrong unit.
            if line.startswith("out_time_us="):
                out_time_seconds = int(line.split("=", 1)[1]) / 1_000_000
                percent = min(100.0, out_time_seconds / total_duration_seconds * 100)
                await on_progress(percent)
            elif line == "progress=end":
                # The last frame's presentation time is often a hair short
                # of the nominal duration (frame-rate rounding), which would
                # otherwise leave the UI stuck just under 100%.
                await on_progress(100.0)
    else:
        await proc.stdout.read()  # drain so the process can't block on a full pipe

    stderr = await stderr_task
    returncode = await proc.wait()
    if returncode != 0:
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


async def burn_in_captions(
    video_path: Path,
    ass_path: Path,
    dest: Path,
    *,
    on_progress: Callable[[float], Awaitable[None]] | None = None,
    total_duration_seconds: float | None = None,
    on_pid: Callable[[int], Awaitable[None]] | None = None,
) -> None:
    """Burns Step 10's `.ass` (the libass intermediate, INVARIANTS X3) into
    the video via ffmpeg's `ass` filter (arch §2.5, contract §12's
    `video_url` output). Always runs against the **original** upload, never
    the preview proxy — same "full quality at final output" rule §2.8a
    already applies to WhisperX (audio extraction always uses the original,
    never the downscaled proxy).

    CRF 18, not proxy's CRF 23: this is the deliverable, not an editor
    convenience copy — a flagged choice, not pinned by any doc.

    `on_progress`/`total_duration_seconds` are optional and only meaningful
    together (contract §5, A5) - the burn-in is the one ffmpeg step in this
    app long enough to matter (thumbnail/proxy don't take these params).
    `on_pid` (P8) is independent of the other two - a cancellable export
    still needs its pid reported even if progress reporting is unavailable
    for some reason."""
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
        on_progress=on_progress,
        total_duration_seconds=total_duration_seconds,
        on_pid=on_pid,
    )
