import uuid

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
