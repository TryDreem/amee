import asyncio
import os
import shutil
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Protocol
from uuid import UUID, uuid4

from azure.storage.blob import BlobSasPermissions, generate_blob_sas
from azure.storage.blob.aio import BlobServiceClient, ContainerClient

# All project-file disk access goes through this module — no direct paths in
# services or routes (arch §2.1, INVARIANTS A2).

# SAS link handed to the browser by main.py's /files/ route in blob mode - long enough that a
# page left open mid-session doesn't see a broken video partway through, short enough that a
# leaked URL (e.g. in a browser history) doesn't stay valid indefinitely. Not a env var: purely a
# tuning knob, same convention as redis.py's _KEY_TTL_SECONDS.
_SAS_TTL_SECONDS = 60 * 60


def storage_dir() -> Path:
    """Falls back to the same default scripts/wt-env.sh writes into
    .env.local — so `app.main` stays importable (make types, CI's drift
    check) without every environment needing this var set explicitly. Also
    the local staging/cache root in blob mode - see resolve_url/publish."""
    return Path(os.environ.get("AMEE_STORAGE_DIR", "./.data/storage"))


def project_dir(project_id: UUID) -> Path:
    return storage_dir() / "projects" / str(project_id)


def backend() -> str:
    """Read fresh every call, same reasoning as storage_dir(): no import-time
    caching to race with test monkeypatching. Public (not the usual leading
    underscore): main.py's /files/ route also needs this one decision, to
    pick between serving locally and redirecting to a signed Blob URL."""
    return os.environ.get("AMEE_STORAGE_BACKEND", "local")


def _blob_name(url: str) -> str:
    """Shared url -> blob-name mapping - the local disk path under
    storage_dir() and the Blob name are the same string, so every read and
    write direction (resolve_url, publish, delete_project_files) computes it
    exactly one way."""
    if not url.startswith("/files/"):
        raise ValueError(f"not a storage URL: {url}")
    return url.removeprefix("/files/")


class _BlobClient(Protocol):
    """The only Azure-shaped surface storage.py needs - small enough that
    tests fake it directly instead of mocking the real SDK."""

    async def upload(self, blob_name: str, data: bytes) -> None: ...
    async def download(self, blob_name: str) -> bytes: ...
    async def delete_prefix(self, prefix: str) -> None: ...
    def sas_url(self, blob_name: str) -> str: ...  # pure HMAC signing, no network call


class _AzureBlobClient:
    def __init__(
        self, container: ContainerClient, account_name: str, account_key: str
    ) -> None:
        self._container = container
        self._account_name = account_name
        self._account_key = account_key

    async def upload(self, blob_name: str, data: bytes) -> None:
        await self._container.upload_blob(name=blob_name, data=data, overwrite=True)

    async def download(self, blob_name: str) -> bytes:
        stream = await self._container.download_blob(blob_name)
        return await stream.readall()

    async def delete_prefix(self, prefix: str) -> None:
        names = [
            b.name async for b in self._container.list_blobs(name_starts_with=prefix)
        ]
        if names:
            await asyncio.gather(*(self._container.delete_blob(n) for n in names))

    def sas_url(self, blob_name: str) -> str:
        blob_client = self._container.get_blob_client(blob_name)
        sas = generate_blob_sas(
            account_name=self._account_name,
            container_name=self._container.container_name,
            blob_name=blob_name,
            account_key=self._account_key,
            permission=BlobSasPermissions(read=True),
            expiry=datetime.now(UTC) + timedelta(seconds=_SAS_TTL_SECONDS),
        )
        return f"{blob_client.url}?{sas}"


def _parse_connection_string(conn_str: str) -> dict[str, str]:
    """generate_blob_sas needs the account name/key separately - the aio
    client accepts the raw connection string directly for everything else,
    but SAS signing is the one operation that doesn't."""
    return dict(part.split("=", 1) for part in conn_str.split(";") if part)


