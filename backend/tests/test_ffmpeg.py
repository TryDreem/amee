import asyncio
import os
import signal
import subprocess
from pathlib import Path

import pytest

from app.integrations.ffmpeg import (
    FfmpegError,
    FfprobeError,
    _is_hdr,
    _parse_out_time_seconds,
    _rotation_degrees,
    burn_in_captions,
    extract_thumbnail,
    probe_video,
)


async def test_probe_video_reads_dimensions_and_duration(sample_video: Path) -> None:
    probe = await probe_video(sample_video)

    assert probe.width == 320
    assert probe.height == 240
    assert probe.duration_seconds == pytest.approx(1.0, abs=0.2)
    assert probe.is_hdr is False


@pytest.mark.parametrize(
    "stream,expected",
    [
        # PQ (HDR10/Dolby Vision) - confirmed against a real HDR upload.
        ({"color_transfer": "smpte2084"}, True),
        # HLG.
        ({"color_transfer": "arib-std-b67"}, True),
        # Plain SDR (the common case) and unknown/absent tags.
        ({"color_transfer": "bt709"}, False),
        ({}, False),
    ],
)
def test_is_hdr(stream: dict[str, object], expected: bool) -> None:
    assert _is_hdr(stream) is expected


async def test_probe_video_detects_hdr(hdr_sample_video: Path) -> None:
    probe = await probe_video(hdr_sample_video)

    assert probe.is_hdr is True


async def test_extract_thumbnail_with_tonemap_produces_a_valid_image(
    hdr_sample_video: Path, tmp_path: Path
) -> None:
    """Proves the tonemap `-vf` chain is well-formed ffmpeg syntax that runs
    end to end against real PQ-tagged source - not just a docstring claim.
    Doesn't assert on pixel content (see this session's manual before/after
    comparison against a real HDR phone video for that)."""
    dest = tmp_path / "thumb.jpg"

    await extract_thumbnail(
        hdr_sample_video, duration_seconds=1.0, dest=dest, is_hdr=True
    )

    assert dest.exists()
    probe = await probe_video(dest)
    assert probe.width == 320
    assert probe.height == 240


@pytest.mark.parametrize(
    "stream,expected",
    [
        # Modern Display Matrix side data - the shape a real iPhone HEVC
        # clip actually probes as (confirmed against a real vertically-shot
        # file: 3840x2160 sample dimensions, rotation: -90).
        ({"side_data_list": [{}, {"rotation": -90}, {}]}, 270),
        ({"side_data_list": [{"rotation": 90}]}, 90),
        ({"side_data_list": [{"rotation": 180}]}, 180),
        # Legacy `rotate` stream tag some older files use instead.
        ({"tags": {"rotate": "90"}}, 90),
        # No rotation info at all - the common case.
        ({}, 0),
        ({"side_data_list": [{}], "tags": {}}, 0),
    ],
)
def test_rotation_degrees(stream: dict[str, object], expected: int) -> None:
    assert _rotation_degrees(stream) == expected


@pytest.mark.parametrize(
    "line,expected",
    [
        # Real ffmpeg behavior: "N/A" on the first handful of -progress
        # lines, before any frame has actually been encoded yet - confirmed
        # against a real export failure (IMG_8139.MOV) where this crashed
        # int() instead of being treated as "nothing to report yet".
        ("out_time_us=N/A", None),
        ("out_time_us=1500000", 1.5),
        ("out_time_us=0", 0.0),
        ("fps=0.00", None),
        ("progress=continue", None),
    ],
)
def test_parse_out_time_seconds(line: str, expected: float | None) -> None:
    assert _parse_out_time_seconds(line) == expected


async def test_probe_video_raises_on_non_video_file(tmp_path: Path) -> None:
    not_a_video = tmp_path / "not-a-video.mp4"
    not_a_video.write_bytes(b"definitely not a video")

    with pytest.raises(FfprobeError):
        await probe_video(not_a_video)


