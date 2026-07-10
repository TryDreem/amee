import subprocess
from pathlib import Path

import pytest

from app.integrations.ffmpeg import FfprobeError, probe_video


@pytest.fixture
def sample_video(tmp_path: Path) -> Path:
    path = tmp_path / "sample.mp4"
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc=duration=1:size=320x240:rate=10",
            "-pix_fmt",
            "yuv420p",
            str(path),
        ],
        check=True,
        capture_output=True,
    )
    return path


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
