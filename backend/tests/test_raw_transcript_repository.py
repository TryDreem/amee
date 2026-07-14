import uuid

import pytest
from sqlalchemy.exc import IntegrityError

from app.db import async_session_factory
from app.repositories import project as project_repo
from app.repositories import raw_transcript as raw_transcript_repo


async def _make_project() -> uuid.UUID:
    async with async_session_factory() as session:
        project = await project_repo.create(
            session,
            owner_id=uuid.uuid4(),
            name="Raw transcript repo test",
            video_url="/files/projects/z/source.mp4",
        )
        return project.id


async def test_create_and_get_roundtrip() -> None:
    project_id = await _make_project()
    words = [
        {"text": "hello", "start": 0.0, "end": 0.4},
        {"text": "world", "start": 0.4, "end": 0.9},
    ]

    async with async_session_factory() as session:
        created = await raw_transcript_repo.create(
            session, project_id=project_id, owner_id=uuid.uuid4(), words=words
        )
        assert created.words == words

        fetched = await raw_transcript_repo.get_by_project(session, project_id)
        assert fetched is not None
        assert fetched.words == words


async def test_get_missing_returns_none() -> None:
    async with async_session_factory() as session:
        assert await raw_transcript_repo.get_by_project(session, uuid.uuid4()) is None


async def test_second_create_for_same_project_is_rejected() -> None:
    """D1: write-once, immutable. The schema (project_id as primary key) is
    the backstop — there is no update/delete function to misuse instead."""
    project_id = await _make_project()

    async with async_session_factory() as session:
        await raw_transcript_repo.create(
            session,
            project_id=project_id,
            owner_id=uuid.uuid4(),
            words=[{"text": "first", "start": 0.0, "end": 0.1}],
        )

    async with async_session_factory() as session:
        with pytest.raises(IntegrityError):
            await raw_transcript_repo.create(
                session,
                project_id=project_id,
                owner_id=uuid.uuid4(),
                words=[{"text": "second", "start": 0.0, "end": 0.1}],
            )
