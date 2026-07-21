import os
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


def export_paths(
    project_id: UUID, job_id: UUID
) -> tuple[Path, Path, Path, str, str, str]:
    """Destinations for the three export artifacts (contract §12's
    `ExportResult` shape) — namespaced under the job id (not just the
    project id) so a re-export never overwrites a previous job's still-
    referenced files."""
    directory = project_dir(project_id) / "exports" / str(job_id)
    directory.mkdir(parents=True, exist_ok=True)
    url_prefix = f"/files/projects/{project_id}/exports/{job_id}"
    video_path = directory / "video.mp4"
    srt_path = directory / "captions.srt"
    json_path = directory / "bundle.json"
    return (
        video_path,
        srt_path,
        json_path,
        f"{url_prefix}/{video_path.name}",
        f"{url_prefix}/{srt_path.name}",
        f"{url_prefix}/{json_path.name}",
    )


def resolve_url(url: str) -> Path:
    """Maps a `/files/...` URL (as returned by save_video, or anything else
    stored this way) back to its real disk path — the only other place
    besides save_video that's allowed to know the mapping."""
    if not url.startswith("/files/"):
        raise ValueError(f"not a storage URL: {url}")
    return storage_dir() / url.removeprefix("/files/")
