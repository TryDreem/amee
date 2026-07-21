from pathlib import Path

import pytest

from app.integrations.ffmpeg import (
    FfprobeError,
    burn_in_captions,
    probe_video,
)


async def test_probe_video_reads_dimensions_and_duration(sample_video: Path) -> None:
    probe = await probe_video(sample_video)

    assert probe.width == 320
    assert probe.height == 240
    assert probe.duration_seconds == pytest.approx(1.0, abs=0.2)


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
