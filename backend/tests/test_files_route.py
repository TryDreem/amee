"""GET /files/{path} (app/main.py) — local-disk serving and the blob-mode signed-URL redirect.
Kept separate from test_storage.py (new route -> new test file, matching this repo's own
convention), even though it exercises storage.py's backend switch too."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
import pytest
from fastapi import HTTPException
from httpx import ASGITransport

from app.integrations import storage
from app.main import app, get_file


class _FakeBlobClient:
    def __init__(self) -> None:
        self.blobs: dict[str, bytes] = {}

    async def upload(self, blob_name: str, data: bytes) -> None:
        self.blobs[blob_name] = data

    async def download(self, blob_name: str) -> bytes:
        return self.blobs[blob_name]

    async def delete_prefix(self, prefix: str) -> None:
        for name in [n for n in self.blobs if n.startswith(prefix)]:
            del self.blobs[name]

    def sas_url(self, blob_name: str) -> str:
        return f"https://fake.blob.core.windows.net/{blob_name}?sas=fake-token"


@pytest.fixture
def fake_blob(monkeypatch: pytest.MonkeyPatch) -> _FakeBlobClient:
    client = _FakeBlobClient()

    @asynccontextmanager
    async def _fake_blob_client() -> AsyncIterator[_FakeBlobClient]:
        yield client

    monkeypatch.setattr(storage, "_blob_client", _fake_blob_client)
    monkeypatch.setenv("AMEE_STORAGE_BACKEND", "blob")
    return client


async def test_serves_an_existing_local_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("AMEE_STORAGE_DIR", str(tmp_path))
    (tmp_path / "projects").mkdir()
    (tmp_path / "projects" / "hello.txt").write_bytes(b"hello world")

    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        resp = await c.get("/files/projects/hello.txt")

    assert resp.status_code == 200
    assert resp.content == b"hello world"


async def test_404s_on_a_missing_local_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("AMEE_STORAGE_DIR", str(tmp_path))

    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        resp = await c.get("/files/projects/nope.txt")

    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "not_found"


async def test_rejects_path_traversal_outside_the_storage_root(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Goes straight at get_file() rather than through an HTTP client: httpx normalizes `..`
    segments out of a URL before a request is even sent (verified directly - a client-side
    concern, not this app's), so a request built the normal way never actually reaches this
    code path. Calling the handler directly is what actually exercises the is_relative_to()
    check below."""
    storage_root = tmp_path / "storage"
    storage_root.mkdir()
    monkeypatch.setenv("AMEE_STORAGE_DIR", str(storage_root))
    secret = tmp_path / "secret.txt"
    secret.write_bytes(b"outside the storage root")

    with pytest.raises(HTTPException) as exc_info:
        await get_file("../secret.txt")

    assert exc_info.value.status_code == 404


async def test_blob_mode_redirects_to_a_signed_url(fake_blob: _FakeBlobClient) -> None:
    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as c:
        resp = await c.get("/files/projects/x/source.mp4", follow_redirects=False)

    assert resp.status_code == 302
    assert resp.headers["location"] == (
        "https://fake.blob.core.windows.net/projects/x/source.mp4?sas=fake-token"
    )
    assert resp.headers["cache-control"] == "no-store"
