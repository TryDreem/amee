import uuid

from app.db import async_session_factory
from app.integrations.whisperx import TranscribedWord
from app.repositories import ecs as ecs_repo
from app.repositories import project as project_repo


async def _make_project() -> uuid.UUID:
    async with async_session_factory() as session:
        project = await project_repo.create(
            session,
            owner_id=uuid.uuid4(),
            name="ECS repo test",
            video_url="/files/projects/z/source.mp4",
            video_width=100,
            video_height=100,
            video_duration_seconds=1.0,
        )
        return project.id


async def test_create_from_split_and_get_roundtrip() -> None:
    project_id = await _make_project()
    owner_id = uuid.uuid4()
    groups = [
        [
            TranscribedWord(text="hello", start=0.0, end=0.4),
            TranscribedWord(text="world", start=0.4, end=0.9),
        ],
        [TranscribedWord(text="again", start=1.0, end=1.5)],
    ]

    async with async_session_factory() as session:
        await ecs_repo.create_from_split(
            session, project_id=project_id, owner_id=owner_id, groups=groups
        )

    async with async_session_factory() as session:
        segments = await ecs_repo.get_by_project(session, project_id)

    assert segments is not None
    assert len(segments) == 2
    assert [w.text for w in segments[0].words] == ["hello", "world"]
    assert [w.text for w in segments[1].words] == ["again"]

    # Bounds are derived from words, not stored (INVARIANTS D5) — confirm the
    # words needed to derive them come back in the right order.
    assert segments[0].words[0].start == 0.0
    assert segments[0].words[-1].end == 0.9


async def test_get_missing_returns_none() -> None:
    async with async_session_factory() as session:
        assert await ecs_repo.get_by_project(session, uuid.uuid4()) is None
