import uuid

import httpx
from httpx import ASGITransport

from app.db import async_session_factory
from app.integrations.whisperx import TranscribedWord
from app.main import app
from app.repositories import project as project_repo
from app.services import ecs as ecs_service


async def test_get_ecs_not_found_before_transcription() -> None:
    async with async_session_factory() as session:
        project = await project_repo.create(
            session,
            owner_id=uuid.uuid4(),
            name="ECS endpoint test",
            video_url="/files/projects/z/source.mp4",
            video_width=100,
            video_height=100,
            video_duration_seconds=1.0,
        )

    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get(f"/api/v1/projects/{project.id}/ecs")

        assert response.status_code == 404
        assert response.json()["error"]["code"] == "not_found"


async def test_get_ecs_returns_persisted_segments() -> None:
    async with async_session_factory() as session:
        project = await project_repo.create(
            session,
            owner_id=uuid.uuid4(),
            name="ECS endpoint test 2",
            video_url="/files/projects/z/source.mp4",
            video_width=100,
            video_height=100,
            video_duration_seconds=1.0,
        )
        await ecs_service.create_initial_ecs(
            session,
            project_id=project.id,
            owner_id=project.owner_id,
            words=[TranscribedWord(text="hi", start=0.0, end=0.3)],
        )

    async with httpx.AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.get(f"/api/v1/projects/{project.id}/ecs")

        assert response.status_code == 200
        body = response.json()
        assert body["project_id"] == str(project.id)
        assert len(body["segments"]) == 1
        assert body["segments"][0]["words"][0]["text"] == "hi"
