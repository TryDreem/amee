import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

import pytest

from app.integrations import storage


@pytest.fixture(autouse=True)
def storage_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setenv("AMEE_STORAGE_DIR", str(tmp_path))
    return tmp_path


class _FakeBlobClient:
    """In-memory stand-in for storage._BlobClient - a plain dict is enough
    since every real Azure call this module makes is a simple upload/
    download/delete-by-prefix/sign, no partial-response or pagination
    behavior worth modeling."""

    def __init__(self) -> None:
        self.blobs: dict[str, bytes] = {}
        self.download_count = 0

    async def upload(self, blob_name: str, data: bytes) -> None:
        self.blobs[blob_name] = data

    async def download(self, blob_name: str) -> bytes:
        self.download_count += 1
        return self.blobs[blob_name]

    async def delete_prefix(self, prefix: str) -> None:
        for name in [n for n in self.blobs if n.startswith(prefix)]:
            del self.blobs[name]

    def sas_url(self, blob_name: str) -> str:
        return f"https://fake.blob.core.windows.net/{blob_name}?sas=fake"


@pytest.fixture
def fake_blob(monkeypatch: pytest.MonkeyPatch) -> _FakeBlobClient:
    """Switches storage.py into blob mode for the test and points its
    internal client factory at a fresh in-memory fake - real Azure SDK
    calls are never made."""
    client = _FakeBlobClient()

    @asynccontextmanager
    async def _fake_blob_client() -> AsyncIterator[_FakeBlobClient]:
        yield client

    monkeypatch.setattr(storage, "_blob_client", _fake_blob_client)
    monkeypatch.setenv("AMEE_STORAGE_BACKEND", "blob")
    return client


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


# --- Blob backend (AMEE_STORAGE_BACKEND=blob) ---------------------------


async def test_save_video_uploads_to_blob_with_no_local_write(
    fake_blob: _FakeBlobClient,
) -> None:
    project_id = uuid.uuid4()
    content = b"fake video bytes"

    path, url = await storage.save_video(project_id, "upload.mov", content)

    assert url == f"/files/projects/{project_id}/source.mov"
    assert fake_blob.blobs[f"projects/{project_id}/source.mov"] == content
    assert not path.exists()


async def test_save_avatar_uploads_to_blob_and_removes_the_stale_extension(
    fake_blob: _FakeBlobClient,
) -> None:
    user_id = uuid.uuid4()
    fake_blob.blobs[f"users/{user_id}/avatar.jpg"] = b"old photo"

    _, url = await storage.save_avatar(user_id, "new.png", b"new photo")

    assert url == f"/files/users/{user_id}/avatar.png"
    assert fake_blob.blobs[f"users/{user_id}/avatar.png"] == b"new photo"
    assert f"users/{user_id}/avatar.jpg" not in fake_blob.blobs


async def test_publish_is_a_noop_in_local_mode(tmp_path: Path) -> None:
    project_id = uuid.uuid4()
    _, url = await storage.save_video(project_id, "sample.mp4", b"content")

    await storage.publish(url)  # must not raise, must not touch any blob client


async def test_publish_uploads_the_local_file_in_blob_mode(
    fake_blob: _FakeBlobClient,
) -> None:
    project_id = uuid.uuid4()
    dest, url = storage.thumbnail_path(project_id)
    dest.write_bytes(b"thumbnail bytes")

    await storage.publish(url)

    assert fake_blob.blobs[f"projects/{project_id}/thumbnail.jpg"] == b"thumbnail bytes"


async def test_resolve_url_downloads_on_a_cache_miss(
    fake_blob: _FakeBlobClient,
) -> None:
    project_id = uuid.uuid4()
    url = f"/files/projects/{project_id}/source.mp4"
    fake_blob.blobs[f"projects/{project_id}/source.mp4"] = b"remote bytes"

    path = await storage.resolve_url(url)

    assert path.read_bytes() == b"remote bytes"
    assert fake_blob.download_count == 1


async def test_resolve_url_does_not_redownload_on_a_cache_hit(
    fake_blob: _FakeBlobClient,
) -> None:
    project_id = uuid.uuid4()
    url = f"/files/projects/{project_id}/source.mp4"
    fake_blob.blobs[f"projects/{project_id}/source.mp4"] = b"remote bytes"

    await storage.resolve_url(url)
    await storage.resolve_url(url)

    assert fake_blob.download_count == 1


async def test_delete_project_files_clears_every_blob_under_the_prefix(
    fake_blob: _FakeBlobClient,
) -> None:
    project_id = uuid.uuid4()
    other_project_id = uuid.uuid4()
    fake_blob.blobs[f"projects/{project_id}/source.mp4"] = b"video"
    fake_blob.blobs[f"projects/{project_id}/thumbnail.jpg"] = b"thumb"
    fake_blob.blobs[f"projects/{other_project_id}/source.mp4"] = b"unrelated"

    await storage.delete_project_files(project_id)

    assert list(fake_blob.blobs) == [f"projects/{other_project_id}/source.mp4"]
