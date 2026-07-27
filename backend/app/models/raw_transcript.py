import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class RawTranscriptModel(Base):
    """`project_id` is the primary key, not a separate `id` — at most one raw
    transcript per project, enforced by the schema itself rather than by
    application discipline alone (D1: write-once, immutable, no PUT/DELETE
    ever). Words are one JSONB blob, not a child table: no `id` per word
    (D2), never queried or updated word-by-word, so there's nothing a
    relational table would buy here."""

    __tablename__ = "raw_transcripts"

    project_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("projects.id"), primary_key=True
    )
    owner_id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False)
    words: Mapped[list[dict[str, str | float]]] = mapped_column(JSONB, nullable=False)
    # What WhisperX actually detected/used for alignment - nullable because
    # rows written before this column existed have no known value (treated
    # the same as "language unsupported for smart-split", not backfilled
    # with a guess). Distinct from Project.language (arch §2.9's explicit
    # upload-time user choice, set once, never mutated) - this is what
    # WhisperX itself determined, which matters when the user picked "auto".
    language: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
