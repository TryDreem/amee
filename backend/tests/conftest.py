import subprocess
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client() -> Iterator[TestClient]:
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def sample_video(tmp_path: Path) -> Path:
    """A tiny real mp4, generated on the fly — used by anything that needs
    an actual video on disk (ffmpeg probing, project upload)."""
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


@pytest.fixture
def tall_sample_video(tmp_path: Path) -> Path:
    """A real mp4 above the 1080p proxy threshold (arch §2.8d) — used by
    tests that need the preview-proxy branch to actually trigger."""
    path = tmp_path / "tall_sample.mp4"
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc=duration=1:size=1920x1440:rate=10",
            "-pix_fmt",
            "yuv420p",
            str(path),
        ],
        check=True,
        capture_output=True,
    )
    return path
