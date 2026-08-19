import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String, func
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class UserModel(Base):
    """A row exists for every visitor, not just registered ones — a guest session mints one
    silently on first contact (app/api/v1/deps.py::get_current_user_id), so `is_guest` is the
    field that actually distinguishes "signed in" from "just passing through", not row presence."""

    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(
        PGUUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    # Both nullable, both unique: a guest has neither. Never populated together from two
    # different providers for one row - email/password auth is out of scope (Google only).
    email: Mapped[str | None] = mapped_column(String, nullable=True, unique=True)
    # Google's own stable per-account id, never the email address, which can change on Google's
    # side independently of the account itself - this is the only correct lookup key for
    # find-or-create on OAuth callback.
    google_sub: Mapped[str | None] = mapped_column(String, nullable=True, unique=True)
    name: Mapped[str | None] = mapped_column(String, nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(String, nullable=True)
    is_guest: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    # Touched on each session-cookie validation (not every request) - write-only today, nothing
    # reads it yet. Added now rather than retrofitted later onto a live table.
    last_seen_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # The quota model's counter (api-contract.md §15) - incremented exactly once, by the
    # transcribe job itself (app/workers/tasks.py), the moment it reaches `done`. Never
    # decremented: deleting a project does not free a slot, and a job that fails (duration cap,
    # no speech detected, any other error) never increments it. Deliberately not derived from
    # `COUNT(*) WHERE owner_id` on `projects` - that count changes on delete, and this one must
    # not, so it needs to be its own persisted value rather than a live query.
    projects_uploaded_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