_TRIVIAL_ASS = """[Script Info]
ScriptType: v4.00+
PlayResX: 320
PlayResY: 240
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Segment0,Inter,24,&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,0,0,5,16,16,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:01.00,Segment0,,0,0,0,,{\\an5\\pos(160,180)}hi
"""


async def test_burn_in_captions_produces_a_video_with_matching_duration(
    sample_video: Path, tmp_path: Path
) -> None:
    ass_path = tmp_path / "captions.ass"
    ass_path.write_text(_TRIVIAL_ASS)
    dest = tmp_path / "burned.mp4"

    await burn_in_captions(sample_video, ass_path, dest)

    assert dest.exists()
    probe = await probe_video(dest)
    assert probe.duration_seconds == pytest.approx(1.0, abs=0.2)


async def test_burn_in_captions_reports_progress_up_to_100(
    sample_video: Path, tmp_path: Path
) -> None:
    """Real ffmpeg -progress output, not a fake/estimated animation
    (contract §5) - reads out_time_us against the video's own known
    duration. The final callback is always exactly 100.0 (ffmpeg.py handles
    the "last frame is a hair short of nominal duration" rounding case on
    `progress=end`), not just close to it."""
    ass_path = tmp_path / "captions.ass"
    ass_path.write_text(_TRIVIAL_ASS)
    dest = tmp_path / "burned.mp4"
    percents: list[float] = []

    async def _record(percent: float) -> None:
        percents.append(percent)

    await burn_in_captions(
        sample_video,
        ass_path,
        dest,
        on_progress=_record,
        total_duration_seconds=1.0,
    )

    assert percents  # at least one tick was reported
    assert all(0.0 <= p <= 100.0 for p in percents)
    assert percents[-1] == 100.0
    assert percents == sorted(percents)  # monotonically non-decreasing


async def test_burn_in_captions_without_on_progress_still_works(
    sample_video: Path, tmp_path: Path
) -> None:
    """The -progress pipe:1/-nostats args are only added when on_progress is
    given - every other caller (and every export before this step) must be
    unaffected."""
    ass_path = tmp_path / "captions.ass"
    ass_path.write_text(_TRIVIAL_ASS)
    dest = tmp_path / "burned.mp4"

    await burn_in_captions(sample_video, ass_path, dest)

    assert dest.exists() and dest.stat().st_size > 0


async def test_killing_the_process_group_actually_stops_ffmpeg(tmp_path: Path) -> None:
    """P8, end to end against a real process: `start_new_session=True` puts
    ffmpeg in its own process group, and `os.killpg` on the reported pid
    must both (a) make `burn_in_captions` raise (a killed process is a
    failed one, from this function's point of view) and (b) actually
    terminate the OS process, not just orphan it to keep rendering
    unsupervised. Uses a large-enough source that the encode has a real
    window to be killed mid-render, not a fixture so trivial it finishes
    before the signal arrives."""
    slow_source = tmp_path / "slow.mp4"
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc=duration=8:size=1920x1080:rate=30",
            "-pix_fmt",
            "yuv420p",
            str(slow_source),
        ],
        check=True,
        capture_output=True,
    )
    ass_path = tmp_path / "captions.ass"
    ass_path.write_text(_TRIVIAL_ASS)
    dest = tmp_path / "burned.mp4"

    pid_holder: dict[str, int] = {}
    pid_reported = asyncio.Event()

    async def _capture_pid(pid: int) -> None:
        pid_holder["pid"] = pid
        pid_reported.set()

    render_task = asyncio.create_task(
        burn_in_captions(slow_source, ass_path, dest, on_pid=_capture_pid)
    )

    await asyncio.wait_for(pid_reported.wait(), timeout=5.0)
    pid = pid_holder["pid"]
    os.killpg(pid, signal.SIGTERM)

    with pytest.raises(FfmpegError):
        await asyncio.wait_for(render_task, timeout=5.0)

    # The process must be genuinely dead, not orphaned and still rendering
    # unsupervised - give the OS a brief moment to finish reaping it.
    await asyncio.sleep(0.2)
    with pytest.raises(ProcessLookupError):
        os.kill(pid, 0)
