import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class SegmentModel(Base):
    """No `start`/`end` columns — a segment's bounds are always derived from
    its words' min/max (INVARIANTS D5, arch §4.2). `order` is stored because
    segment order is an authored decision, not derived data (§4.2)."""

    __tablename__ = "segments"

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("projects.id"), nullable=False
    )
    owner_id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False)
    order: Mapped[int] = mapped_column(Integer, nullable=False)
    overrides: Mapped[dict[str, object] | None] = mapped_column(
        JSONB, nullable=True, default=None
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    words: Mapped[list["WordModel"]] = relationship(
        back_populates="segment",
        order_by="WordModel.order",
        cascade="all, delete-orphan",
    )


class WordModel(Base):
    """One row per ECS word — unlike Raw Transcript's single JSONB blob,
    these are addressed and mutated individually later (PUT /ecs, merge/
    split, Recalculate Groups), which is what earns them a real table."""

    __tablename__ = "ecs_words"

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    segment_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("segments.id"), nullable=False
    )
    order: Mapped[int] = mapped_column(Integer, nullable=False)
    text: Mapped[str] = mapped_column(String, nullable=False)
    start: Mapped[float] = mapped_column(Float, nullable=False)
    end: Mapped[float] = mapped_column(Float, nullable=False)
    segment: Mapped[SegmentModel] = relationship(back_populates="words")
