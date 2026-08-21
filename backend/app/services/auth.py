import uuid
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from app.exceptions import DomainValidationError
from app.integrations import storage
from app.integrations.google_oauth import GoogleProfile
from app.repositories import ecs as ecs_repo
from app.repositories import job as job_repo
from app.repositories import project as project_repo
from app.repositories import raw_transcript as raw_transcript_repo
from app.repositories import style as style_repo
from app.repositories import user as user_repo
from app.schemas.common import ErrorDetail
from app.schemas.user import User

# A profile photo, not a project master file - deliberately much tighter than
# _ALLOWED_UPLOAD_EXTENSIONS/_MAX_UPLOAD_BYTES in services/projects.py, which is sized for
# source video.
_ALLOWED_AVATAR_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
_MAX_AVATAR_BYTES = 5 * 1024**2  # 5MB


def _to_schema(model: object) -> User:
    return User.model_validate(model, from_attributes=True)


async def get_current_user(session: AsyncSession, user_id: uuid.UUID) -> User | None:
    """`None` only if `user_id` (already resolved by app/api/v1/deps.py::get_current_user_id,
    which just created or verified this row) has since been deleted in the same request window —
    genuinely rare, not the normal path. The route treats it as 404, matching every other
    "id resolved by a dependency, then vanished" case in this codebase."""
    model = await user_repo.get(session, user_id)
    return _to_schema(model) if model else None


async def sign_in_with_google(
    session: AsyncSession, *, current_user_id: uuid.UUID, profile: GoogleProfile
) -> uuid.UUID:
    """Resolves a Google profile to the user id the session should switch to.

    Four cases, and the distinction between them is the whole point of this function:

    1. This Google account already has a row, and it *is* the current session's user — a repeat
       sign-in. Nothing to move.
    2. This Google account has no row yet, and the current session is a guest — promote that
       guest row in place. The id never changes, so every project/segment/style/transcript/job
       already points at the right owner: no reassignment, no partially-migrated window. This is
       the common path for "I've been using the app, now I'm signing up".
    3. This Google account already has a *different* row, and the current session is a guest —
       the guest has work that has to follow them onto the real account, so reassign all five
       owner_id-carrying tables. The emptied guest row is left in place: nothing references it
       any more, and deleting rows on a sign-in path is a sharper edge than an inert row.
    4. Same as (3) but the current session is *not* a guest — someone already signed in as one
       real account is signing in as another. Switch accounts and move nothing: their first
       account's projects are not the second account's to absorb.
    """
    existing = await user_repo.get_by_google_sub(session, profile.sub)
    current = await user_repo.get(session, current_user_id)

    if existing is not None:
        if existing.id != current_user_id and current is not None and current.is_guest:
            await _reassign_all_content(
                session, from_owner_id=current_user_id, to_owner_id=existing.id
            )
        await user_repo.touch_last_seen(session, existing)
        return existing.id

    if current is not None and current.is_guest:
        promoted = await user_repo.promote_guest_to_google(
            session,
            current,
            google_sub=profile.sub,
            email=profile.email,
            name=profile.name,
            avatar_url=profile.picture,
        )
        return promoted.id

    created = await user_repo.create_google_user(
        session,
        google_sub=profile.sub,
        email=profile.email,
        name=profile.name,
        avatar_url=profile.picture,
    )
    return created.id


async def update_avatar(
    session: AsyncSession, user_id: uuid.UUID, *, filename: str, content: bytes
) -> User | None:
    """`None` only on the same rare since-deleted-user race documented on get_current_user above
    — the route treats it as 404, not as "validation passed but nothing happened"."""
    details: list[ErrorDetail] = []
    ext = Path(filename).suffix.lower()
    if ext not in _ALLOWED_AVATAR_EXTENSIONS:
        details.append(
            ErrorDetail(
                field="file",
                issue=f"unsupported format {ext or '(no extension)'}: "
                "expected .jpg, .jpeg, .png, or .webp",
            )
        )
    if len(content) > _MAX_AVATAR_BYTES:
        details.append(
            ErrorDetail(
                field="file",
                issue=f"file exceeds the {_MAX_AVATAR_BYTES} byte limit",
            )
        )
    if details:
        raise DomainValidationError(details)

    user = await user_repo.get(session, user_id)
    if user is None:
        return None

    _, avatar_url = await storage.save_avatar(user_id, filename, content)
    updated = await user_repo.update_avatar(session, user, avatar_url=avatar_url)
    return _to_schema(updated)


async def _reassign_all_content(
    session: AsyncSession, *, from_owner_id: uuid.UUID, to_owner_id: uuid.UUID
) -> None:
    """All five tables that carry `owner_id`, not just `projects`. Missing one would leave a
    project owned by the new account whose segments still belong to the abandoned guest —
    invisible until something joins on owner_id and comes back empty."""
    await project_repo.reassign_owner(
        session, from_owner_id=from_owner_id, to_owner_id=to_owner_id
    )
    await ecs_repo.reassign_owner(
        session, from_owner_id=from_owner_id, to_owner_id=to_owner_id
    )
    await style_repo.reassign_owner(
        session, from_owner_id=from_owner_id, to_owner_id=to_owner_id
    )
    await raw_transcript_repo.reassign_owner(
        session, from_owner_id=from_owner_id, to_owner_id=to_owner_id
    )
    await job_repo.reassign_owner(
        session, from_owner_id=from_owner_id, to_owner_id=to_owner_id
    )
