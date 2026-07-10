import uuid
from pathlib import Path

import pytest

from app.integrations import storage


@pytest.fixture(autouse=True)
def storage_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setenv("AMEE_STORAGE_DIR", str(tmp_path))
    return tmp_path


def test_save_video_writes_file_and_returns_url(tmp_path: Path) -> None:
    project_id = uuid.uuid4()
    content = b"fake video bytes"

    path, url = storage.save_video(project_id, "upload.mov", content)

    assert path == tmp_path / "projects" / str(project_id) / "source.mov"
    assert path.read_bytes() == content
    assert url == f"/files/projects/{project_id}/source.mov"


def test_save_video_defaults_extension_when_missing(tmp_path: Path) -> None:
    project_id = uuid.uuid4()

    path, url = storage.save_video(project_id, "no-extension", b"x")

    assert path.suffix == ".mp4"
    assert url.endswith("/source.mp4")
