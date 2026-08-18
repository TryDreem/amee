import uuid

from app.db import async_session_factory
from app.models.user import UserModel
from app.repositories import user as user_repo


async def test_create_guest_and_get_roundtrip() -> None:
    async with async_session_factory() as session:
        guest = await user_repo.create_guest(session)

        assert guest.is_guest is True
        assert guest.email is None
        assert guest.google_sub is None
        assert guest.created_at is not None

        fetched = await user_repo.get(session, guest.id)
        assert fetched is not None
        assert fetched.id == guest.id


async def test_get_returns_none_for_unknown_id() -> None:
    async with async_session_factory() as session:
        assert await user_repo.get(session, uuid.uuid4()) is None


async def test_get_by_google_sub_finds_the_matching_row_only() -> None:
    async with async_session_factory() as session:
        linked = UserModel(is_guest=False, google_sub="sub-123", email="a@example.com")
        other = UserModel(is_guest=False, google_sub="sub-456", email="b@example.com")
        session.add_all([linked, other])
        await session.commit()

        found = await user_repo.get_by_google_sub(session, "sub-123")
        assert found is not None
        assert found.id == linked.id

        assert await user_repo.get_by_google_sub(session, "no-such-sub") is None
