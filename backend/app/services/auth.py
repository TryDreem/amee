import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories import user as user_repo
from app.schemas.user import User


def _to_schema(model: object) -> User:
    return User.model_validate(model, from_attributes=True)


async def get_current_user(session: AsyncSession, user_id: uuid.UUID) -> User | None:
    """`None` only if `user_id` (already resolved by app/api/v1/deps.py::get_current_user_id,
    which just created or verified this row) has since been deleted in the same request window —
    genuinely rare, not the normal path. The route treats it as 404, matching every other
    "id resolved by a dependency, then vanished" case in this codebase."""
    model = await user_repo.get(session, user_id)
    return _to_schema(model) if model else None
