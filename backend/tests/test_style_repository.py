import uuid

from app.db import async_session_factory
from app.repositories import project as project_repo
from app.repositories import style as style_repo


async def _make_project() -> uuid.UUID:
    async with async_session_factory() as session:
        project = await project_repo.create(
            session,
            owner_id=uuid.uuid4(),
            name="Style repo test",
            video_url="/files/projects/z/source.mp4",
        )
        return project.id


async def test_create_and_get_roundtrip() -> None:
    project_id = await _make_project()
    owner_id = uuid.uuid4()
    preset_id = uuid.uuid4()

    async with async_session_factory() as session:
        created = await style_repo.create(
            session,
            project_id=project_id,
            owner_id=owner_id,
            preset_id=preset_id,
            overrides={"fontSize": 0.1},
        )
        assert created.preset_id == preset_id
        assert created.overrides == {"fontSize": 0.1}

        fetched = await style_repo.get(session, project_id)
        assert fetched is not None
        assert fetched.preset_id == preset_id
        assert fetched.overrides == {"fontSize": 0.1}


async def test_get_missing_returns_none() -> None:
    async with async_session_factory() as session:
        assert await style_repo.get(session, uuid.uuid4()) is None