@asynccontextmanager
async def _blob_client() -> AsyncIterator[_BlobClient]:
    """Fresh client per call, not a module-level singleton - same reasoning
    as redis.py's redis_client(): an aio client bound to one event loop
    breaks the moment a different Celery task's fresh asyncio.run() loop
    tries to reuse it. Tests monkeypatch this factory directly. Connection
    string/container are read fresh here (not at import time) so a missing
    value fails loud only when blob mode is actually exercised - same "no
    default, fail loud" contract AMEE_DB_URL already has, since Blob is the
    source of truth in blob mode, not a best-effort cache like Redis."""
    conn_str = os.environ["AMEE_AZURE_STORAGE_CONNECTION_STRING"]
    container_name = os.environ["AMEE_AZURE_STORAGE_CONTAINER"]
    parts = _parse_connection_string(conn_str)
    async with BlobServiceClient.from_connection_string(conn_str) as service_client:
        container_client = service_client.get_container_client(container_name)
        yield _AzureBlobClient(
            container_client, parts["AccountName"], parts["AccountKey"]
        )


async def save_video(
    project_id: UUID, filename: str, content: bytes
) -> tuple[Path, str]:
    """Writes the uploaded video. Returns (disk path, video_url). In blob
    mode, uploads straight to Blob with no local write at all: the returned
    Path's caller (services/projects.py) discards it, and nothing on this
    machine ever reads it back - a local copy here would be pure wasted
    disk on the API VM."""
    ext = Path(filename).suffix or ".mp4"
    dest = project_dir(project_id) / f"source{ext}"
    url = f"/files/projects/{project_id}/{dest.name}"
    if backend() == "blob":
        async with _blob_client() as client:
            await client.upload(_blob_name(url), content)
    else:
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(content)
    return dest, url


async def save_avatar(user_id: UUID, filename: str, content: bytes) -> tuple[Path, str]:
    """Writes an uploaded profile photo (POST /auth/me/avatar) - the one storage helper in this
    module keyed by user id rather than project id. Re-upload overwrites in place: any previously
    stored avatar.* is removed first (locally, and as a blob prefix in blob mode), so switching
    .jpg -> .png doesn't leave the old one behind - blob names are content-addressed by extension
    just like local filenames, so simply overwriting the new one would not clean up the old one on
    its own."""
    ext = Path(filename).suffix.lower() or ".jpg"
    directory = storage_dir() / "users" / str(user_id)
    dest = directory / f"avatar{ext}"
    url = f"/files/users/{user_id}/{dest.name}"
    if backend() == "blob":
        async with _blob_client() as client:
            await client.delete_prefix(f"users/{user_id}/avatar.")
            await client.upload(_blob_name(url), content)
    else:
        directory.mkdir(parents=True, exist_ok=True)
        for stale in directory.glob("avatar.*"):
            stale.unlink()
        dest.write_bytes(content)
    return dest, url


def thumbnail_path(project_id: UUID) -> tuple[Path, str]:
    """Destination for the midpoint-frame thumbnail (arch §2.8c) — the
    caller (app/workers/tasks.py) passes this straight to
    ffmpeg.extract_thumbnail as its `dest`, same two-value shape as
    save_video so both live disk-path/URL pairs are computed the same way.
    Unchanged by blob mode: ffmpeg needs a real local path to write into
    regardless of backend - the caller publishes it afterward."""
    directory = project_dir(project_id)
    directory.mkdir(parents=True, exist_ok=True)
    dest = directory / "thumbnail.jpg"
    return dest, f"/files/projects/{project_id}/{dest.name}"


def proxy_path(project_id: UUID) -> tuple[Path, str]:
    """Destination for the conditional 1080p preview proxy (arch §2.8d) —
    only ever passed to ffmpeg.transcode_proxy when `probe.height > 1080`;
    if no proxy is generated, the caller uses video_url directly instead of
    this path."""
    directory = project_dir(project_id)
    directory.mkdir(parents=True, exist_ok=True)
    dest = directory / "proxy.mp4"
    return dest, f"/files/projects/{project_id}/{dest.name}"


