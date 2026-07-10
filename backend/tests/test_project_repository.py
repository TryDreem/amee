import uuid

from app.db import async_session_factory
from app.repositories import project as project_repo


async def test_create_and_get_roundtrip() -> None:
    owner_id = uuid.uuid4()
    async with async_session_factory() as session:
        created = await project_repo.create(
            session,
            owner_id=owner_id,
            name="Test project",
            video_url="/files/projects/x/source.mp4",
            video_width=1080,
            video_height=1920,
            video_duration_seconds=12.5,
        )

        fetched = await project_repo.get(session, created.id)

        assert fetched is not None
        assert fetched.id == created.id
        assert fetched.owner_id == owner_id
        assert fetched.name == "Test project"
        assert fetched.video_width == 1080
        assert fetched.video_height == 1920
        assert fetched.video_duration_seconds == 12.5
        assert fetched.created_at is not None


async def test_get_missing_returns_none() -> None:
    async with async_session_factory() as session:
        assert await project_repo.get(session, uuid.uuid4()) is None


async def test_list_includes_created() -> None:
    async with async_session_factory() as session:
        created = await project_repo.create(
            session,
            owner_id=uuid.uuid4(),
            name="List test",
            video_url="/files/projects/y/source.mp4",
            video_width=100,
            video_height=200,
            video_duration_seconds=1.0,
        )

        all_projects = await project_repo.list_all(session)

        assert any(p.id == created.id for p in all_projects)
