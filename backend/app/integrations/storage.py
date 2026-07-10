import os
from pathlib import Path
from uuid import UUID

# All project-file disk access goes through this module — no direct paths in
# services or routes (arch §2.1, INVARIANTS A2).


def storage_dir() -> Path:
    return Path(os.environ["AMEE_STORAGE_DIR"])


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
