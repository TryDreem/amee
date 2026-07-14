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
    video_width: Mapped[int] = mapped_column(Integer, nullable=False)
    video_height: Mapped[int] = mapped_column(Integer, nullable=False)
    video_duration_seconds: Mapped[float] = mapped_column(Float, nullable=False)
    # Populated by the transcribe job's probe/thumbnail/proxy branches (arch
    # §2.8b-d), not at upload time — null until each branch finishes. The
    # video_width/height/video_duration_seconds nullable conversion is a
    # separate migration (M1 step 8); brought forward here only because
    # GET /jobs/{id}.thumbnail_url (contract §5) needs this column to exist.
    thumbnail_url: Mapped[str | None] = mapped_column(String, nullable=True)
    preview_video_url: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
