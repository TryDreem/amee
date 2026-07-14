import uuid

from app.db import async_session_factory
from app.integrations.whisperx import TranscribedWord
from app.repositories import project as project_repo
from app.services import ecs as ecs_service


async def _make_project() -> uuid.UUID:
    async with async_session_factory() as session:
        project = await project_repo.create(
            session,
            owner_id=uuid.uuid4(),
            name="ECS service test",
            video_url="/files/projects/z/source.mp4",
            video_width=100,
            video_height=100,
            video_duration_seconds=1.0,
        )
        return project.id


async def test_create_initial_ecs_from_raw_transcript_words() -> None:
    project_id = await _make_project()
    owner_id = uuid.uuid4()
    words = [
        TranscribedWord(text=f"w{i}", start=i * 0.3, end=i * 0.3 + 0.2)
        for i in range(10)
    ]

    async with async_session_factory() as session:
        ecs = await ecs_service.create_initial_ecs(
            session, project_id=project_id, owner_id=owner_id, words=words
        )

    assert ecs.project_id == project_id
    assert len(ecs.segments) > 1
    flattened = [w.text for segment in ecs.segments for w in segment.words]
    assert flattened == [w.text for w in words]


async def test_get_ecs_returns_none_before_split() -> None:
    project_id = await _make_project()
    async with async_session_factory() as session:
        assert await ecs_service.get_ecs(session, project_id) is None
