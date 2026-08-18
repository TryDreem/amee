import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import UserModel


async def get(session: AsyncSession, user_id: uuid.UUID) -> UserModel | None:
    return await session.get(UserModel, user_id)


async def get_by_google_sub(session: AsyncSession, google_sub: str) -> UserModel | None:
    """Not called anywhere yet — this is the find-or-create lookup the Google OAuth callback
    (a later step) needs; included now so the repository is complete for its own file rather
    than growing piecemeal alongside each caller."""
    result = await session.execute(
        select(UserModel).where(UserModel.google_sub == google_sub)
    )
    return result.scalar_one_or_none()


async def create_guest(session: AsyncSession) -> UserModel:
    """Minted silently on first contact from a visitor with no valid session cookie
    (app/api/v1/deps.py::get_current_user_id) — never an explicit user action."""
    user = UserModel(is_guest=True)
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def create_google_user(
    session: AsyncSession,
    *,
    google_sub: str,
    email: str | None,
    name: str | None,
    avatar_url: str | None,
) -> UserModel:
    user = UserModel(
        is_guest=False,
        google_sub=google_sub,
        email=email,
        name=name,
        avatar_url=avatar_url,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def promote_guest_to_google(
    session: AsyncSession,
    user: UserModel,
    *,
    google_sub: str,
    email: str | None,
    name: str | None,
    avatar_url: str | None,
) -> UserModel:
    """Turns the guest row the visitor is *already using* into their real account, in place.

    Preferred over creating a second row and migrating everything onto it whenever the guest has
    no Google identity yet: keeping the same primary key means every project, segment, style,
    transcript and job already points at the right owner, so there is nothing to reassign and no
    window where half the rows have moved. The reassign path (services/auth.py) is only needed
    for the other case - when this Google account already has its own, different row."""
    user.is_guest = False
    user.google_sub = google_sub
    user.email = email
    user.name = name
    user.avatar_url = avatar_url
    await session.commit()
    await session.refresh(user)
    return user


async def touch_last_seen(session: AsyncSession, user: UserModel) -> UserModel:
    user.last_seen_at = datetime.now(timezone.utc)
    await session.commit()
    await session.refresh(user)
    return user
