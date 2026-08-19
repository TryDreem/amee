from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class User(BaseModel):
    """Wire shape for GET /auth/me and friends (docs/api-contract.md §15). Matches
    frontend/src/api/auth.ts's hand-authored `User` interface field-for-field on purpose - once
    `make types` runs against this, that hand-authored copy is deleted in favor of the generated
    one with zero call-site changes on the frontend."""

    id: UUID
    email: str | None
    name: str | None
    avatar_url: str | None
    is_guest: bool
    created_at: datetime
    # Quota model's counter (api-contract.md §15) - survives project deletion, only increments on
    # a transcribe job that actually reaches `done`. The account UI's "N/3" line reads this, not
    # a live count of the caller's current projects.
    projects_uploaded_count: int
