import uuid

from sqlalchemy import ForeignKey
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class CaptionStyleSpecModel(Base):
    """`project_id` is the primary key — exactly one style row per project,
    created at upload time (contract §4) and updated in place by `PUT
    /style` (D8: whole-document PUT, not versioned rows). `preset_id` is a
    plain UUID column, not a real FK: presets are read-only, migration-seeded
    config (M2 step 1), not something an app-level FK constraint needs to
    police. `overrides` is JSONB — sparse by design (contract §8), read/
    written as the whole `StyleOverrides` object."""

    __tablename__ = "caption_style_specs"

    project_id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("projects.id"), primary_key=True
    )
    owner_id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False)
    preset_id: Mapped[uuid.UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False)
    overrides: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False)