def video_export_paths(project_id: UUID, job_id: UUID) -> tuple[Path, str]:
    """Destination for `POST /export`'s one artifact, the burned-in video
    (contract §12's `ExportResult` shape) — namespaced under the job id
    (not just the project id) so a re-export never overwrites a previous
    job's still-referenced file. SRT has its own job id and its own helper
    (srt_export_paths) since Step 13 split the two into separate jobs."""
    directory = project_dir(project_id) / "exports" / str(job_id)
    directory.mkdir(parents=True, exist_ok=True)
    dest = directory / "video.mp4"
    return dest, f"/files/projects/{project_id}/exports/{job_id}/{dest.name}"


def srt_export_paths(project_id: UUID, job_id: UUID) -> tuple[Path, str]:
    """Destination for `POST /export-srt`'s one artifact — its own job id
    (minted by start_export_srt's own Job row), so it lands in its own
    exports/{job_id}/ directory, never colliding with a video-export job's
    directory even for the same project."""
    directory = project_dir(project_id) / "exports" / str(job_id)
    directory.mkdir(parents=True, exist_ok=True)
    dest = directory / "captions.srt"
    return dest, f"/files/projects/{project_id}/exports/{job_id}/{dest.name}"


async def publish(url: str) -> None:
    """No-op in local mode - the *_path() functions above already wrote the
    durable copy there. In blob mode, uploads whatever ffmpeg/whisperx just
    finished writing at the local path resolve_url would compute for this
    url, so a cross-machine reader (or main.py's /files/ route) can find it.
    Called by workers/tasks.py right after each local write finishes."""
    if backend() != "blob":
        return
    blob_name = _blob_name(url)
    content = (storage_dir() / blob_name).read_bytes()
    async with _blob_client() as client:
        await client.upload(blob_name, content)


async def delete_project_files(project_id: UUID) -> None:
    """`DELETE /projects/{id}` (contract §4, X8): one recursive delete of
    the whole project directory - source video, thumbnail, preview proxy,
    and every past export all live under this single path (`project_dir`),
    so there's no need to enumerate and delete each file kind separately.
    A no-op if the directory doesn't exist (a project whose transcribe job
    never even started has nothing on disk yet). Local rmtree always runs
    (still the staging cache in blob mode too); blob mode additionally
    clears every blob under the project's prefix."""
    directory = project_dir(project_id)
    if directory.exists():
        shutil.rmtree(directory)
    if backend() == "blob":
        async with _blob_client() as client:
            await client.delete_prefix(f"projects/{project_id}/")


async def resolve_url(url: str) -> Path:
    """Maps a `/files/...` URL (as returned by save_video, or anything else
    stored this way) back to a real local disk path - the only other place
    besides save_video that's allowed to know the mapping. In blob mode this
    is a pull-through cache: a path already on local disk (this machine
    already wrote or already downloaded it) is returned as-is with no
    network call - which also naturally dedupes two concurrent callers
    wanting the same video. Otherwise downloads from Blob into a temp file
    and atomically renames it into place, so a second reader can never see a
    torn/partial file."""
    blob_name = _blob_name(url)
    path = storage_dir() / blob_name
    if backend() == "blob" and not path.exists():
        async with _blob_client() as client:
            data = await client.download(blob_name)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.parent / f".{path.name}.{uuid4().hex}.tmp"
        tmp.write_bytes(data)
        os.replace(tmp, path)
    return path


async def public_url(url: str) -> str:
    """A time-limited signed URL for the browser to fetch this file directly
    from Blob - only meaningful in blob mode, only called by main.py's
    /files/ redirect route."""
    async with _blob_client() as client:
        return client.sas_url(_blob_name(url))
