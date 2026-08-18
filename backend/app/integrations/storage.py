import os
import shutil
from pathlib import Path
from uuid import UUID

# All project-file disk access goes through this module — no direct paths in
# services or routes (arch §2.1, INVARIANTS A2).


def storage_dir() -> Path:
    """Falls back to the same default scripts/wt-env.sh writes into
    .env.local — so `app.main` stays importable (make types, CI's drift
    check) without every environment needing this var set explicitly."""
    return Path(os.environ.get("AMEE_STORAGE_DIR", "./.data/storage"))


def project_dir(project_id: UUID) -> Path:
    return storage_dir() / "projects" / str(project_id)


def save_video(project_id: UUID, filename: str, content: bytes) -> tuple[Path, str]:
    """Writes the uploaded video to disk. Returns (disk path, video_url) — the
    caller needs the disk path for the immediate ffmpeg probe and the URL for
    the Project record; computing the destination filename twice would be a
    second place for the two to drift apart."""
    ext = Path(filename).suffix or ".mp4"
    directory = project_dir(project_id)
    directory.mkdir(parents=True, exist_ok=True)
    dest = directory / f"source{ext}"
    dest.write_bytes(content)
    return dest, f"/files/projects/{project_id}/{dest.name}"


def save_avatar(user_id: UUID, filename: str, content: bytes) -> tuple[Path, str]:
    """Writes an uploaded profile photo to disk (POST /auth/me/avatar) — the one storage helper
    in this module keyed by user id rather than project id. Re-upload overwrites in place: any
    previously stored avatar.* file is removed first, so switching .jpg -> .png doesn't leave the
    old one behind as dead disk usage the way a filename keyed on content type would."""
    ext = Path(filename).suffix.lower() or ".jpg"
    directory = storage_dir() / "users" / str(user_id)
    directory.mkdir(parents=True, exist_ok=True)
    for stale in directory.glob("avatar.*"):
        stale.unlink()
    dest = directory / f"avatar{ext}"
    dest.write_bytes(content)
    return dest, f"/files/users/{user_id}/{dest.name}"


def thumbnail_path(project_id: UUID) -> tuple[Path, str]:
    """Destination for the midpoint-frame thumbnail (arch §2.8c) — the
    caller (app/workers/tasks.py) passes this straight to
    ffmpeg.extract_thumbnail as its `dest`, same two-value shape as
    save_video so both live disk-path/URL pairs are computed the same way."""
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


def delete_project_files(project_id: UUID) -> None:
    """`DELETE /projects/{id}` (contract §4, X8): one recursive delete of
    the whole project directory - source video, thumbnail, preview proxy,
    and every past export all live under this single path (`project_dir`),
    so there's no need to enumerate and delete each file kind separately.
    A no-op if the directory doesn't exist (a project whose transcribe job
    never even started has nothing on disk yet)."""
    directory = project_dir(project_id)
    if directory.exists():
        shutil.rmtree(directory)


def resolve_url(url: str) -> Path:
    """Maps a `/files/...` URL (as returned by save_video, or anything else
    stored this way) back to its real disk path — the only other place
    besides save_video that's allowed to know the mapping."""
    if not url.startswith("/files/"):
        raise ValueError(f"not a storage URL: {url}")
    return storage_dir() / url.removeprefix("/files/")
