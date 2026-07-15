import uuid

from sqlalchemy import Boolean, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class PresetModel(Base):
    """No `owner_id` — presets are global, shared config, not user content
    (INVARIANTS D9, contract §9). `base`/`bounds` are stored as JSONB blobs,
    not exploded into columns: read whole, never queried field-by-field,
    same reasoning as RawTranscriptModel.words. Read-only from the API's
    perspective — no create/update endpoint exists; new presets land via a
    migration, not a repository write."""

    __tablename__ = "presets"

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String, nullable=False)
    default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    base: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False)
    bounds: Mapped[dict[str, object]] = mapped_column(JSONB, nullable=False)
