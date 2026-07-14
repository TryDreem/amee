import uuid

import httpx
from httpx import ASGITransport

from app.db import async_session_factory
from app.main import app
from app.repositories import project as project_repo
from app.repositories import raw_transcript as raw_transcript_repo


async def test_get_raw_transcript_not_found_before_transcription() -> None:
    async with async_session_factory() as session:
        project = await project_repo.create(
            session,
            owner_id=uuid.uuid4(),
            name="Raw transcript endpoint test",
            video_url="/files/projects/z/source.mp4",
        )

    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get(f"/api/v1/projects/{project.id}/raw-transcript")

        assert response.status_code == 404
        assert response.json()["error"]["code"] == "not_found"


async def test_get_raw_transcript_returns_persisted_words() -> None:
    words = [{"text": "hi", "start": 0.0, "end": 0.3}]

    async with async_session_factory() as session:
        project = await project_repo.create(
            session,
            owner_id=uuid.uuid4(),
            name="Raw transcript endpoint test 2",
            video_url="/files/projects/z/source.mp4",
        )
        await raw_transcript_repo.create(
            session, project_id=project.id, owner_id=project.owner_id, words=words
        )

    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get(f"/api/v1/projects/{project.id}/raw-transcript")

        assert response.status_code == 200
        body = response.json()
        assert body["project_id"] == str(project.id)
        assert body["words"] == words
