import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, Integer, String, func
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class ProjectModel(Base):
    """No `latest_transcribe_job_id` / `export_job_ids` columns here — once the
    `Job` table exists (M1 step 4) those are derived by querying jobs for this
    project rather than duplicated onto this row (arch §4.2's general
    derive-don't-store rule, applied the same way to Job/Project as to
    Segment bounds)."""

    __tablename__ = "projects"

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    owner_id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False)
    name: Mapped[str] = mapped_column(String, nullable=False)
    video_url: Mapped[str] = mapped_column(String, nullable=False)
    # Set once at upload, never mutated afterward (arch §2.9) - null means
    # auto-detect, passed straight through to WhisperX when present.
    language: Mapped[str | None] = mapped_column(String, nullable=True)
    # All four of these are populated by the transcribe job's probe/
    # thumbnail/proxy branches (arch §2.8b-d), not at upload time — null
    # until each branch finishes (contract §4).
    video_width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    video_height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    video_duration_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    thumbnail_url: Mapped[str | None] = mapped_column(String, nullable=True)
    preview_video_url: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    # Deliberately NO `onupdate=func.now()` (unlike JobModel.updated_at):
    # D12 scopes this to caption/style saves only, and the transcribe job
    # writes this same row twice (update_media, update_preview) — an
    # automatic onupdate would bump it from those writes too, silently
    # making "last edited" mean "last touched by any background step".
    # Set explicitly by the PUT /ecs and PUT /style paths instead.
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    # Null until the first POST /projects/{id}/open — never written as a
    # side effect of GET /projects/{id} (D13), so this stays meaningful even
    # if that read is cached later.
    last_opened_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
