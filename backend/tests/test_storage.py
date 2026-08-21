import uuid
from pathlib import Path

import pytest

from app.integrations import storage


@pytest.fixture(autouse=True)
def storage_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setenv("AMEE_STORAGE_DIR", str(tmp_path))
    return tmp_path


async def test_save_video_writes_file_and_returns_url(tmp_path: Path) -> None:
    project_id = uuid.uuid4()
    content = b"fake video bytes"

    path, url = await storage.save_video(project_id, "upload.mov", content)

    assert path == tmp_path / "projects" / str(project_id) / "source.mov"
    assert path.read_bytes() == content
    assert url == f"/files/projects/{project_id}/source.mov"


async def test_save_video_defaults_extension_when_missing(tmp_path: Path) -> None:
    project_id = uuid.uuid4()

    path, url = await storage.save_video(project_id, "no-extension", b"x")

    assert path.suffix == ".mp4"
    assert url.endswith("/source.mp4")


def test_video_export_paths_land_under_job_id(tmp_path: Path) -> None:
    project_id = uuid.uuid4()
    job_id = uuid.uuid4()

    path, url = storage.video_export_paths(project_id, job_id)

    assert path == (
        tmp_path / "projects" / str(project_id) / "exports" / str(job_id) / "video.mp4"
    )
    assert url == f"/files/projects/{project_id}/exports/{job_id}/video.mp4"


def test_srt_export_paths_land_under_job_id(tmp_path: Path) -> None:
    project_id = uuid.uuid4()
    job_id = uuid.uuid4()

    path, url = storage.srt_export_paths(project_id, job_id)

    assert path == (
        tmp_path
        / "projects"
        / str(project_id)
        / "exports"
        / str(job_id)
        / "captions.srt"
    )
    assert url == f"/files/projects/{project_id}/exports/{job_id}/captions.srt"


def test_video_and_srt_export_paths_dont_collide_for_different_jobs(
    tmp_path: Path,
) -> None:
    project_id = uuid.uuid4()
    video_job_id = uuid.uuid4()
    srt_job_id = uuid.uuid4()

    video_path, _ = storage.video_export_paths(project_id, video_job_id)
    srt_path, _ = storage.srt_export_paths(project_id, srt_job_id)

    assert video_path.parent != srt_path.parent
