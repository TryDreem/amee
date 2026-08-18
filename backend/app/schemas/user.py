from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class User(BaseModel):
    """Wire shape for GET /auth/me and friends (docs/api-contract.md §15, proposed). Matches
    frontend/src/api/auth.ts's hand-authored `User` interface field-for-field on purpose - once
    `make types` runs against this, that hand-authored copy is deleted in favor of the generated
    one with zero call-site changes on the frontend."""

    id: UUID
    email: str | None
    name: str | None
    avatar_url: str | None
    is_guest: bool
    created_at: datetime
