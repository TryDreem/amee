import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy import Enum as SAEnum
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.schemas.job import JobStatus, JobType


class JobModel(Base):
    """`type`/`status` reuse the wire-format enums from app.schemas.job rather
    than duplicating the same string literals in a second place."""

    __tablename__ = "jobs"

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("projects.id"), nullable=False
    )
    owner_id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False)
    type: Mapped[JobType] = mapped_column(
        SAEnum(JobType, name="job_type"), nullable=False
    )
    status: Mapped[JobStatus] = mapped_column(
        SAEnum(JobStatus, name="job_status"), nullable=False, default=JobStatus.queued
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )
    error: Mapped[str | None] = mapped_column(String, nullable=True)
    # Always null for type=transcribe (contract §5) — only export jobs (M2)
    # populate this. Kept as JSONB rather than three separate nullable
    # columns since it's one cohesive result, never queried piecemeal.
    result: Mapped[dict[str, str] | None] = mapped_column(JSONB, nullable=True)
